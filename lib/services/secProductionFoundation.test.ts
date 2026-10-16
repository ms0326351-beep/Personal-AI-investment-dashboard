import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID,randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { loadProductionMigrations,validateProductionManifest,verifyProductionArtifact } from './postgres/productionManifest';
import { productionPreflight,withReadOnlyTransaction } from './postgres/productionPreflight';
import { executeProductionMigration } from './postgres/productionMigration';
import { runSecMigrations } from './postgres/migrationRunner';
import { createSecIngestionService } from './secIngestionService';
import { PostgresSecIngestionRepository } from './postgres/secPostgresRepository';
import { secContractInput as input,secContractEnvelope as envelope } from './testing/secIngestionContract';
import { form4Fixtures } from '../utils/fixtures/secForm4Xml';

test('D formal manifest exact checksum and independent production artifact',async()=>{
  const loaded=await loadProductionMigrations();assert.equal(loaded.entries.length,1);
  assert.equal(loaded.entries[0].productionApplicable,true);assert.equal(loaded.entries[0].minimumPostgresVersion,18);
  assert.equal(/Local\/test|rehearsal/i.test(loaded.migrations[0].sql),false);
});
for(const field of ['sha256','productionApplicable','transactional','filename','order','dependencies'] as const)test(`D manifest refuses invalid ${field}`,async()=>{
  const {entries}=await loadProductionMigrations();const bad={...entries[0],[field]:({sha256:'bad',productionApplicable:false,transactional:false,filename:'../migrations/001_sec_ingestion.sql',order:2,dependencies:['absent']} as Record<string,unknown>)[field]};
  assert.throws(()=>validateProductionManifest({schemaVersion:'sec-production-manifest-v1',migrations:[bad]}));
});
test('D exact byte checksum refuses modified artifact',async()=>{
  const {entries,migrations}=await loadProductionMigrations();assert.throws(()=>verifyProductionArtifact(entries[0],migrations[0].sql+' '));
});
test('D production entry has no caller-supplied SQL or directory scan',async()=>{
  const entry=await readFile(new URL('./postgres/productionMigration.ts',import.meta.url),'utf8');
  assert.match(entry,/loadProductionMigrations\(\)/);assert.doesNotMatch(entry,/readdir|process\.argv|readFile/);
  const {entries}=await loadProductionMigrations();assert.deepEqual(entries.map(e=>e.filename),['001_sec_ingestion.sql']);
});
test('D CLI read-only and write commands are separate, no dangerous flags',async()=>{
  const pre=await readFile(new URL('../../scripts/sec-production-preflight.ts',import.meta.url),'utf8');assert.equal(/executeProductionMigration|runSecMigrations/.test(pre),false);
  const all=pre+await readFile(new URL('../../scripts/sec-production-migrate.ts',import.meta.url),'utf8');assert.equal(/force-production|skip-identity|ignore-checksum|allow-destructive|NEXT_PUBLIC_/.test(all),false);
});

