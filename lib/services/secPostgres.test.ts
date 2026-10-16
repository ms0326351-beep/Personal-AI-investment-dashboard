import test from 'node:test';
import assert from 'node:assert/strict';
import { Pool, type PoolClient } from 'pg';
import { registerSecAdapterContract, secContractInput as input, secContractEnvelope as envelope } from './testing/secIngestionContract';
import { createSecPostgresHarness } from './testing/secPostgresHarness';
import { PostgresSecIngestionRepository, secPostgresSchema } from './postgres/secPostgresRepository';
import { createSecIngestionService } from './secIngestionService';
import { form4Fixtures, form4Xml, transactionXml } from '../utils/fixtures/secForm4Xml';
import { cloudTrace, observeCloudPool, endCloudPool } from './testing/secCloudDiagnostics';
import { runSecMigrations,migrationChecksum } from './postgres/migrationRunner';
import { verifyDatabaseIdentity } from './postgres/databaseSafety';

if(process.env.SEC_PG_TEST_ENABLED!=='1' && process.env.SEC_PG_CLOUD_TEST_ENABLED!=='1'){
  test('PostgreSQL integration requires disposable Docker runner (no fake DB)',{skip:true},()=>{});
}else{
  const cloud=process.env.SEC_PG_CLOUD_TEST_ENABLED==='1';
  registerSecAdapterContract('PostgreSQL',createSecPostgresHarness,{timeout:cloud?90000:undefined,trace:cloud?cloudTrace:undefined});
  const run=(name:string,fn:(h:Awaited<ReturnType<typeof createSecPostgresHarness>>)=>Promise<void>)=>test(`PostgreSQL integration: ${name}`,{timeout:cloud?90000:undefined},async()=>{
    if(cloud)cloudTrace(`START ${name}`);
    const h=await createSecPostgresHarness();try{await fn(h);}finally{if(cloud)cloudTrace(`CLEANUP ${name} before`);await h.dispose();if(cloud)cloudTrace(`CLEANUP ${name} after`);}
    if(cloud)cloudTrace(`DONE ${name}`);
  });
  const service=(h:Awaited<ReturnType<typeof createSecPostgresHarness>>,xml=form4Fixtures.purchase)=>
    createSecIngestionService(h.repository,{fetchResolvedForm4Document:async m=>envelope(xml,m)},{audit:h.audit,now:()=> '2026-10-01T00:00:00Z'});

  run('G atomic terminal audit commits exactly once with filing',async h=>{
    const s=createSecIngestionService(h.base,{fetchResolvedForm4Document:async m=>envelope(form4Fixtures.purchase,m)},{audit:h.audit});
    const result=await s.ingestForm4Filing(input);assert.equal(result.status,'CREATED');assert.equal(result.auditStatus,'RECORDED');
    assert.equal((await h.attempts(input.accessionNumber)).length,1);
    await s.ingestForm4Filing(input);assert.equal((await h.attempts(input.accessionNumber)).length,2);
  });
  run('G terminal audit failure rolls back filing and transactions',async h=>{
    await h.admin.query(`ALTER TABLE ${h.quoted}.sec_ingestion_attempts ADD CONSTRAINT reject_terminal CHECK(false) NOT VALID`);
    const s=createSecIngestionService(h.base,{fetchResolvedForm4Document:async m=>envelope(form4Fixtures.purchase,m)},{audit:h.audit});
    const result=await s.ingestForm4Filing(input);assert.equal(result.persistenceOutcome,'NOT_COMMITTED');
    assert.deepEqual(await h.stats(),{filings:0,transactions:0});assert.equal((await h.attempts(input.accessionNumber)).length,0);
  });
  run('G migration ordered repeat/checksum history and rewrite refusal',async h=>{
    const schema=h.schema+'m',quoted=secPostgresSchema(schema);
    const manifest=[{version:1,name:'first',sql:'CREATE TABLE probe(id integer PRIMARY KEY);'},
      {version:2,name:'second',sql:'ALTER TABLE probe ADD COLUMN label text;'}];
    try{
      assert.deepEqual(await runSecMigrations(h.admin,h.target,schema,[...manifest].reverse(),'direct'),{version:2,applied:2});
      assert.deepEqual(await runSecMigrations(h.admin,h.target,schema,manifest,'direct'),{version:2,applied:0});
      const rows=await h.admin.query(`SELECT checksum FROM ${quoted}.sec_migration_history ORDER BY version`);
      assert.equal(rows.rows[0].checksum,migrationChecksum(manifest[0].sql));
      await assert.rejects(runSecMigrations(h.admin,h.target,schema,[{...manifest[0],sql:manifest[0].sql+' '},manifest[1]],'direct'));
      assert.equal((await h.admin.query(`SELECT count(*)::int AS n FROM ${quoted}.sec_migration_history`)).rows[0].n,2);
    }finally{await h.assertSafe();await h.admin.query(`DROP SCHEMA IF EXISTS ${quoted} CASCADE`);}
  });
  run('G migration failing DDL rolls back schema and history',async h=>{
    const schema=h.schema+'m';
    await assert.rejects(runSecMigrations(h.admin,h.target,schema,[{version:1,name:'invalid',sql:'CREATE TABLE probe(id integer); INSERT INTO missing_table VALUES(1);'}],'direct'));
    assert.equal((await h.admin.query('SELECT count(*)::int AS n FROM pg_namespace WHERE nspname=$1',[schema])).rows[0].n,0);
  });
  run('G migration environment mismatch and pooled mode refuse before mutation',async h=>{
    const schema=h.schema+'m',manifest=[{version:1,name:'probe',sql:'CREATE TABLE probe(id integer);'}];
    await assert.rejects(runSecMigrations(h.admin,{...h.target,environment:'production'},schema,manifest,'direct'));
    await assert.rejects(runSecMigrations(h.admin,h.target,schema,manifest,'pooled'));
    assert.equal((await h.admin.query('SELECT count(*)::int AS n FROM pg_namespace WHERE nspname=$1',[schema])).rows[0].n,0);
  });
  run('G migration refuses implicit adoption of untracked schema',async h=>{
    await assert.rejects(runSecMigrations(h.admin,h.target,h.schema,[{version:1,name:'probe',sql:'CREATE TABLE probe(id integer);'}],'direct'));
    assert.equal((await h.admin.query('SELECT to_regclass($1) AS table',[`${h.schema}.sec_migration_history`])).rows[0].table,null);
  });
  run('G identity hard stop is enforced against real database',async h=>{
    await verifyDatabaseIdentity(h.pool,h.target,true);
    await assert.rejects(verifyDatabaseIdentity(h.pool,{...h.target,databaseInstanceId:'00000000-0000-0000-0000-000000000000'},true));
    await assert.rejects(verifyDatabaseIdentity(h.pool,{...h.target,environment:'production'},true));
  });
  // Only the disposable local DB may simulate production/malformed identity.
  // Changes are transaction-local and rolled back before harness cleanup.
  if(!cloud){
    run('G atomic audit child failure has no committed filing or child rows',async h=>{
      await h.admin.query(`ALTER TABLE ${h.quoted}.sec_transactions ADD CONSTRAINT reject_second CHECK(row_ordinal<>2)`);
      const s=createSecIngestionService(h.base,{fetchResolvedForm4Document:async m=>envelope(form4Fixtures.multiple,m)});
      assert.equal((await s.ingestForm4Filing(input)).persistenceOutcome,'NOT_COMMITTED');
      assert.deepEqual(await h.stats(),{filings:0,transactions:0});assert.equal((await h.attempts(input.accessionNumber)).length,0);
    });
    run('G atomic audit preserves partial snapshot and hash conflict',async h=>{
      let xml=form4Xml({extra:'<derivativeTable><derivativeTransaction/></derivativeTable>'});
      const s=createSecIngestionService(h.base,{fetchResolvedForm4Document:async m=>envelope(xml,m)},{audit:h.audit});
      const first=await s.ingestForm4Filing(input);assert.equal(first.state,'PARTIAL');assert.equal(first.auditStatus,'RECORDED');
      const before=await h.base.getFilingByAccession(input.accessionNumber);
      xml=form4Fixtures.purchase;
      assert.equal((await s.ingestForm4Filing(input,{revalidate:true})).status,'INTEGRITY_CONFLICT');
      assert.deepEqual(await h.base.getFilingByAccession(input.accessionNumber),before);
      assert.equal((await h.attempts(input.accessionNumber)).length,2);
    });
    run('G real transaction timeout terminates connection without orphan rows',async h=>{
      const client=await h.pool.connect();
      try{
        await client.query('BEGIN');await client.query("SET LOCAL transaction_timeout='100ms'");
        await client.query(`CREATE TABLE ${h.quoted}.transaction_timeout_probe(id integer)`);
        await assert.rejects(client.query('SELECT pg_sleep(1)'));
      }finally{client.release(true);}
      assert.equal((await h.pool.query('SELECT to_regclass($1) AS table',[`${h.schema}.transaction_timeout_probe`])).rows[0].table,null);
      assert.equal((await service(h).ingestForm4Filing(input)).status,'CREATED');
      assert.equal((await service(h).ingestForm4Filing(input)).status,'ALREADY_EXISTS');
    });
    for(const [name,environment,requested,allowed] of [
      ['test to test','test','test',true],['development to development','development','development',true],
      ['test to production','production','test',false],['production destructive cleanup','production','production',false],
      ['missing identity','missing','test',false],['malformed identity','malformed','test',false],
      ['migration environment mismatch','development','test',false],
    ] as const)run(`G real marker ${name}`,async h=>{
      const client=await h.admin.connect();
      try{
        await client.query('BEGIN');
        if(environment==='missing')await client.query('DELETE FROM sec_admin.database_identity');
        else if(environment==='malformed'){
          await client.query('ALTER TABLE sec_admin.database_identity ALTER COLUMN created_at DROP NOT NULL');
          await client.query('UPDATE sec_admin.database_identity SET created_at=NULL');
        }else await client.query('UPDATE sec_admin.database_identity SET environment=$1',[environment]);
        const verify=()=>verifyDatabaseIdentity(client,{...h.target,environment:requested},true);
        if(allowed)await verify();else{
          await assert.rejects(verify);
          for(const command of [`DROP SCHEMA ${h.quoted} CASCADE`,`TRUNCATE ${h.quoted}.sec_filings CASCADE`]){
            await assert.rejects((async()=>{await verify();await client.query(command);})());
          }
          assert.equal((await client.query('SELECT count(*)::int AS n FROM pg_namespace WHERE nspname=$1',[h.schema])).rows[0].n,1);
        }
      }finally{try{await client.query('ROLLBACK');}finally{client.release();}}
      await h.assertSafe();
    });
    run('G statement timeout releases client and rolls back half-written rows',async h=>{
      const client=await h.pool.connect();
      try{
        await client.query('BEGIN');await client.query("SET LOCAL statement_timeout='100ms'");
        await client.query(`CREATE TABLE ${h.quoted}.timeout_probe(id integer)`);
        await assert.rejects(client.query('SELECT pg_sleep(1)'),e=>!!e && typeof e==='object' && 'code' in e && e.code==='57014');
        await client.query('ROLLBACK');
      }finally{client.release();}
      assert.equal((await h.pool.query('SELECT to_regclass($1) AS table',[`${h.schema}.timeout_probe`])).rows[0].table,null);
      assert.equal(h.pool.waitingCount,0);
      assert.equal((await service(h).ingestForm4Filing(input)).status,'CREATED');
      assert.equal((await service(h).ingestForm4Filing(input)).status,'ALREADY_EXISTS');
    });
  }

  run('ten distinct backend connections race, one filing and one row, no orphan',async h=>{
    const workers=Array.from({length:10},()=>new Pool({...h.pool.options,max:1}));
    if(cloud)workers.forEach(observeCloudPool);
    try{
      const pinned:PoolClient[]=[];
      const probes=await Promise.allSettled(workers.map(async p=>{
        if(process.env.SEC_PG_CLOUD_TEST_MODE!=='pooled')return (await p.query<{pid:number}>('SELECT pg_backend_pid() AS pid')).rows[0].pid;
        const client=await p.connect();pinned.push(client);await client.query('BEGIN');
        return (await client.query<{pid:number}>('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      })).finally(async()=>{
        const cleanup=await Promise.allSettled(pinned.map(async c=>{let broken=false;try{await c.query('ROLLBACK');}catch{broken=true;}finally{c.release(broken);}}));
        assert.ok(cleanup.every(r=>r.status==='fulfilled'));
      });
      assert.ok(probes.every(r=>r.status==='fulfilled'));
      const pids=probes.map(r=>{assert.equal(r.status,'fulfilled');return r.value;});
      assert.equal(new Set(pids).size,10);
      let arrived=0,release!:()=>void,reject!: (error:Error)=>void;
      const barrier=new Promise<void>((resolve,fail)=>{release=resolve;reject=fail;});
      void barrier.catch(()=>{});
      const timer=setTimeout(()=>reject(new Error('Test worker barrier timeout')),30000);
      const settled=await Promise.allSettled(workers.map(p=>createSecIngestionService(new PostgresSecIngestionRepository(p,h.schema),{
        fetchResolvedForm4Document:async m=>{arrived++;if(arrived===10)release();await barrier;return envelope(form4Fixtures.purchase,m);},
      }).ingestForm4Filing(input))).finally(()=>clearTimeout(timer));
      assert.ok(settled.every(r=>r.status==='fulfilled'));
      const rs=settled.map(r=>{assert.equal(r.status,'fulfilled');return r.value;});
      assert.equal(rs.filter(r=>r.status==='CREATED').length,1);assert.equal(rs.filter(r=>r.status==='ALREADY_EXISTS').length,9);
      assert.deepEqual(await h.stats(),{filings:1,transactions:1});
      const orphans=await h.pool.query(`SELECT count(*)::int AS n FROM ${h.quoted}.sec_transactions t
        LEFT JOIN ${h.quoted}.sec_filings f ON f.accession_number=t.filing_accession WHERE f.accession_number IS NULL`);
      assert.equal(orphans.rows[0].n,0);
    }finally{await Promise.all(workers.map(p=>cloud?endCloudPool(p):p.end()));}
  });
  run('database accession uniqueness rejects direct duplicate inserts',async h=>{
    await service(h).ingestForm4Filing(input);
    await assert.rejects(h.pool.query(`INSERT INTO ${h.quoted}.sec_filings SELECT * FROM ${h.quoted}.sec_filings`),{code:'23505'});
    assert.equal((await h.stats()).filings,1);
  });
  run('database transaction uniqueness rejects duplicate identity and ordinal',async h=>{
    await service(h).ingestForm4Filing(input);
    await assert.rejects(h.pool.query(`INSERT INTO ${h.quoted}.sec_transactions SELECT * FROM ${h.quoted}.sec_transactions`),{code:'23505'});
    assert.equal((await h.stats()).transactions,1);
  });
  run('database foreign key prevents orphan transactions',async h=>{
    await service(h).ingestForm4Filing(input);
    const other='0000012345-26-000099';
    await assert.rejects(h.pool.query(`INSERT INTO ${h.quoted}.sec_transactions
      SELECT $1,'sec:'||$1||':non_derivative:1',table_kind,row_ordinal,shares,price,ownership_after,transaction_value,row_data
      FROM ${h.quoted}.sec_transactions`,[other]),{code:'23503'});
    assert.deepEqual(await h.stats(),{filings:1,transactions:1});
  });
  for(const [shares,price] of [['0.1','0.2'],['0.3','0.300000000000000000001'],
    ['9007199254740993.125','1234567890.12345678901234567890123456789'],['100000000000000000000.00001','0.00000000000000000001']]){
    run(`NUMERIC round-trip ${shares} / ${price}`,async h=>{
      const xml=form4Xml({transactions:transactionXml({shares,price})});
      const r=await service(h,xml).ingestForm4Filing(input);assert.equal(r.status,'CREATED');
      const values=await h.pool.query<{shares:string;price:string;transaction_value:null}>(`SELECT shares,price,transaction_value FROM ${h.quoted}.sec_transactions`);
      assert.equal(typeof values.rows[0].shares,'string');assert.equal(values.rows[0].shares,shares);assert.equal(values.rows[0].price,price);
      assert.equal(values.rows[0].transaction_value,null);
      assert.equal((await h.base.getFilingByAccession(input.accessionNumber))?.transactions[0].persistenceAmounts.price,price);
    });
  }
  run('money columns are NUMERIC, without fixed scale rounding',async h=>{
    const r=await h.pool.query<{column_name:string;data_type:string;numeric_scale:number|null}>(`SELECT column_name,data_type,numeric_scale
      FROM information_schema.columns WHERE table_schema=$1 AND table_name='sec_transactions'
      AND column_name IN ('shares','price','ownership_after','transaction_value')`,[h.schema]);
    assert.equal(r.rows.length,4);assert.ok(r.rows.every(c=>c.data_type==='numeric'&&c.numeric_scale===null));
  });
  run('second-child constraint failure actually occurs after first child INSERT, then rollback',async h=>{
    // PostgreSQL sequence increments survive rollback: proves first row was inserted.
    await h.pool.query(`CREATE SEQUENCE ${h.quoted}.child_probe;
      CREATE FUNCTION ${h.quoted}.probe_child() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN PERFORM nextval('${h.schema}.child_probe'); RETURN NEW; END; $$;
      CREATE TRIGGER child_probe BEFORE INSERT ON ${h.quoted}.sec_transactions FOR EACH ROW EXECUTE FUNCTION ${h.quoted}.probe_child()`);
    h.faultNextSave('child_failure');const r=await service(h,form4Fixtures.multiple).ingestForm4Filing(input);
    assert.equal(r.persistenceOutcome,'NOT_COMMITTED');assert.deepEqual(await h.stats(),{filings:0,transactions:0});
    const probe=await h.pool.query(`SELECT last_value::text AS value FROM ${h.quoted}.child_probe`);assert.equal(probe.rows[0].value,'2');
  });
  run('adapter JavaScript exception after BEGIN rolls back before publishing',async h=>{
    await service(h).ingestForm4Filing(input);const original=await h.base.getFilingByAccession(input.accessionNumber);assert.ok(original);
    // Inject at driver query boundary, with real BEGIN/ROLLBACK and real clients.
    const originals=new Map<PoolClient,PoolClient['query']>();
    let failed=false;
    const instrument=(client:PoolClient)=>{
      if(originals.has(client))return;
      const query=client.query;originals.set(client,query);
      client.query=new Proxy(query,{apply:(target,thisArg,args)=>{
        if(typeof args[0]==='string'&&args[0].startsWith('INSERT INTO')&&!failed){failed=true;throw new Error('Injected adapter exception');}
        return Reflect.apply(target,thisArg,args);
      }});
    };
    h.pool.on('acquire',instrument);
    try{
      const candidate={...original,accessionNumber:'0000012345-26-000077',filingKey:'sec:0000012345-26-000077'};
      // Use service to rebuild correct accession-scoped metadata/rows.
      const r=await service(h).ingestForm4Filing({...input,accessionNumber:candidate.accessionNumber});
      assert.equal(r.persistenceOutcome,'NOT_COMMITTED');assert.equal(failed,true);assert.deepEqual(await h.stats(),{filings:1,transactions:1});
    }finally{
      h.pool.off('acquire',instrument);
      for(const [client,query] of originals)client.query=query;
    }
  });
  run('schema setup is repeatable and version recorded once',async h=>{
    const client=await h.admin.connect();try{
      await client.query('BEGIN');await client.query(`SET LOCAL search_path TO ${h.quoted}`);await client.query(h.sql);await client.query('COMMIT');
    }finally{client.release();}
    const r=await h.pool.query(`SELECT count(*)::int AS n FROM ${h.quoted}.sec_schema_versions WHERE version=1`);assert.equal(r.rows[0].n,1);
  });
  run('schema identifier rejects injection/traversal',async()=>{
    for(const name of ['public; DROP TABLE x','../x','"public"',''])assert.throws(()=>secPostgresSchema(name));
  });
  if(process.env.SEC_PG_CLOUD_TEST_ENABLED==='1'){
    run('cloud TLS, server version and precise large value boundary',async h=>{
      const info=await h.pool.query('SELECT current_setting(\'server_version\') AS version');
      process.stdout.write('Cloud PostgreSQL version: '+info.rows[0].version+'; TLS: verified\n');
      // Temporary probe only: this does not invent a filing transaction value.
      const client=await h.pool.connect();
      try{
        assert.equal((await import('./testing/secCloudPostgres')).verifiedCloudTls(client),true);
        const pooled=process.env.SEC_PG_CLOUD_TEST_MODE==='pooled';
        if(pooled)await client.query('BEGIN');
        await client.query('CREATE TEMP TABLE numeric_value_probe (value numeric)'+(pooled?' ON COMMIT DROP':''));
        const value='999999999999999999999.1234567890123456789';
        await client.query('INSERT INTO numeric_value_probe VALUES ($1::numeric)',[value]);
        const r=await client.query('SELECT value::text AS value FROM numeric_value_probe');
        assert.equal(r.rows[0].value,value);
        if(pooled)await client.query('COMMIT');else await client.query('DROP TABLE numeric_value_probe');
      }finally{try{if(process.env.SEC_PG_CLOUD_TEST_MODE==='pooled')await client.query('ROLLBACK');}finally{client.release();}}
    });
    run('cloud idle eviction reconnects with a new backend',async h=>{
      const pool=new Pool({...h.pool.options,max:1,idleTimeoutMillis:100});
      observeCloudPool(pool);
      try{
        if(process.env.SEC_PG_CLOUD_TEST_MODE==='pooled'){
          const first=await pool.connect();await first.query('SELECT 1');first.release();
          await new Promise(resolve=>setTimeout(resolve,250));assert.equal(pool.totalCount,0);
          const second=await pool.connect();assert.notEqual(first,second);await second.query('SELECT 1');second.release();
          assert.equal(pool.waitingCount,0);assert.equal(pool.idleCount,1);return;
        }
        const first=await pool.query('SELECT pg_backend_pid() AS pid');
        await new Promise(resolve=>setTimeout(resolve,250));
        const second=await pool.query('SELECT pg_backend_pid() AS pid');
        assert.notEqual(first.rows[0].pid,second.rows[0].pid);
        assert.equal((await pool.query('SELECT 1 AS n')).rows[0].n,1);
      }finally{await endCloudPool(pool);}
    });
    run('cloud destroyed client is replaced and migration schema cleanup verified',async h=>{
      const pool=new Pool({...h.pool.options,max:1});
      observeCloudPool(pool);
      try{
        const client=await pool.connect();
        const first=await client.query('SELECT pg_backend_pid() AS pid');
        client.release(true);
        const replacement=await pool.connect();
        try{
          const second=await replacement.query('SELECT pg_backend_pid() AS pid');
          if(process.env.SEC_PG_CLOUD_TEST_MODE==='pooled')assert.notEqual(client,replacement);
          else assert.notEqual(first.rows[0].pid,second.rows[0].pid);
        }finally{replacement.release();}
        assert.equal(pool.waitingCount,0);assert.equal(pool.idleCount,1);
      }finally{await endCloudPool(pool);}
      await h.assertSafe();
      await h.admin.query(`DROP SCHEMA ${h.quoted} CASCADE`);
      assert.equal((await h.pool.query('SELECT count(*)::int AS n FROM pg_namespace WHERE nspname=$1',[h.schema])).rows[0].n,0);
      // Harness finalizer must remain valid after the explicit cleanup assertion.
      await h.admin.query(`CREATE SCHEMA ${h.quoted}`);
    });
  }
}
