import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { Pool } from 'pg';
import { prepareBootstrap, loadBootstrapArtifact, validateBootstrapManifest, verifyBootstrapArtifact, type BootstrapPreparation } from './postgres/productionBootstrap';
import { productionPreflight } from './postgres/productionPreflight';
import { productionDiscovery } from './postgres/productionDiscovery';
import { executeProductionMigration } from './postgres/productionMigration';
import { migrationChecksum } from './postgres/migrationRunner';

const localInput = (): BootstrapPreparation => ({environment:'production',database:'neondb',postgresMajor:18,
  instanceUuid:randomUUID(),migratorPassword:randomBytes(32).toString('hex'),runtimePassword:randomBytes(32).toString('hex'),
  operatorTargetConfirmed:true,uuidStoredOutsideRepository:true,rolesReviewed:true,
  restoreCapabilityReviewed:true,restorePointReviewed:true,forwardFixReviewed:true});
test('F exact bootstrap artifact checksum, ordering and separate approval', async()=>{
  const a=await loadBootstrapArtifact();assert.equal(migrationChecksum(a.sql),a.manifest.actions[0].sha256);
  assert.equal(a.manifest.requiresSeparateWriteApproval,true);
  assert.doesNotMatch(a.sql,/CREATE TABLE sec_filings|sec_migration_history/);
  assert.match(a.sql,/transaction_timeout='30s'/);assert.match(a.sql,/bootstrap_history/);
  assert.throws(()=>verifyBootstrapArtifact(a.manifest,a.sql+' '),{message:'Bootstrap checksum refused'});
  for(const patch of [{environment:'test'},{requiresSeparateWriteApproval:false},{actions:[]},
    {actions:[{...a.manifest.actions[0],filename:'../identity.sql'}]}])assert.throws(()=>validateBootstrapManifest({...a.manifest,...patch}));
});
for(const [name,patch] of [
  ['wrong environment',{environment:'test'}],['wrong database',{database:'other'}],['wrong major',{postgresMajor:17}],
  ['missing UUID',{instanceUuid:''}],['malformed UUID',{instanceUuid:'not-uuid'}],
  ['missing operator gate',{operatorTargetConfirmed:false}],['unrecorded UUID',{uuidStoredOutsideRepository:false}],
  ['unreviewed roles',{rolesReviewed:false}],['unreviewed restore capability',{restoreCapabilityReviewed:false}],
  ['unreviewed restore point',{restorePointReviewed:false}],['unreviewed recovery',{forwardFixReviewed:false}],
  ['unsafe password literal',{runtimePassword:"' SQL injection"}],
] as const)test(`F preparation refuses ${name} without any database API`,async()=>{
  await assert.rejects(prepareBootstrap({...localInput(),...patch} as BootstrapPreparation),{message:'Bootstrap preparation refused'});
});
test('F preparation never authorizes write and requires distinct local secrets',async()=>{
  const input=localInput(),p=await prepareBootstrap(input);assert.equal(p.productionWriteAuthorized,false);
  await assert.rejects(prepareBootstrap({...input,runtimePassword:input.migratorPassword}));
  assert.ok(!p.sql.includes('<LOCALLY_GENERATED_INSTANCE_UUID>'));
});