// Dedicated suite: SEC_PRODUCTION_LOCAL=1. Full PG18 runner also registers it.
if(process.env.SEC_PRODUCTION_LOCAL==='1'||process.env.SEC_PROVISIONING_LOCAL==='1')test('D isolated PG18 production artifact and read-only preflight',{timeout:120000},async t=>{
  const name='investment-production-artifact-'+randomUUID().replaceAll('-','');
  const docker=(args:string[])=>execFileSync('docker',args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:60000}).trim();
  let created=false;let pools:Pool[]=[];
  try{
    docker(['run','-d','--name',name,'--label','investment-dashboard.stage=2c3hd','--publish','127.0.0.1::5432','--tmpfs','/var/lib/postgresql',
      '-e','POSTGRES_HOST_AUTH_METHOD=trust','-e','POSTGRES_DB=neondb','postgres:18@sha256:5a5a84b19854a9ffaa54082c166ff4ec27473a361e496e5ea167f298f2da9722']);created=true;
    let ready=false;for(let i=0;i<60;i++){try{docker(['exec',name,'pg_isready','-U','postgres','-d','neondb']);ready=true;break;}catch{}await new Promise(r=>setTimeout(r,500));}assert.ok(ready);
    const binding=docker(['port',name,'5432/tcp']);assert.match(binding,/^127\.0\.0\.1:\d+$/);
    const opts={host:'127.0.0.1',port:Number(binding.split(':')[1]),database:'neondb',max:2,connectionTimeoutMillis:1000,query_timeout:5000};
    const admin=new Pool({...opts,user:'postgres'}),m=new Pool({...opts,user:'investment_dashboard_migrator'}),r=new Pool({...opts,user:'investment_dashboard_runtime'});pools=[admin,m,r];
    const target={environment:'production' as const,databaseName:'neondb',databaseInstanceId:randomUUID()};
    await t.test('empty identity fails closed with no writes',async()=>{await assert.rejects(productionPreflight(admin,target));assert.equal((await admin.query("SELECT to_regclass('sec_admin.database_identity') AS object")).rows[0].object,null);});
    const provisioning=await readFile(new URL('./postgres/production/PRODUCTION_PROVISIONING_SQL_V1.sql',import.meta.url),'utf8');
    await t.test('reviewed bootstrap SQL syntax, roles and ownership',async()=>{await admin.query(provisioning.replaceAll('<LOCALLY_GENERATED_INSTANCE_UUID>',target.databaseInstanceId).replaceAll('<GENERATE_SECURE_PASSWORD_LOCALLY>',randomBytes(32).toString('hex')));});
    await t.test('read-only preflight before migration returns empty history',async()=>{const result=await productionPreflight(admin,target);assert.equal(result.migrationHistory.length,0);assert.equal(result.environment,'production');});
    for(const [kind,sql] of [['INSERT',"INSERT INTO sec_admin.database_identity VALUES(false,'test',gen_random_uuid(),now())"],['UPDATE',"UPDATE sec_admin.database_identity SET environment='test'"],['CREATE','CREATE TABLE sec_app.readonly_probe(id int)']] as const)
      await t.test(`server read-only refuses ${kind}`,async()=>{let code='';await assert.rejects(withReadOnlyTransaction(admin,async c=>{try{await c.query(sql);}catch(e){code=(e as {code:string}).code;throw e;}}));assert.equal(code,'25006');});
    await t.test('wrong target/malformed identity/unsafe roles fail closed',async()=>{
      await assert.rejects(productionPreflight(admin,{...target,databaseInstanceId:randomUUID()}));
      await admin.query("UPDATE sec_admin.database_identity SET environment='test'");try{await assert.rejects(productionPreflight(admin,target));}finally{await admin.query("UPDATE sec_admin.database_identity SET environment='production'");}
      await admin.query('ALTER ROLE investment_dashboard_runtime CREATEDB');try{await assert.rejects(productionPreflight(admin,target));}finally{await admin.query('ALTER ROLE investment_dashboard_runtime NOCREATEDB');}
      await admin.query('GRANT investment_dashboard_migrator TO investment_dashboard_runtime');try{await assert.rejects(productionPreflight(admin,target));}finally{await admin.query('REVOKE investment_dashboard_migrator FROM investment_dashboard_runtime');}
      await admin.query('GRANT CREATE ON DATABASE neondb TO investment_dashboard_runtime');try{await assert.rejects(productionPreflight(admin,target));}finally{await admin.query('REVOKE CREATE ON DATABASE neondb FROM investment_dashboard_runtime');}
      await admin.query('GRANT investment_dashboard_runtime TO investment_dashboard_migrator');try{await assert.rejects(productionPreflight(admin,target));}finally{await admin.query('REVOKE investment_dashboard_runtime FROM investment_dashboard_migrator');}
    });
    const approval={writeApproved:true,restoreCapabilityReviewed:true,restorePointReviewed:true,forwardFixReviewed:true};
    await t.test('restore/write prerequisites required',async()=>{await assert.rejects(executeProductionMigration(m,target,{...approval,restorePointReviewed:false}));});
    await t.test('formal execution entry and repeat idempotency',async()=>{await admin.query('GRANT CREATE ON DATABASE neondb TO investment_dashboard_migrator');try{assert.deepEqual(await executeProductionMigration(m,target,approval),{version:1,applied:1});assert.deepEqual(await executeProductionMigration(m,target,approval),{version:1,applied:0});}finally{await admin.query('REVOKE CREATE ON DATABASE neondb FROM investment_dashboard_migrator');}});
    await t.test('post-migration provenance/history ownership and runtime ingestion',async()=>{const result=await productionPreflight(admin,target);assert.equal(result.migrationHistory.length,1);const service=createSecIngestionService(new PostgresSecIngestionRepository(r,'sec_app'),{fetchResolvedForm4Document:async x=>envelope(form4Fixtures.purchase,x)});assert.equal((await service.ingestForm4Filing(input)).status,'CREATED');});
    await t.test('changed executed SQL refuses and rollback has no false success',async()=>{const {migrations}=await loadProductionMigrations();await assert.rejects(runSecMigrations(m,target,'sec_app',[{...migrations[0],sql:migrations[0].sql+' '}],'direct'));await assert.rejects(runSecMigrations(m,target,'sec_app',[...migrations,{version:2,name:'failure',sql:'CREATE TABLE partial_probe(id int); INSERT INTO absent_probe VALUES(1);'}],'direct'));assert.equal((await m.query("SELECT to_regclass('sec_app.partial_probe') AS object")).rows[0].object,null);});
  }finally{await Promise.all(pools.map(p=>p.end()));if(created)docker(['rm','-f',name]);}
});
