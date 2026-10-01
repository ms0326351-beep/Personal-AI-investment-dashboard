import test from 'node:test';
import assert from 'node:assert/strict';
import { Pool, type PoolClient } from 'pg';
import { registerSecAdapterContract, secContractInput as input, secContractEnvelope as envelope } from './testing/secIngestionContract';
import { createSecPostgresHarness } from './testing/secPostgresHarness';
import { PostgresSecIngestionRepository, secPostgresSchema } from './postgres/secPostgresRepository';
import { createSecIngestionService } from './secIngestionService';
import { form4Fixtures, form4Xml, transactionXml } from '../utils/fixtures/secForm4Xml';

if(process.env.SEC_PG_TEST_ENABLED!=='1' && process.env.SEC_PG_CLOUD_TEST_ENABLED!=='1'){
  test('PostgreSQL integration requires disposable Docker runner (no fake DB)',{skip:true},()=>{});
}else{
  registerSecAdapterContract('PostgreSQL',createSecPostgresHarness);
  const run=(name:string,fn:(h:Awaited<ReturnType<typeof createSecPostgresHarness>>)=>Promise<void>)=>test(`PostgreSQL integration: ${name}`,async()=>{
    const h=await createSecPostgresHarness();try{await fn(h);}finally{await h.dispose();}
  });
  const service=(h:Awaited<ReturnType<typeof createSecPostgresHarness>>,xml=form4Fixtures.purchase)=>
    createSecIngestionService(h.repository,{fetchResolvedForm4Document:async m=>envelope(xml,m)},{audit:h.audit,now:()=> '2026-10-01T00:00:00Z'});

  run('ten distinct backend connections race, one filing and one row, no orphan',async h=>{
    const workers=Array.from({length:10},()=>new Pool({...h.pool.options,max:1}));
    try{
      const pids=await Promise.all(workers.map(async p=>(await p.query<{pid:number}>('SELECT pg_backend_pid() AS pid')).rows[0].pid));
      assert.equal(new Set(pids).size,10);
      let arrived=0,release!:()=>void;const barrier=new Promise<void>(resolve=>{release=resolve;});
      const rs=await Promise.all(workers.map(p=>createSecIngestionService(new PostgresSecIngestionRepository(p,h.schema),{
        fetchResolvedForm4Document:async m=>{arrived++;if(arrived===10)release();await barrier;return envelope(form4Fixtures.purchase,m);},
      }).ingestForm4Filing(input)));
      assert.equal(rs.filter(r=>r.status==='CREATED').length,1);assert.equal(rs.filter(r=>r.status==='ALREADY_EXISTS').length,9);
      assert.deepEqual(await h.stats(),{filings:1,transactions:1});
      const orphans=await h.pool.query(`SELECT count(*)::int AS n FROM ${h.quoted}.sec_transactions t
        LEFT JOIN ${h.quoted}.sec_filings f ON f.accession_number=t.filing_accession WHERE f.accession_number IS NULL`);
      assert.equal(orphans.rows[0].n,0);
    }finally{await Promise.all(workers.map(p=>p.end()));}
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
    const client=await h.pool.connect();try{
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
        await client.query('CREATE TEMP TABLE numeric_value_probe (value numeric)');
        const value='999999999999999999999.1234567890123456789';
        await client.query('INSERT INTO numeric_value_probe VALUES ($1::numeric)',[value]);
        const r=await client.query('SELECT value::text AS value FROM numeric_value_probe');
        assert.equal(r.rows[0].value,value);
        await client.query('DROP TABLE numeric_value_probe');
      }finally{client.release();}
    });
    run('cloud idle eviction reconnects with a new backend',async h=>{
      const pool=new Pool({...h.pool.options,max:1,idleTimeoutMillis:100});
      try{
        const first=await pool.query('SELECT pg_backend_pid() AS pid');
        await new Promise(resolve=>setTimeout(resolve,250));
        const second=await pool.query('SELECT pg_backend_pid() AS pid');
        assert.notEqual(first.rows[0].pid,second.rows[0].pid);
        assert.equal((await pool.query('SELECT 1 AS n')).rows[0].n,1);
      }finally{await pool.end();}
    });
    run('cloud destroyed client is replaced and migration schema cleanup verified',async h=>{
      const pool=new Pool({...h.pool.options,max:1});
      try{
        const client=await pool.connect();
        const first=await client.query('SELECT pg_backend_pid() AS pid');
        client.release(true);
        const second=await pool.query('SELECT pg_backend_pid() AS pid');
        assert.notEqual(first.rows[0].pid,second.rows[0].pid);
      }finally{await pool.end();}
      await h.pool.query(`DROP SCHEMA ${h.quoted} CASCADE`);
      assert.equal((await h.pool.query('SELECT count(*)::int AS n FROM pg_namespace WHERE nspname=$1',[h.schema])).rows[0].n,0);
      // Harness finalizer must remain valid after the explicit cleanup assertion.
      await h.pool.query(`CREATE SCHEMA ${h.quoted}`);
    });
  }
}
