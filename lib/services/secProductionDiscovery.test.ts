import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID,randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { Pool,type PoolClient } from 'pg';
import { productionDiscovery,withDiscoveryReadOnly,preflightMode,discoveryFailure,discoveryConnection,DiscoveryError } from './postgres/productionDiscovery';
import { migrationConnection } from './postgres/migrationConnection';
import { assertDatabaseIdentity } from './postgres/databaseSafety';
import { productionPreflight } from './postgres/productionPreflight';

const target={environment:'production' as const,databaseName:'neondb'};
const uuid=randomUUID();
const requiredColumns=[['singleton','boolean'],['environment','text'],['database_instance_id','uuid'],['created_at','timestamp with time zone']].map(([attname,type])=>({attname,type,attnotnull:true}));
function metadataPool(options:{present?:boolean;badTable?:boolean;rows?:unknown[];database?:string;version?:number;permission?:boolean;unexpected?:boolean;connectCode?:string;connectTimeout?:boolean}={}) {
  const calls:string[]=[];let released=false;
  const client={query:async(sql:string)=>{
    calls.push(sql);let rows:unknown[]=[];
    if(sql.includes('current_database()'))rows=[{database:options.database??'neondb',version:options.version??180000}];
    else if(sql.includes('FROM pg_namespace'))rows=options.present||options.unexpected?[{nspname:'sec_admin'}]:[];
    else if(sql.includes('FROM pg_class'))rows=options.present?[{nspname:'sec_admin',relname:'database_identity',relkind:'r'}]:[];
    else if(sql.includes('FROM pg_attribute'))rows=options.badTable?[]:requiredColumns;
    else if(sql.includes('FROM sec_admin.database_identity')){if(options.permission)throw {code:'42501',message:'do not expose'};rows=options.rows??[{singleton:true,environment:'production',database_instance_id:uuid,created_at:new Date('2026-01-01T00:00:00Z')}];}
    return {rows};
  },release:()=>{released=true;}};
  const pool={connect:async()=>{if(options.connectCode)throw {code:options.connectCode,message:'do not expose'};if(options.connectTimeout)throw Error('connection acquisition timeout');return client;}} as unknown as Pool;
  return {pool,calls,released:()=>released};
}
async function refuses(options:Parameters<typeof metadataPool>[0],code:string){const p=metadataPool(options);await assert.rejects(productionDiscovery(p.pool,target),(e:unknown)=>e instanceof DiscoveryError&&e.code===code);}
test('E0 discovery missing marker is NOT_BOOTSTRAPPED, no writes or UUID needed',async()=>{
  const p=metadataPool();const result=await productionDiscovery(p.pool,target);assert.deepEqual(result,{database:'neondb',postgresMajor:18,environment:'production',schemaPresent:false,migrationHistoryPresent:false,status:'NOT_BOOTSTRAPPED',identityPresent:false});
  assert.ok(p.released());assert.equal(p.calls[0],'BEGIN READ ONLY');assert.equal(p.calls.at(-1),'ROLLBACK');assert.ok(p.calls.every(s=>/^(SELECT|BEGIN READ ONLY|SET LOCAL|ROLLBACK)/.test(s)));
});
test('E0 existing valid marker never VERIFIED and never exposes/adopts UUID',async()=>{const p=metadataPool({present:true});const r=await productionDiscovery(p.pool,target);assert.equal(r.status,'IDENTITY_PRESENT_NOT_VERIFIED');assert.equal(r.identityPresent,true);assert.ok(!JSON.stringify(r).includes(uuid));});
const negativeCases:[string,Parameters<typeof metadataPool>[0],string][]=[
  ['malformed table',{present:true,badTable:true},'MALFORMED_IDENTITY_TABLE'],
  ['empty row',{present:true,rows:[]},'MALFORMED_IDENTITY_ROW'],
  ['malformed row',{present:true,rows:[{singleton:false}]},'MALFORMED_IDENTITY_ROW'],
  ['multiple rows',{present:true,rows:[{},{}]},'MULTIPLE_IDENTITY_ROWS'],
  ['permission denied',{present:true,permission:true},'INSUFFICIENT_PRIVILEGE'],
  ['wrong database',{database:'other'},'WRONG_DATABASE'],
  ['wrong major',{version:170000},'WRONG_POSTGRES_MAJOR'],
  ['incomplete schema',{unexpected:true},'UNEXPECTED_IDENTITY_STATE'],
  ['environment mismatch',{present:true,rows:[{singleton:true,environment:'test',database_instance_id:uuid,created_at:new Date()}]},'ENVIRONMENT_MISMATCH'],
  ['connection failed',{connectCode:'ECONNREFUSED'},'CONNECTION_FAILED'],
  ['connection timeout',{connectTimeout:true},'CONNECTION_FAILED'],
  ['authentication failed',{connectCode:'28P01'},'AUTHENTICATION_FAILED'],
];
for(const [name,options,code] of negativeCases)test(`E0 ${name} cannot become NOT_BOOTSTRAPPED`,()=>refuses(options,code));
test('E0 explicit mode required; never inferred from expected UUID',()=>{assert.equal(preflightMode(['--mode','discovery']),'discovery');assert.equal(preflightMode(['--mode','verify']),'verify');for(const a of [[],['--mode','auto'],['--mode','discovery','--force']])assert.throws(()=>preflightMode(a));});
test('E0 missing and malformed expected UUID still fail closed before verification connection',()=>{const url=new URL('postgresql://localhost/neondb');url.username='fixture';url.password=randomBytes(16).toString('hex');for(const id of [undefined,'malformed'])assert.throws(()=>migrationConnection({DATABASE_DIRECT_URL:url.toString(),DATABASE_ENV:'production',DB_EXPECTED_INSTANCE_ID:id}));});
test('E0 UUID mismatch fails and matching identity passes existing invariant validation',()=>{const t={...target,databaseInstanceId:uuid};const i={environment:'production',databaseInstanceId:uuid,createdAt:'2026-01-01T00:00:00Z'};assert.doesNotThrow(()=>assertDatabaseIdentity(t,i,'neondb'));assert.throws(()=>assertDatabaseIdentity({...t,databaseInstanceId:randomUUID()},i,'neondb'));});
test('E0 connection config requires separately expected DB and never trusts provider metadata',()=>{assert.throws(()=>discoveryConnection({DATABASE_ENV:'production'}));assert.equal(discoveryFailure({code:'42501',message:'private'}).message,'INSUFFICIENT_PRIVILEGE');});

