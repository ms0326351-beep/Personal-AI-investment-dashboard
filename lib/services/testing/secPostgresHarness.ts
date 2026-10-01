import { Pool } from 'pg';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { SecAdapterContractHarness } from './secIngestionContract';
import { PostgresSecIngestionRepository, PostgresSecIngestionAudit, secPostgresSchema } from '../postgres/secPostgresRepository';
import { SecRepositoryWriteError } from '../../types/secIngestion';

/** Refuses any host/URL/credentials supplied by ambient PostgreSQL environment.
 * Runner marker is checked before CREATE/DROP or any test mutations.
 */
export async function createSecPostgresHarness(){
  const cloud=process.env.SEC_PG_CLOUD_TEST_ENABLED==='1';
  if(!cloud && process.env.SEC_PG_TEST_ENABLED!=='1')throw new Error('Local PostgreSQL tests not enabled');
  const port=Number(process.env.SEC_PG_TEST_PORT),marker=process.env.SEC_PG_TEST_MARKER;
  if(!cloud && (!Number.isInteger(port)||port<1024||port>65535||!marker||!/^[a-f0-9-]{36}$/.test(marker)))throw new Error('Invalid local test environment');
  const pool=cloud ? await (await import('./secCloudPostgres')).cloudTestPool() : new Pool({host:'127.0.0.1',port,user:'postgres',password:'',database:'sec_contract_test',ssl:false,
    max:12,connectionTimeoutMillis:3000,idleTimeoutMillis:1000,application_name:'sec-stage2c3d-test'});
  const schema=(cloud?'sec_cloud_test_':'sec_test_')+randomUUID().replaceAll('-',''),quoted=secPostgresSchema(schema);
  let schemaCreated=false;
  try{
    if(!cloud){
    const result=await pool.query<{marker:string;database:string}>('SELECT marker,current_database() AS database FROM public.sec_local_test_marker');
    if(result.rows.length!==1||result.rows[0].marker!==marker||result.rows[0].database!=='sec_contract_test')throw new Error('Test database marker mismatch');
    }
    const sql=await readFile(new URL('../postgres/migrations/001_sec_ingestion.sql',import.meta.url),'utf8');
    const connection=await pool.connect();
    try{
      await connection.query('BEGIN');await connection.query(`CREATE SCHEMA ${quoted}`);schemaCreated=true;
      await connection.query(`SET LOCAL search_path TO ${quoted}`);await connection.query(sql);await connection.query('COMMIT');
    }catch(error){await connection.query('ROLLBACK');schemaCreated=false;throw error;}finally{connection.release();}
    const base=new PostgresSecIngestionRepository(pool,schema),audit=new PostgresSecIngestionAudit(pool,schema);
    let fault:'child_failure'|'rollback'|'ack_timeout'|null=null;
    const harness:SecAdapterContractHarness={
      repository:{getFilingByAccession:a=>base.getFilingByAccession(a),saveIngestion:async record=>{
        const current=fault;fault=null;
        if(current==='child_failure')await pool.query(`ALTER TABLE ${quoted}.sec_transactions ADD CONSTRAINT injected_child_failure CHECK (row_ordinal<>2)`);
        if(current==='rollback')await pool.query(`ALTER TABLE ${quoted}.sec_filings ADD CONSTRAINT injected_filing_failure CHECK (false) NOT VALID`);
        try{
          const saved=await base.saveIngestion(record);
          // Real DB COMMIT has completed. This is application acknowledgement loss,
          // not an assertion that TCP COMMIT-response loss was reproduced.
          if(current==='ack_timeout')throw new SecRepositoryWriteError('UNKNOWN');
          return saved;
        }finally{
          if(current==='child_failure')await pool.query(`ALTER TABLE ${quoted}.sec_transactions DROP CONSTRAINT injected_child_failure`);
          if(current==='rollback')await pool.query(`ALTER TABLE ${quoted}.sec_filings DROP CONSTRAINT injected_filing_failure`);
        }
      }},audit,attempts:a=>audit.getAttempts(a),
      stats:async()=>{
        const r=await pool.query<{filings:number;transactions:number}>(`SELECT
          (SELECT count(*)::int FROM ${quoted}.sec_filings) AS filings,
          (SELECT count(*)::int FROM ${quoted}.sec_transactions) AS transactions`);return r.rows[0];
      },faultNextSave:kind=>{fault=kind;},
      dispose:async()=>{try{await pool.query(`DROP SCHEMA ${quoted} CASCADE`);}finally{await pool.end();}},
    };
    return {...harness,pool,schema,quoted,base,sql};
  }catch(error){
    try{if(schemaCreated)await pool.query(`DROP SCHEMA ${quoted} CASCADE`);}finally{await pool.end();}throw error;
  }
}