if(process.env.SEC_PROVISIONING_LOCAL==='1')test('F disposable PG18 bootstrap readiness rehearsal',{timeout:120000},async t=>{
  const name='investment-bootstrap-'+randomUUID().replaceAll('-','');
  const docker=(args:string[])=>execFileSync('docker',args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:60000}).trim();
  let created=false;const pools:Pool[]=[];
  try{
    docker(['run','-d','--name',name,'--label','investment-dashboard.stage=2c3hf','--publish','127.0.0.1::5432','--tmpfs','/var/lib/postgresql',
      '-e','POSTGRES_HOST_AUTH_METHOD=trust','-e','POSTGRES_DB=neondb','postgres:18@sha256:5a5a84b19854a9ffaa54082c166ff4ec27473a361e496e5ea167f298f2da9722']);created=true;
    let ready=false;for(let i=0;i<60;i++){try{docker(['exec',name,'pg_isready','-U','postgres','-d','neondb']);ready=true;break;}catch{}await new Promise(r=>setTimeout(r,500));}assert.ok(ready);
    const binding=docker(['port',name,'5432/tcp']);assert.match(binding,/^127\.0\.0\.1:\d+$/);
    const opts={host:'127.0.0.1',port:Number(binding.split(':')[1]),database:'neondb',max:1,connectionTimeoutMillis:1000,query_timeout:5000,idleTimeoutMillis:1000};
    const admin=new Pool({...opts,user:'postgres'});pools.push(admin);
    const input=localInput(),plan=await prepareBootstrap(input),target={environment:'production' as const,databaseName:'neondb',databaseInstanceId:input.instanceUuid};
    const scalar=async(sql:string)=>(await admin.query(sql)).rows[0];
    await t.test('blank DB is NOT_BOOTSTRAPPED before any write',async()=>{assert.equal((await productionDiscovery(admin,{environment:'production',databaseName:'neondb'})).status,'NOT_BOOTSTRAPPED');});
    await t.test('failure before COMMIT atomically rolls back identity roles schemas and terminal audit',async()=>{
      await assert.rejects(admin.query(plan.sql.replace('COMMIT;','SELECT 1/0;\nCOMMIT;')),(e:unknown)=>(e as {code?:string}).code==='22012');
      await admin.query('ROLLBACK');
      assert.equal((await scalar("SELECT to_regnamespace('sec_admin') AS n")).n,null);
      assert.equal((await scalar("SELECT count(*)::int AS n FROM pg_roles WHERE rolname IN ('investment_dashboard_runtime','investment_dashboard_migrator')")).n,0);
    });
    await t.test('interrupted pre-COMMIT connection rolls back, never leaves terminal success',async()=>{
      const c=await admin.connect();
      try{await c.query(plan.sql.replace('COMMIT;',''));}finally{c.release(true);}
      // The new connection waits for rollback completion; no forced reset or adoption.
      let absent=false;
      for(let i=0;i<20;i++){
        if((await scalar("SELECT to_regnamespace('sec_admin') AS n")).n===null){absent=true;break;}
        await new Promise(r=>setTimeout(r,25));
      }
      assert.ok(absent);
      assert.equal((await scalar("SELECT count(*)::int AS n FROM pg_roles WHERE rolname IN ('investment_dashboard_runtime','investment_dashboard_migrator')")).n,0);
    });
    await t.test('retry after rollback bootstraps once and same UUID verifies',async()=>{
      await admin.query(plan.sql);assert.equal((await productionPreflight(admin,target)).status,'VERIFIED');
      const h=await scalar('SELECT version,template_sha256,status FROM sec_admin.bootstrap_history');
      assert.deepEqual(h,{version:2,template_sha256:plan.manifest.actions[0].sha256,status:'COMPLETE'});
      assert.equal((await scalar("SELECT to_regclass('sec_app.sec_filings') AS n")).n,null);
    });
    await t.test('duplicate bootstrap refused, no overwrite or implicit success',async()=>{
      await assert.rejects(admin.query(plan.sql));await admin.query('ROLLBACK');
      assert.equal((await scalar('SELECT count(*)::int AS n FROM sec_admin.bootstrap_history')).n,1);
    });
    await t.test('wrong UUID verification fails, committed state recovered by exact identity and checksum',async()=>{
      await assert.rejects(productionPreflight(admin,{...target,databaseInstanceId:randomUUID()}));
      assert.equal((await productionPreflight(admin,target)).status,'VERIFIED');
      assert.equal((await scalar('SELECT template_sha256 FROM sec_admin.bootstrap_history')).template_sha256,plan.manifest.actions[0].sha256);
    });
    await t.test('SQL target guard refuses actual wrong database and leaves no identity',async()=>{
      await admin.query('CREATE DATABASE wrong_target');const wrong=new Pool({...opts,database:'wrong_target',user:'postgres'});pools.push(wrong);
      await assert.rejects(wrong.query(plan.sql));await wrong.query('ROLLBACK');
      assert.equal((await wrong.query("SELECT to_regnamespace('sec_admin') AS n")).rows[0].n,null);
    });
    const runtime=new Pool({...opts,user:'investment_dashboard_runtime',password:input.runtimePassword});
    const migrator=new Pool({...opts,user:'investment_dashboard_migrator',password:input.migratorPassword});pools.push(runtime,migrator);
    await t.test('restricted role flags, memberships and ownership',async()=>{
      const roles=await admin.query("SELECT rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls,rolinherit,rolcanlogin FROM pg_roles WHERE rolname IN ('investment_dashboard_runtime','investment_dashboard_migrator')");
      assert.equal(roles.rows.length,2);for(const r of roles.rows)assert.deepEqual(Object.values(r),[false,false,false,false,false,false,true]);
      assert.equal((await scalar("SELECT count(*)::int AS n FROM pg_auth_members WHERE member IN ('investment_dashboard_runtime'::regrole,'investment_dashboard_migrator'::regrole)")).n,0);
      assert.equal((await scalar("SELECT pg_get_userbyid(nspowner) AS owner FROM pg_namespace WHERE nspname='sec_app'")).owner,'investment_dashboard_migrator');
      assert.equal((await scalar("SELECT pg_get_userbyid(relowner) AS owner FROM pg_class WHERE oid='sec_admin.bootstrap_history'::regclass")).owner,'postgres');
    });
    for(const [label,sql] of [
      ['schema creation','CREATE SCHEMA forbidden'],['role creation','CREATE ROLE forbidden'],
      ['ownership alteration','ALTER SCHEMA sec_app OWNER TO investment_dashboard_runtime'],
      ['identity mutation',"UPDATE sec_admin.database_identity SET environment='test'"],
      ['bootstrap history mutation','DELETE FROM sec_admin.bootstrap_history'],
    ])await t.test(`runtime refuses ${label}`,async()=>{await assert.rejects(runtime.query(sql),(e:unknown)=>(e as {code?:string}).code==='42501');});
    await t.test('runtime cannot enter formal migration',async()=>{await assert.rejects(executeProductionMigration(runtime,target,{writeApproved:true,restoreCapabilityReviewed:true,restorePointReviewed:true,forwardFixReviewed:true}));});
    await t.test('migrator cannot manage admin identity roles or unrelated schemas',async()=>{
      for(const sql of ['CREATE ROLE forbidden',"UPDATE sec_admin.database_identity SET environment='test'",'CREATE TABLE public.forbidden(id int)','CREATE SCHEMA forbidden'])await assert.rejects(migrator.query(sql),(e:unknown)=>(e as {code?:string}).code==='42501');
    });
    await t.test('migrator defaults deny future runtime tables sequences and function EXECUTE',async()=>{
      await migrator.query("CREATE TABLE sec_app.future_table(id bigint GENERATED ALWAYS AS IDENTITY); CREATE FUNCTION sec_app.future_fn() RETURNS int LANGUAGE sql AS 'SELECT 1'");
      for(const sql of ['SELECT * FROM sec_app.future_table','INSERT INTO sec_app.future_table DEFAULT VALUES','SELECT sec_app.future_fn()'])await assert.rejects(runtime.query(sql));
      const p=await scalar("SELECT has_sequence_privilege('investment_dashboard_runtime','sec_app.future_table_id_seq','USAGE') AS allowed");assert.equal(p.allowed,false);
      await migrator.query('DROP TABLE sec_app.future_table; DROP FUNCTION sec_app.future_fn()');
    });
    await t.test('intended application migration succeeds with bounded CREATE window, grants are exact',async()=>{
      await admin.query('GRANT CREATE ON DATABASE neondb TO investment_dashboard_migrator');
      try{assert.equal((await executeProductionMigration(migrator,target,{writeApproved:true,restoreCapabilityReviewed:true,restorePointReviewed:true,forwardFixReviewed:true})).applied,1);}
      finally{await admin.query('REVOKE CREATE ON DATABASE neondb FROM investment_dashboard_migrator');}
      for(const [table,allowed] of [['sec_filings',['SELECT','INSERT','UPDATE']],['sec_transactions',['SELECT','INSERT','DELETE']],['sec_ingestion_attempts',['SELECT','INSERT']]] as const)
        for(const priv of ['SELECT','INSERT','UPDATE','DELETE','TRUNCATE'])assert.equal((await admin.query('SELECT has_table_privilege($1,$2,$3) AS allowed',['investment_dashboard_runtime','sec_app.'+table,priv])).rows[0].allowed,(allowed as readonly string[]).includes(priv));
    });
  }finally{await Promise.all(pools.map(p=>p.end()));if(created)docker(['rm','-f',name]);}
});
