import 'server-only';
import type { Pool, PoolClient } from 'pg';
import { SecRepositoryWriteError, type SecIngestionRecord, type SecIngestionRepository, type SecIngestionSaveResult,
  type SecIngestionAudit, type SecIngestionAttempt } from '../../types/secIngestion';
import { secFilingKey } from '../../utils/secEndpoints';
import { isIngested, validateSecIngestionSnapshot } from '../secIngestionRepository';
import { safeSecIngestionAttempt } from '../secIngestionAudit';

/** Schema identifier is controlled by caller, never taken from filing metadata. */
export function secPostgresSchema(name:string):string {
  if(!/^[a-z][a-z0-9_]{0,62}$/.test(name))throw new Error('Invalid PostgreSQL schema');
  return '"'+name+'"';
}

/** No connection defaults, env lookup, cloud SDK or automatic schema changes.
 * One acquired connection owns the entire transaction. No process mutex.
 */
export class PostgresSecIngestionRepository implements SecIngestionRepository {
  private readonly schema:string;
  constructor(private readonly pool:Pool,schema:string){this.schema=secPostgresSchema(schema);}

  async getFilingByAccession(accession:string):Promise<SecIngestionRecord|null>{
    secFilingKey(accession);
    // A single statement reads the snapshot and all child rows at one MVCC snapshot.
    const r=await this.pool.query<{snapshot:SecIngestionRecord;transactions:SecIngestionRecord['transactions']}>(`
      SELECT f.snapshot, COALESCE((SELECT jsonb_agg(t.row_data ORDER BY t.row_ordinal)
        FROM ${this.schema}.sec_transactions t WHERE t.filing_accession=f.accession_number),'[]'::jsonb) AS transactions
      FROM ${this.schema}.sec_filings f WHERE f.accession_number=$1`,[accession]);
    if(!r.rows[0])return null;
    return {...r.rows[0].snapshot,transactions:r.rows[0].transactions};
  }

  async saveIngestion(input:SecIngestionRecord):Promise<SecIngestionSaveResult>{
    let record:SecIngestionRecord;
    try{record=validateSecIngestionSnapshot(input);}catch{throw new SecRepositoryWriteError('NOT_COMMITTED');}
    let client:PoolClient;
    try{client=await this.pool.connect();}catch{throw new SecRepositoryWriteError('NOT_COMMITTED');}
    let commitStarted=false,broken=false;
    try{
      await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
      await client.query("SET LOCAL lock_timeout='5s'");
      await client.query("SET LOCAL statement_timeout='10s'");
      const insert=await client.query(`INSERT INTO ${this.schema}.sec_filings
        (accession_number,cik,form_type,filing_date,is_amendment,primary_document,presentation_url,
         accession_index_url,raw_xml_url,raw_xml_hash,retrieved_at,parser_status,parser_version,snapshot)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb)
        ON CONFLICT (accession_number) DO NOTHING RETURNING accession_number`,this.values(record));
      let outcome:SecIngestionSaveResult['outcome']=record.state==='FAILED'?'FAILED':'CREATED';
      if(!insert.rowCount){
        // Separate statement after conflict wait: READ COMMITTED sees winning commit.
        const locked=await client.query<{snapshot:SecIngestionRecord}>(`SELECT snapshot FROM ${this.schema}.sec_filings
          WHERE accession_number=$1 FOR UPDATE`,[record.accessionNumber]);
        if(!locked.rows[0])throw new Error('Missing conflicting filing');
        const previous=locked.rows[0].snapshot;
        if(['cik','formType','filingDate','primaryDocument'].some(k=>previous.metadata[k as keyof typeof previous.metadata]!==record.metadata[k as keyof typeof record.metadata])){
          outcome='METADATA_CONFLICT';record=previous;
        }else if(previous.provenance&&record.provenance&&previous.provenance.rawXmlHash!==record.provenance.rawXmlHash){
          outcome='INTEGRITY_CONFLICT';record=previous;
        }else if(isIngested(previous)){
          outcome='ALREADY_EXISTS';record=previous;
        }else{
          if(previous.provenance&&!record.provenance){record.provenance=previous.provenance;record.parsed=previous.parsed;}
          await client.query(`DELETE FROM ${this.schema}.sec_transactions WHERE filing_accession=$1`,[record.accessionNumber]);
          await client.query(`UPDATE ${this.schema}.sec_filings SET
            cik=$2,form_type=$3,filing_date=$4,is_amendment=$5,primary_document=$6,presentation_url=$7,
            accession_index_url=$8,raw_xml_url=$9,raw_xml_hash=$10,retrieved_at=$11,
            parser_status=$12,parser_version=$13,snapshot=$14::jsonb,updated_at=now()
            WHERE accession_number=$1`,this.values(record));
        }
      }
      if(outcome==='CREATED'||outcome==='FAILED'){
        for(const row of record.transactions){
          const a=row.persistenceAmounts;
          await client.query(`INSERT INTO ${this.schema}.sec_transactions
            (filing_accession,transaction_identity,table_kind,row_ordinal,shares,price,ownership_after,transaction_value,row_data)
            VALUES ($1,$2,$3,$4,$5::numeric,$6::numeric,$7::numeric,$8::numeric,$9::jsonb)`,
            [record.accessionNumber,row.id,row.table,row.rowIndex,a.shares,a.price,a.ownershipAfter,a.transactionValue,JSON.stringify(row)]);
        }
      }
      commitStarted=true;await client.query('COMMIT');
      return {outcome,record:structuredClone(record)};
    }catch{
      let rollbackConfirmed=false;
      if(!commitStarted){try{await client.query('ROLLBACK');rollbackConfirmed=true;}catch{broken=true;}}
      else broken=true;
      throw new SecRepositoryWriteError(!commitStarted&&rollbackConfirmed?'NOT_COMMITTED':'UNKNOWN');
    }finally{client.release(broken);}
  }
  private values(r:SecIngestionRecord):unknown[]{
    const p=r.provenance;
    return [r.accessionNumber,r.metadata.cik,r.metadata.formType,r.metadata.filingDate,r.amendment.isAmendment,
      r.metadata.primaryDocument,p?.presentationUrl??null,p?.indexUrl??null,p?.sourceUrl??null,p?.rawXmlHash??null,
      p?.retrievedAt??null,r.state,p?.parserVersion??null,JSON.stringify(r)];
  }
}

export class PostgresSecIngestionAudit implements SecIngestionAudit {
  private readonly schema:string;
  constructor(private readonly pool:Pool,schema:string){this.schema=secPostgresSchema(schema);}
  async recordAttempt(input:SecIngestionAttempt):Promise<void>{
    // Reuse field selection/safety validation without treating memory as persistence.
    const safe=safeSecIngestionAttempt(input);
    await this.pool.query(`INSERT INTO ${this.schema}.sec_ingestion_attempts
      (accession_number,attempted_at,outcome,persistence_outcome,attempt) VALUES ($1,$2,$3,$4,$5::jsonb)`,
      [safe.accessionNumber,safe.attemptedAt,safe.outcome,safe.persistenceOutcome,JSON.stringify(safe)]);
  }
  async getAttempts(accession:string):Promise<SecIngestionAttempt[]>{
    secFilingKey(accession);
    const r=await this.pool.query<{attempt:SecIngestionAttempt}>(`SELECT attempt FROM ${this.schema}.sec_ingestion_attempts
      WHERE accession_number=$1 ORDER BY id`,[accession]);return r.rows.map(row=>row.attempt);
  }
}
