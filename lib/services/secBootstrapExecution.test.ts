import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID,randomBytes } from 'node:crypto';
import { execFileSync,spawnSync } from 'node:child_process';
import { Pool,type PoolClient } from 'pg';
import { executeBootstrap,bootstrapConfig,type BootstrapExecutionConfig } from './postgres/bootstrapExecution';
import { verifyBootstrap } from './postgres/bootstrapVerification';
import { loadBootstrapArtifact } from './postgres/productionBootstrap';
import { executeProductionMigration } from './postgres/productionMigration';
const fixtureConfig=():BootstrapExecutionConfig=>{const id=randomUUID();return {target:{environment:'production',databaseName:'neondb',databaseInstanceId:id},preparation:{environment:'production',database:'neondb',postgresMajor:18,instanceUuid:id,migratorPassword:randomBytes(32).toString('hex'),runtimePassword:randomBytes(32).toString('hex'),operatorTargetConfirmed:true,uuidStoredOutsideRepository:true,rolesReviewed:true,restoreCapabilityReviewed:true,restorePointReviewed:true,forwardFixReviewed:true}};};
test('H.1 isolated real CLI fails closed with no credentials, no env file loading',()=>{
  for(const [script,arg] of [['sec-production-bootstrap.ts','--execute'],['sec-production-bootstrap-verify.ts','--verify']]){
    const r=spawnSync(process.execPath,['node_modules/tsx/dist/cli.mjs','--conditions=react-server','scripts/'+script,arg],{encoding:'utf8',timeout:15000,env:{NODE_ENV:'test',PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,LOCALAPPDATA:process.env.LOCALAPPDATA}});
    assert.equal(r.status,1);assert.equal(r.stdout,'');assert.doesNotMatch(r.stderr,/MODULE_NOT_FOUND|postgresql:\/\/|password|neon\.tech/i);
    assert.equal(r.stderr.trim().split(/\r?\n/).length,1);
  }
});
test('H.1 exact action/checksum/test-instance approval, no truthy values',async()=>{
  const c=fixtureConfig(),m=(await loadBootstrapArtifact()).manifest;
  const url=new URL('postgresql://localhost/neondb');url.username='local_fixture';url.password=randomBytes(32).toString('hex');
  const env:Record<string,string>={DATABASE_DIRECT_URL:url.toString(),DATABASE_ENV:'production',DB_EXPECTED_DATABASE:'neondb',DB_EXPECTED_INSTANCE_ID:c.target.databaseInstanceId,
    BOOTSTRAP_MIGRATOR_PASSWORD:c.preparation.migratorPassword,BOOTSTRAP_RUNTIME_PASSWORD:c.preparation.runtimePassword,
    BOOTSTRAP_TARGET_ACCEPTED:'CONFIRMED',BOOTSTRAP_UUID_STORED:'CONFIRMED',BOOTSTRAP_ROLES_ACCEPTED:'CONFIRMED',BOOTSTRAP_RESTORE_ACCEPTED:'CONFIRMED',BOOTSTRAP_RECOVERY_POINT_ACCEPTED:'CONFIRMED',BOOTSTRAP_RECOVERY_PROCEDURE_ACCEPTED:'CONFIRMED'};
  for(const value of ['', 'true','YES','1','dummy'])await assert.rejects(bootstrapConfig({...env,PRODUCTION_BOOTSTRAP_WRITE_APPROVED:value}));
  const approval=`BOOTSTRAP_V2:${m.actions[0].sha256}:${c.target.databaseInstanceId}`; // Random local fixture identity only, never an operational approval.
  const valid={...env,PRODUCTION_BOOTSTRAP_WRITE_APPROVED:approval};assert.deepEqual((await bootstrapConfig(valid)).target,c.target);
  for(const patch of [{DATABASE_ENV:'test'},{DB_EXPECTED_DATABASE:'other'},{DB_EXPECTED_INSTANCE_ID:''},{DB_EXPECTED_INSTANCE_ID:'invalid'},{DATABASE_DIRECT_URL:url.toString().replace('localhost','local-pooler.invalid')},{BOOTSTRAP_UUID_STORED:'true'}])await assert.rejects(bootstrapConfig({...valid,...patch}));
});