if(process.env.SEC_PRODUCTION_LOCAL==='1'||process.env.SEC_PROVISIONING_LOCAL==='1')test('E0 real PG18 discovery/verify read-only contract',{timeout:120000},async t=>{
  const name='investment-discovery-'+randomUUID().replaceAll('-','');
  const docker=(args:string[])=>execFileSync('docker',args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:60000}).trim();
  let created=false;let pools:Pool[]=[];
  try{
    docker(['run','-d','--name',name,'--label','investment-dashboard.stage=2c3he0','--publish','127.0.0.1::5432','--tmpfs','/var/lib/postgresql','-e','POSTGRES_HOST_AUTH_METHOD=trust','-e','POSTGRES_DB=neondb','postgres:18@sha256:5a5a84b19854a9ffaa54082c166ff4ec27473a361e496e5ea167f298f2da9722']);created=true;
    let ready=false;for(let i=0;i<60;i++){try{docker(['exec',name,'pg_isready','-U','postgres','-d','neondb']);ready=true;break;}catch{}await new Promise(r=>setTimeout(r,500));}assert.ok(ready);
    const binding=docker(['port',name,'5432/tcp']);assert.match(binding,/^127\.0\.0\.1:\d+$/);
    const opts={host:'127.0.0.1',port:Number(binding.split(':')[1]),database:'neondb',connectionTimeoutMillis:1000,query_timeout:5000,max:2};
    const admin=new Pool({...opts,user:'postgres'}),runtime=new Pool({...opts,user:'investment_dashboard_runtime'});pools=[admin,runtime];
    await t.test('blank database discovers NOT_BOOTSTRAPPED with no schema writes',async()=>{assert.equal((await productionDiscovery(admin,target)).status,'NOT_BOOTSTRAPPED');assert.equal((await admin.query("SELECT to_regclass('sec_admin.database_identity') AS object")).rows[0].object,null);});
    await t.test('unexpected schema and malformed table fail closed',async()=>{await admin.query('CREATE SCHEMA sec_admin');try{await assert.rejects(productionDiscovery(admin,target),{code:'UNEXPECTED_IDENTITY_STATE'});await admin.query('CREATE TABLE sec_admin.database_identity(id int)');await assert.rejects(productionDiscovery(admin,target),{code:'MALFORMED_IDENTITY_TABLE'});}finally{await admin.query('DROP SCHEMA sec_admin CASCADE');}});
    await t.test('multiple identity rows are never absence',async()=>{await admin.query('CREATE SCHEMA sec_admin; CREATE TABLE sec_admin.database_identity(singleton boolean NOT NULL,environment text NOT NULL,database_instance_id uuid NOT NULL,created_at timestamptz NOT NULL)');try{await admin.query("INSERT INTO sec_admin.database_identity VALUES(true,'production',gen_random_uuid(),now()),(true,'production',gen_random_uuid(),now())");await assert.rejects(productionDiscovery(admin,target),{code:'MULTIPLE_IDENTITY_ROWS'});}finally{await admin.query('DROP SCHEMA sec_admin CASCADE');}});
    const id=randomUUID();const bootstrap=await readFile(new URL('./postgres/production/PRODUCTION_PROVISIONING_SQL_V1.sql',import.meta.url),'utf8');await admin.query(bootstrap.replaceAll('<LOCALLY_GENERATED_INSTANCE_UUID>',id).replaceAll('<GENERATE_SECURE_PASSWORD_LOCALLY>',randomBytes(32).toString('hex')));
    await t.test('valid marker observed but not trusted, verify still exact',async()=>{const r=await productionDiscovery(admin,target);assert.equal(r.status,'IDENTITY_PRESENT_NOT_VERIFIED');assert.ok(!JSON.stringify(r).includes(id));const v={...target,databaseInstanceId:id};assert.equal((await productionPreflight(admin,v)).status,'VERIFIED');await assert.rejects(productionPreflight(admin,{...v,databaseInstanceId:''}));await assert.rejects(productionPreflight(admin,{...v,databaseInstanceId:randomUUID()}));});
    await t.test('identity permission failure is not absence',async()=>{await admin.query('REVOKE SELECT ON sec_admin.database_identity FROM investment_dashboard_runtime');try{await assert.rejects(productionDiscovery(runtime,target),{code:'INSUFFICIENT_PRIVILEGE'});}finally{await admin.query('GRANT SELECT ON sec_admin.database_identity TO investment_dashboard_runtime');}});
    await t.test('empty and environment-mismatched marker fail closed',async()=>{await admin.query("UPDATE sec_admin.database_identity SET environment='test'");try{await assert.rejects(productionDiscovery(admin,target),{code:'ENVIRONMENT_MISMATCH'});}finally{await admin.query("UPDATE sec_admin.database_identity SET environment='production'");}const saved=(await admin.query('DELETE FROM sec_admin.database_identity RETURNING *')).rows[0];try{await assert.rejects(productionDiscovery(admin,target),{code:'MALFORMED_IDENTITY_ROW'});}finally{await admin.query('INSERT INTO sec_admin.database_identity VALUES($1,$2,$3,$4)',[saved.singleton,saved.environment,saved.database_instance_id,saved.created_at]);}});
    for(const [kind,sql] of [['INSERT',"INSERT INTO sec_admin.database_identity VALUES(false,'test',gen_random_uuid(),now())"],['UPDATE',"UPDATE sec_admin.database_identity SET environment='test'"],['CREATE','CREATE TABLE sec_app.discovery_probe(id int)']] as const)await t.test(`discovery PostgreSQL READ ONLY refuses ${kind}`,async()=>{let code='';await assert.rejects(withDiscoveryReadOnly(admin,async c=>{assert.equal((await c.query('SHOW transaction_read_only')).rows[0].transaction_read_only,'on');try{await c.query(sql);}catch(e){code=(e as {code:string}).code;throw e;}}));assert.equal(code,'25006');});
  }finally{await Promise.all(pools.map(p=>p.end()));if(created)docker(['rm','-f',name]);}
});
