import test from 'node:test';
import assert from 'node:assert/strict';
import { Pool } from 'pg';
import { randomBytes,randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { runSecMigrations,migrationChecksum } from './postgres/migrationRunner';
import { verifyDatabaseIdentity } from './postgres/databaseSafety';
import { runtimeDatabaseConfig,createRuntimeDatabase } from './postgres/runtimeDatabase';
import { PostgresSecIngestionRepository,PostgresSecIngestionAudit } from './postgres/secPostgresRepository';
import { createSecIngestionService } from './secIngestionService';
import { secContractInput as input,secContractEnvelope as envelope } from './testing/secIngestionContract';
import { form4Fixtures } from '../utils/fixtures/secForm4Xml';

// Registered only by the isolated runner. No ambient URLs, fake DB or network provider.
if(process.env.SEC_PROVISIONING_LOCAL==='1')test('PG18 production provisioning rehearsal',{timeout:120000},async t=>{
  const port=Number(process.env.SEC_PROVISIONING_PORT),container=process.env.SEC_PROVISIONING_CONTAINER??'';
  assert.ok(Number.isInteger(port)&&port>1024&&port<65536);
  assert.match(container,/^investment-provisioning-[a-f0-9]{32}$/);
  const migrator='investment_dashboard_migrator',runtime='investment_dashboard_runtime';
  const password=randomBytes(32).toString('hex'); // Process-only random local secret; never logged.
  const options={host:'127.0.0.1',port,database:'neondb',max:2,connectionTimeoutMillis:500,query_timeout:2000,idleTimeoutMillis:1000};
  const admin=new Pool({...options,user:'postgres'}),m=new Pool({...options,user:migrator,password}),r=new Pool({...options,user:runtime,password});
  const target={environment:'production' as const,databaseInstanceId:randomUUID(),databaseName:'neondb'};
  const row=async(pool:Pool,sql:string)=>(await pool.query(sql)).rows[0];
  const rejected=async(sql:string)=>assert.rejects(r.query(sql),(e:unknown)=>!!e&&typeof e==='object'&&'code'in e&&e.code==='42501');
  try{
    await t.test('PG18/neondb read-only preflight',async()=>{assert.equal((await row(admin,'SELECT current_database() AS name')).name,'neondb');assert.equal(Math.floor(Number((await row(admin,'SHOW server_version_num')).server_version_num)/10000),18);});
    await admin.query('BEGIN');
    try{
      await admin.query(await readFile(new URL('./postgres/identity.sql',import.meta.url),'utf8'));
      await admin.query('INSERT INTO sec_admin.database_identity(environment,database_instance_id) VALUES ($1,$2)',['production',target.databaseInstanceId]);
      for(const role of[migrator,runtime])await admin.query(`CREATE ROLE ${role} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${password}'`);
      await admin.query(`REVOKE ALL ON DATABASE neondb FROM PUBLIC; GRANT CONNECT ON DATABASE neondb TO ${migrator},${runtime}; REVOKE ALL ON SCHEMA public FROM PUBLIC;
        CREATE SCHEMA sec_app AUTHORIZATION ${migrator}; GRANT USAGE ON SCHEMA sec_app TO ${runtime};
        GRANT USAGE ON SCHEMA sec_admin TO ${migrator},${runtime}; GRANT SELECT ON sec_admin.database_identity TO ${migrator},${runtime}`);
      await admin.query('COMMIT');
    }catch(e){await admin.query('ROLLBACK');throw e;}
    await t.test('identity production and migrator ownership',async()=>{await verifyDatabaseIdentity(r,target);assert.equal((await row(admin,"SELECT pg_get_userbyid(nspowner) AS owner FROM pg_namespace WHERE nspname='sec_app'")).owner,migrator);});
    await t.test('runtime flags and memberships least privilege',async()=>{const flags=await admin.query('SELECT rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls FROM pg_roles WHERE rolname=$1',[runtime]);assert.deepEqual(Object.values(flags.rows[0]),[false,false,false,false,false]);assert.equal((await row(admin,`SELECT count(*)::int AS n FROM pg_auth_members WHERE member='${runtime}'::regrole`)).n,0);});
    await m.query(`ALTER DEFAULT PRIVILEGES FOR ROLE ${migrator} REVOKE ALL ON TABLES FROM PUBLIC;
      ALTER DEFAULT PRIVILEGES FOR ROLE ${migrator} REVOKE ALL ON SEQUENCES FROM PUBLIC;
      ALTER DEFAULT PRIVILEGES FOR ROLE ${migrator} REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC`);
    // Explicit rehearsal-only derivation. Original Local/test migration never becomes Production manifest.
    const sql=await readFile(new URL('./postgres/migrations/001_sec_ingestion.sql',import.meta.url),'utf8');
    const manifest=[{version:1,name:'rehearsal_only_sec_ingestion',sql},{version:2,name:'rehearsal_only_order_probe',sql:'CREATE TABLE ordering_probe(id integer PRIMARY KEY);'}];
    console.log('Rehearsal-only source checksum: '+migrationChecksum(sql));
    await t.test('schema CREATE window, ordering and repeat idempotency',async()=>{
      await admin.query(`GRANT CREATE ON DATABASE neondb TO ${migrator}`);
      try{assert.deepEqual(await runSecMigrations(m,target,'sec_app',[...manifest].reverse(),'direct'),{version:2,applied:2});assert.deepEqual(await runSecMigrations(m,target,'sec_app',manifest,'direct'),{version:2,applied:0});await rejected('CREATE TABLE sec_app.window_probe(id int)');}
      finally{await admin.query(`REVOKE CREATE ON DATABASE neondb FROM ${migrator}`);}
      assert.equal((await row(admin,`SELECT has_database_privilege('${migrator}','neondb','CREATE') AS allowed`)).allowed,false);
    });
    await t.test('checksum mutation hard fails and no false history',async()=>{await assert.rejects(runSecMigrations(m,target,'sec_app',[{...manifest[0],sql:sql+' '},manifest[1]],'direct'));assert.equal((await row(m,'SELECT count(*)::int AS n FROM sec_app.sec_migration_history')).n,2);});
    await t.test('failing migration rolls back DDL/history',async()=>{await assert.rejects(runSecMigrations(m,target,'sec_app',[...manifest,{version:3,name:'failure_probe',sql:'CREATE TABLE half_applied(id int); INSERT INTO absent_table VALUES(1);'}],'direct'));assert.equal((await row(m,"SELECT to_regclass('sec_app.half_applied') AS object")).object,null);assert.equal((await row(m,'SELECT count(*)::int AS n FROM sec_app.sec_migration_history')).n,2);});
    await m.query(`GRANT SELECT,INSERT,UPDATE ON sec_app.sec_filings TO ${runtime}; GRANT SELECT,INSERT,DELETE ON sec_app.sec_transactions TO ${runtime}; GRANT SELECT,INSERT ON sec_app.sec_ingestion_attempts TO ${runtime}`);
    await t.test('exact table ACL matrix and all migration object owners',async()=>{for(const [table,allowed] of [['sec_filings',['SELECT','INSERT','UPDATE']],['sec_transactions',['SELECT','INSERT','DELETE']],['sec_ingestion_attempts',['SELECT','INSERT']],['sec_schema_versions',[]],['sec_migration_history',[]]] as const){for(const privilege of ['SELECT','INSERT','UPDATE','DELETE','TRUNCATE'])assert.equal((await admin.query('SELECT has_table_privilege($1,$2,$3) AS allowed',[runtime,'sec_app.'+table,privilege])).rows[0].allowed,(allowed as readonly string[]).includes(privilege));}const owners=await admin.query("SELECT pg_get_userbyid(c.relowner) AS owner FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='sec_app'");assert.ok(owners.rows.length>0);assert.ok(owners.rows.every(x=>x.owner===migrator));});
    const repo=new PostgresSecIngestionRepository(r,'sec_app'),audit=new PostgresSecIngestionAudit(r,'sec_app');
    const service=createSecIngestionService(repo,{fetchResolvedForm4Document:async x=>envelope(form4Fixtures.purchase,x)},{audit});
    await t.test('normal ingestion, atomic audit, idempotency without sequence grants',async()=>{assert.equal((await service.ingestForm4Filing(input)).status,'CREATED');assert.equal((await service.ingestForm4Filing(input)).status,'ALREADY_EXISTS');assert.equal((await audit.getAttempts(input.accessionNumber)).length,2);assert.ok(await repo.getFilingByAccession(input.accessionNumber));assert.equal((await row(admin,`SELECT has_sequence_privilege('${runtime}','sec_app.sec_ingestion_attempts_id_seq','USAGE') AS allowed`)).allowed,false);});
    await t.test('failed-record retry uses required UPDATE and child DELETE',async()=>{const failedInput={...input,accessionNumber:'0000012345-26-000003'};let failed=true;const s=createSecIngestionService(repo,{fetchResolvedForm4Document:async x=>{if(failed)throw Error('SIMULATED_TRANSPORT_FAILURE');return envelope(form4Fixtures.purchase,x);}},{audit});assert.equal((await s.ingestForm4Filing(failedInput)).status,'FAILED');failed=false;assert.equal((await s.ingestForm4Filing(failedInput)).status,'CREATED');});
    await t.test('runtime BEGIN/COMMIT/ROLLBACK and required DML',async()=>{const c=await r.connect();try{await c.query('BEGIN');await c.query('UPDATE sec_app.sec_filings SET updated_at=now()');await c.query('DELETE FROM sec_app.sec_transactions WHERE false');await c.query('ROLLBACK');await c.query('BEGIN');await c.query('COMMIT');}finally{c.release();}});
    for(const [name,statement] of[
      ['CREATE ROLE','CREATE ROLE forbidden_role'],['CREATE DATABASE','CREATE DATABASE forbidden_database'],['DROP DATABASE','DROP DATABASE permission_victim'],
      ['DROP SCHEMA','DROP SCHEMA sec_app CASCADE'],['CREATE SCHEMA','CREATE SCHEMA forbidden_schema'],['ALTER OWNER','ALTER TABLE sec_app.sec_filings OWNER TO investment_dashboard_runtime'],
      ['CREATE EXTENSION','CREATE EXTENSION hstore WITH SCHEMA sec_app'],['CREATE TABLE','CREATE TABLE sec_app.forbidden_table(id int)'],['ALTER TABLE','ALTER TABLE sec_app.sec_filings ADD COLUMN forbidden int'],
      ['DROP TABLE','DROP TABLE sec_app.sec_filings CASCADE'],['TRUNCATE','TRUNCATE sec_app.sec_filings CASCADE'],['migration history mutation','DELETE FROM sec_app.sec_migration_history'],
      ['identity mutation',"UPDATE sec_admin.database_identity SET environment='test'"],['filing DELETE','DELETE FROM sec_app.sec_filings'],['audit DELETE','DELETE FROM sec_app.sec_ingestion_attempts'],
      ['privileged SET ROLE','SET ROLE investment_dashboard_migrator'],['destructive fixture reset','DROP SCHEMA sec_admin CASCADE'],
    ]){if(name==='DROP DATABASE')await admin.query('CREATE DATABASE permission_victim');await t.test(`runtime refuses ${name}`,()=>rejected(statement));}
    await t.test('runtime migration runner cannot mutate history',async()=>{await assert.rejects(runSecMigrations(r,target,'sec_app',manifest,'direct'));assert.equal((await row(m,'SELECT count(*)::int AS n FROM sec_app.sec_migration_history')).n,2);});
    await t.test('production cleanup and env=test mismatch refused',async()=>{await assert.rejects(verifyDatabaseIdentity(r,target,true));await assert.rejects(verifyDatabaseIdentity(r,{...target,environment:'test'},true));});
    await t.test('per-owner defaults deny future runtime DML; explicit grant only',async()=>{
      await m.query('CREATE TABLE sec_app.future_migrator(id int); CREATE FUNCTION sec_app.future_fn() RETURNS int LANGUAGE sql AS \'SELECT 1\'');
      await admin.query('CREATE TABLE sec_app.future_admin(id int)');
      await rejected('INSERT INTO sec_app.future_migrator VALUES(1)');await rejected('INSERT INTO sec_app.future_admin VALUES(1)');await rejected('SELECT sec_app.future_fn()');
      // Transaction-local demonstration, no permanent blanket runtime grants.
      const c=await admin.connect();try{await c.query('BEGIN');await c.query(`ALTER DEFAULT PRIVILEGES FOR ROLE ${migrator} IN SCHEMA sec_app GRANT SELECT ON TABLES TO ${runtime}`);await c.query(`SET LOCAL ROLE ${migrator}`);await c.query('CREATE TABLE sec_app.default_owner_probe(id int)');assert.equal((await c.query(`SELECT has_table_privilege('${runtime}','sec_app.default_owner_probe','SELECT') AS allowed`)).rows[0].allowed,true);await c.query('RESET ROLE');await c.query('CREATE TABLE sec_app.default_admin_probe(id int)');assert.equal((await c.query(`SELECT has_table_privilege('${runtime}','sec_app.default_admin_probe','SELECT') AS allowed`)).rows[0].allowed,false);await c.query('ROLLBACK');}finally{c.release();}
      assert.equal((await row(admin,`SELECT has_table_privilege('${runtime}','sec_app.future_admin','SELECT') AS allowed`)).allowed,false);
    });
    await t.test('COMMIT succeeded, simulated ambiguous caller, retry does not duplicate',async()=>{const record=await repo.getFilingByAccession(input.accessionNumber);assert.ok(record);const next={...input,accessionNumber:'0000012345-26-000004'};await createSecIngestionService(repo,{fetchResolvedForm4Document:async x=>envelope(form4Fixtures.purchase,x)}).ingestForm4Filing(next);const stored=await repo.getFilingByAccession(next.accessionNumber);assert.ok(stored);await assert.rejects((async()=>{await repo.saveIngestion(stored);throw Error('SIMULATED_ACK_UNKNOWN');})());assert.equal((await repo.saveIngestion(stored)).outcome,'ALREADY_EXISTS');assert.equal((await r.query('SELECT count(*)::int AS n FROM sec_app.sec_filings WHERE accession_number=$1',[next.accessionNumber])).rows[0].n,1);});
    await t.test('bounded runtime pool simulation acquire/statement timeout release/reconnect',async()=>{
      const p=new Pool({...options,user:runtime,password,max:1});try{assert.equal(p.totalCount,0);const c=await p.connect();try{await assert.rejects(p.connect());await c.query('BEGIN');await c.query("SET LOCAL statement_timeout='100ms'");await assert.rejects(c.query('SELECT pg_sleep(1)'),(e:unknown)=>!!e&&typeof e==='object'&&'code'in e&&e.code==='57014');await c.query('ROLLBACK');}finally{c.release(true);}await p.query('SELECT 1');assert.equal(p.waitingCount,0);}finally{await p.end();}
      const u=new URL('postgresql://fixture-pooler.invalid/neondb');u.username=runtime;u.password=password;const config=runtimeDatabaseConfig({DATABASE_URL:u.toString(),DATABASE_ENV:'production',DB_EXPECTED_INSTANCE_ID:target.databaseInstanceId});assert.equal(config.options.max,2);assert.equal(config.options.ssl.rejectUnauthorized,true);const factory=createRuntimeDatabase({});await factory.close();await assert.rejects(factory.getPool());
    });
    await t.test('logical backup destructive simulation isolated restore',async()=>{
      const docker=(args:string[])=>execFileSync('docker',args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:20000});
      const counts=async(pool:Pool)=>(await row(pool,'SELECT (SELECT count(*)::int FROM sec_app.sec_filings) AS filings,(SELECT count(*)::int FROM sec_app.sec_transactions) AS transactions,(SELECT count(*)::int FROM sec_app.sec_ingestion_attempts) AS audit'));
      const baseline=await counts(admin),snapshots=await admin.query('SELECT snapshot FROM sec_app.sec_filings ORDER BY accession_number'),children=await admin.query('SELECT row_data FROM sec_app.sec_transactions ORDER BY transaction_identity'),attempts=await admin.query('SELECT attempt FROM sec_app.sec_ingestion_attempts ORDER BY id'),started=performance.now();
      const dump=docker(['exec',container,'pg_dump','-U','postgres','-d','neondb','--no-owner','--no-acl']); // In-memory only, no role passwords.
      await admin.query('DELETE FROM sec_app.sec_transactions; DELETE FROM sec_app.sec_filings');assert.equal((await counts(admin)).filings,0);
      await admin.query('CREATE DATABASE rehearsal_restore');const restored=new Pool({...options,user:'postgres',database:'rehearsal_restore'});
      try{try{execFileSync('docker',['exec','-i',container,'psql','-U','postgres','-d','rehearsal_restore','-v','ON_ERROR_STOP=1'],{input:dump,stdio:['pipe','pipe','pipe'],timeout:20000});}catch{throw Error('Logical restore failed; dump withheld');}assert.deepEqual(await counts(restored),baseline);assert.deepEqual((await restored.query('SELECT snapshot FROM sec_app.sec_filings ORDER BY accession_number')).rows,snapshots.rows);assert.deepEqual((await restored.query('SELECT row_data FROM sec_app.sec_transactions ORDER BY transaction_identity')).rows,children.rows);assert.deepEqual((await restored.query('SELECT attempt FROM sec_app.sec_ingestion_attempts ORDER BY id')).rows,attempts.rows);assert.equal((await row(restored,'SELECT environment FROM sec_admin.database_identity')).environment,'production');assert.deepEqual((await restored.query('SELECT version,name,checksum FROM sec_app.sec_migration_history')).rows,(await admin.query('SELECT version,name,checksum FROM sec_app.sec_migration_history')).rows);console.log('Logical restore RPO: baseline snapshot; elapsed_ms='+Math.round(performance.now()-started));}finally{await restored.end();}
    });
  }finally{await Promise.all([r.end(),m.end(),admin.end()]);}
});