if(process.env.SEC_PROVISIONING_LOCAL==='1')test('H.1 disposable real PG18 execution and complete READ ONLY verifier',{timeout:120000},async t=>{
  const name='investment-execution-'+randomUUID().replaceAll('-','');
  const docker=(args:string[])=>execFileSync('docker',args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:60000}).trim();
  let created=false;const pools:Pool[]=[];
  try{
    docker(['run','-d','--name',name,'--label','investment-dashboard.stage=2c3hh1','--publish','127.0.0.1::5432','--tmpfs','/var/lib/postgresql','-e','POSTGRES_HOST_AUTH_METHOD=trust','-e','POSTGRES_DB=neondb','postgres:18@sha256:5a5a84b19854a9ffaa54082c166ff4ec27473a361e496e5ea167f298f2da9722']);created=true;
    let ready=false;for(let i=0;i<60;i++){try{docker(['exec',name,'pg_isready','-U','postgres','-d','neondb']);ready=true;break;}catch{}await new Promise(r=>setTimeout(r,500));}assert.ok(ready);
    const binding=docker(['port',name,'5432/tcp']);assert.match(binding,/^127\.0\.0\.1:\d+$/);
    const opts={host:'127.0.0.1',port:Number(binding.split(':')[1]),database:'neondb',max:2,connectionTimeoutMillis:1000,query_timeout:5000,idleTimeoutMillis:1000};
    const admin=new Pool({...opts,user:'postgres'});pools.push(admin);const config=fixtureConfig();
    // Wrap real pg boundary for local failure injection. No production switches, fake database or transport.
    function injected(transform:(sql:string)=>string,afterCommit=false){let commits=0;
      const pool={connect:async()=>{const c=await admin.connect();return {query:async(sql:string,args?:unknown[])=>{
        if(sql==='COMMIT'){commits++;const r=await c.query(sql,args);if(afterCommit)throw Error('SIMULATED_ACK_LOSS');return r;}
        return c.query(transform(sql),args);
      },release:(broken?:boolean)=>c.release(broken)} as PoolClient;}} as Pool;
      return {pool,commits:()=>commits};
    }
    await t.test('blank target NOT_BOOTSTRAPPED without writing',async()=>{assert.deepEqual(await verifyBootstrap(admin,config.target),{status:'NOT_BOOTSTRAPPED'});});
    const phases=[['before identity','CREATE SCHEMA sec_admin;'],['after identity','CREATE ROLE investment_dashboard_migrator'],['during grants','GRANT CONNECT ON DATABASE neondb'],['before history','CREATE TABLE sec_admin.bootstrap_history'],['before completion row','INSERT INTO sec_admin.bootstrap_history']];
    for(const [label,marker] of phases)await t.test(`failure ${label} returns FAILED_ROLLED_BACK with no partial success`,async()=>{
      const p=injected(sql=>sql.includes(marker)?sql.replace(marker,()=>`SELECT 1/0;\n${marker}`):sql);
      assert.equal((await executeBootstrap(p.pool,config)).status,'FAILED_ROLLED_BACK');assert.equal(p.commits(),0);
      assert.equal((await verifyBootstrap(admin,config.target)).status,'NOT_BOOTSTRAPPED');
    });
    await t.test('failure after completion verification immediately before COMMIT rolls back all objects',async()=>{
      const p=injected(sql=>sql.includes('FROM pg_proc p')?'SELECT 1/0':sql);
      assert.equal((await executeBootstrap(p.pool,config)).status,'FAILED_ROLLED_BACK');assert.equal(p.commits(),0);
      assert.equal((await verifyBootstrap(admin,config.target)).status,'NOT_BOOTSTRAPPED');
    });
    await t.test('wrong database and unsupported PostgreSQL major are refused before bootstrap writes',async()=>{
      for(const sql of ["SELECT 'wrong_database' AS name,current_user AS admin,180000 AS version","SELECT current_database() AS name,current_user AS admin,170000 AS version"]){
        const p=injected(q=>q.startsWith('SELECT current_database()')?sql:q);
        assert.equal((await executeBootstrap(p.pool,config)).status,'FAILED_ROLLED_BACK');assert.equal(p.commits(),0);
        assert.equal((await verifyBootstrap(admin,config.target)).status,'NOT_BOOTSTRAPPED');
      }
      await assert.rejects(executeBootstrap(admin,{...config,target:{...config.target,databaseName:'wrong_database'}}));
    });
    await t.test('precommit disconnect ambiguity stays UNKNOWN; verifier proves no commit',async()=>{
      const p={connect:async()=>{const c=await admin.connect();return {query:async(sql:string,args?:unknown[])=>{
        if(sql.includes('CREATE SCHEMA sec_admin;')){c.release(true);throw Error('SIMULATED_DISCONNECT');}
        return c.query(sql,args);
      },release:()=>{}} as PoolClient;}} as Pool;
      // Rollback cannot be acknowledged after destroying this connection.
      assert.equal((await executeBootstrap(p,config)).status,'UNKNOWN_COMMIT');
      assert.equal((await verifyBootstrap(admin,config.target)).status,'NOT_BOOTSTRAPPED');
    });
    await t.test('after real COMMIT simulated ack loss is UNKNOWN, no retry; verifier finds committed',async()=>{
      const p=injected(sql=>sql,true);const result=await executeBootstrap(p.pool,config);
      assert.equal(result.status,'UNKNOWN_COMMIT');assert.equal(p.commits(),1);
      assert.equal((await verifyBootstrap(admin,config.target)).status,'VERIFIED');
      const output=JSON.stringify(result);for(const secret of [config.target.databaseInstanceId,config.preparation.runtimePassword,config.preparation.migratorPassword])assert.ok(!output.includes(secret));
    });
    await t.test('duplicate execution is refused with state intact',async()=>{assert.equal((await executeBootstrap(admin,config)).status,'FAILED_ROLLED_BACK');assert.equal((await verifyBootstrap(admin,config.target)).status,'VERIFIED');});
    await t.test('wrong UUID is IDENTITY_MISMATCH',async()=>{assert.equal((await verifyBootstrap(admin,{...config.target,databaseInstanceId:randomUUID()})).status,'IDENTITY_MISMATCH');});
    await t.test('history corruption is ARTIFACT_MISMATCH',async()=>{
      const old=(await admin.query('SELECT template_sha256 FROM sec_admin.bootstrap_history')).rows[0].template_sha256;
      await admin.query('UPDATE sec_admin.bootstrap_history SET template_sha256=$1',['0'.repeat(64)]);
      try{assert.equal((await verifyBootstrap(admin,config.target)).status,'ARTIFACT_MISMATCH');}finally{await admin.query('UPDATE sec_admin.bootstrap_history SET template_sha256=$1',[old]);}
    });
    await t.test('unexpected object is PARTIAL_BOOTSTRAP',async()=>{await admin.query('CREATE TABLE sec_app.unexpected(id int)');try{assert.equal((await verifyBootstrap(admin,config.target)).status,'PARTIAL_BOOTSTRAP');}finally{await admin.query('DROP TABLE sec_app.unexpected');}});
    await t.test('extra effective grant is PRIVILEGE_MISMATCH',async()=>{await admin.query('GRANT CREATE ON DATABASE neondb TO investment_dashboard_runtime');try{assert.equal((await verifyBootstrap(admin,config.target)).status,'PRIVILEGE_MISMATCH');}finally{await admin.query('REVOKE CREATE ON DATABASE neondb FROM investment_dashboard_runtime');}});
    await t.test('wrong default ACL owner context / blanket grant is refused',async()=>{
      await admin.query('ALTER DEFAULT PRIVILEGES FOR ROLE investment_dashboard_migrator GRANT SELECT ON TABLES TO investment_dashboard_runtime');
      try{assert.equal((await verifyBootstrap(admin,config.target)).status,'PRIVILEGE_MISMATCH');}finally{await admin.query('ALTER DEFAULT PRIVILEGES FOR ROLE investment_dashboard_migrator REVOKE SELECT ON TABLES FROM investment_dashboard_runtime');}
      assert.equal((await verifyBootstrap(admin,config.target)).status,'VERIFIED');
    });
    const runtime=new Pool({...opts,user:'investment_dashboard_runtime',password:config.preparation.runtimePassword});const migrator=new Pool({...opts,user:'investment_dashboard_migrator',password:config.preparation.migratorPassword});pools.push(runtime,migrator);
    for(const [label,sql] of [['CREATE schema','CREATE SCHEMA forbidden'],['ALTER ownership','ALTER SCHEMA sec_app OWNER TO investment_dashboard_runtime'],['CREATE ROLE','CREATE ROLE forbidden'],['ALTER ROLE','ALTER ROLE investment_dashboard_migrator CREATEDB'],['SET ROLE admin','SET ROLE postgres'],['SET ROLE migrator','SET ROLE investment_dashboard_migrator'],['identity UPDATE',"UPDATE sec_admin.database_identity SET environment='test'"],['history DELETE','DELETE FROM sec_admin.bootstrap_history'],['migration DDL','CREATE TABLE sec_app.forbidden(id int)']])await t.test(`runtime actually refuses ${label}`,async()=>{await assert.rejects(runtime.query(sql),(e:unknown)=>(e as {code:string}).code==='42501');});
    await t.test('future objects prove table/sequence/function default denials',async()=>{
      await migrator.query("CREATE TABLE sec_app.future_test(id bigint GENERATED ALWAYS AS IDENTITY); CREATE FUNCTION sec_app.future_test_fn() RETURNS int LANGUAGE sql AS 'SELECT 1'");
      try{for(const sql of ['SELECT * FROM sec_app.future_test',"SELECT nextval('sec_app.future_test_id_seq')",'SELECT sec_app.future_test_fn()'])await assert.rejects(runtime.query(sql),(e:unknown)=>(e as {code:string}).code==='42501');}
      finally{await migrator.query('DROP TABLE sec_app.future_test; DROP FUNCTION sec_app.future_test_fn()');}
    });
    await t.test('READ ONLY verifier is PostgreSQL-enforced',async()=>{
      const c=await admin.connect();let observed=false;
      const pool={connect:async()=>({query:async(sql:string,args?:unknown[])=>{if(sql.startsWith('SELECT current_database()')){assert.equal((await c.query('SHOW transaction_read_only')).rows[0].transaction_read_only,'on');observed=true;}return c.query(sql,args);},release:(b?:boolean)=>c.release(b)} as PoolClient)} as Pool;
      assert.equal((await verifyBootstrap(pool,config.target)).status,'VERIFIED');assert.ok(observed);
    });
    await t.test('PostgreSQL actually refuses a write inside verifier transaction',async()=>{
      const c=await admin.connect();let code:string|undefined;
      const pool={connect:async()=>({query:async(sql:string,args?:unknown[])=>{
        if(sql.startsWith('SELECT current_database()'))try{return await c.query("UPDATE sec_admin.database_identity SET environment='test'");}catch(e){code=(e as {code:string}).code;throw e;}
        return c.query(sql,args);
      },release:(b?:boolean)=>c.release(b)} as PoolClient)} as Pool;
      assert.equal((await verifyBootstrap(pool,config.target)).status,'UNKNOWN');assert.equal(code,'25006');
      assert.equal((await verifyBootstrap(admin,config.target)).status,'VERIFIED');
    });
    await t.test('runtime verifier refuses non-admin identity as PRIVILEGE_MISMATCH',async()=>{assert.equal((await verifyBootstrap(runtime,config.target)).status,'PRIVILEGE_MISMATCH');});
    await t.test('verifier query permission error remains UNKNOWN, not absence',async()=>{
      // A real restricted PostgreSQL connection, rather than a manufactured error.
      const c=await runtime.connect();
      const pool={connect:async()=>({query:async(sql:string,args?:unknown[])=>c.query(sql.startsWith('SELECT current_database()')?'SELECT * FROM pg_authid':sql,args),release:(b?:boolean)=>c.release(b)} as PoolClient)} as Pool;
      assert.equal((await verifyBootstrap(pool,config.target)).status,'UNKNOWN');
    });
    await t.test('verifier connection failure remains UNKNOWN, not absence',async()=>{
      const unavailable=new Pool({...opts,port:1,user:'postgres'});
      try{assert.equal((await verifyBootstrap(unavailable,config.target)).status,'UNKNOWN');}finally{await unavailable.end();}
    });
    await t.test('intended migrator scope and runtime necessary queries remain usable',async()=>{
      for(const sql of ['CREATE ROLE forbidden',"UPDATE sec_admin.database_identity SET environment='test'"])await assert.rejects(migrator.query(sql),(e:unknown)=>(e as {code:string}).code==='42501');
      await admin.query('GRANT CREATE ON DATABASE neondb TO investment_dashboard_migrator');
      try{assert.equal((await executeProductionMigration(migrator,config.target,{writeApproved:true,restoreCapabilityReviewed:true,restorePointReviewed:true,forwardFixReviewed:true})).applied,1);}finally{await admin.query('REVOKE CREATE ON DATABASE neondb FROM investment_dashboard_migrator');}
      const c=await runtime.connect();try{await c.query('BEGIN');await c.query('SELECT * FROM sec_app.sec_filings');await c.query('UPDATE sec_app.sec_filings SET updated_at=now() WHERE false');await c.query('DELETE FROM sec_app.sec_transactions WHERE false');await c.query('SELECT * FROM sec_app.sec_ingestion_attempts');await c.query('ROLLBACK');}finally{c.release();}
    });
    await t.test('success classification on second blank local database instance',async()=>{
      // Local cleanup only, explicitly enumerated objects; no production/reset CLI path.
      await admin.query('DROP SCHEMA sec_app CASCADE; DROP SCHEMA sec_admin CASCADE; DROP OWNED BY investment_dashboard_runtime,investment_dashboard_migrator; DROP ROLE investment_dashboard_runtime; DROP ROLE investment_dashboard_migrator');
      const next=fixtureConfig();assert.equal((await executeBootstrap(admin,next)).status,'SUCCESS_COMMITTED');assert.equal((await verifyBootstrap(admin,next.target)).status,'VERIFIED');
    });
  }finally{await Promise.all(pools.map(p=>p.end()));if(created)docker(['rm','-f',name]);}
});
