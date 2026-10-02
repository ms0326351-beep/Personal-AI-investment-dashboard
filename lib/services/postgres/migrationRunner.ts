import 'server-only';
import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import type { DatabaseTarget } from '../../types/databaseSafety';
import { verifyDatabaseIdentity, DatabaseSafetyError } from './databaseSafety';
import { secPostgresSchema } from './secPostgresRepository';
export interface SecMigration {version:number; name:string; sql:string}
export const migrationChecksum=(sql:string)=>createHash('sha256').update(sql,'utf8').digest('hex');

/** Explicit Direct tooling, no connection/env defaults and no startup migration. */
export async function runSecMigrations(pool:Pool, target:DatabaseTarget, schema:string, migrations:SecMigration[], mode:'direct'|'pooled') {
  if(mode!=='direct')throw new DatabaseSafetyError();
  if(pool.options.connectionString){
    try{if(new URL(pool.options.connectionString).hostname.includes('-pooler'))throw new DatabaseSafetyError();}catch{throw new DatabaseSafetyError();}
  }
  const quoted=secPostgresSchema(schema),ordered=[...migrations].sort((a,b)=>a.version-b.version);
  if(ordered.some((m,i)=>m.version!==i+1 || !m.name.trim() || !m.sql.trim() || /^\s*(BEGIN|COMMIT|ROLLBACK)\b/im.test(m.sql)))throw new Error('Invalid migration manifest');
  const client=await pool.connect();let committed=false,broken=false;
  try {
    await client.query('BEGIN');await verifyDatabaseIdentity(client,target);
    await client.query("SET LOCAL lock_timeout='5s'");await client.query("SET LOCAL statement_timeout='10s'");
    await client.query("SET LOCAL idle_in_transaction_session_timeout='15s'");await client.query("SET LOCAL transaction_timeout='30s'");
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`sec-migration:${schema}`]);
    const existing=await client.query<{present:boolean;objects:number}>(`SELECT to_regclass($1) IS NOT NULL AS present,
      (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$2) AS objects`,[`${schema}.sec_migration_history`,schema]);
    if(!existing.rows[0].present && existing.rows[0].objects>0)throw new Error('Untracked schema requires reviewed adoption');
    await client.query(`CREATE SCHEMA IF NOT EXISTS ${quoted}`);
    await client.query(`CREATE TABLE IF NOT EXISTS ${quoted}.sec_migration_history (version integer PRIMARY KEY,name text NOT NULL,checksum text NOT NULL,installed_at timestamptz NOT NULL DEFAULT now())`);
    const previous=await client.query<{version:number;name:string;checksum:string}>(`SELECT version,name,checksum FROM ${quoted}.sec_migration_history ORDER BY version`);
    for(const [i,row] of previous.rows.entries()) {
      const expected=ordered[i];
      if(!expected || row.version!==expected.version || row.name!==expected.name || row.checksum!==migrationChecksum(expected.sql))throw new Error('Migration history mismatch');
    }
    for(const m of ordered.slice(previous.rows.length)) {
      await client.query(`SET LOCAL search_path TO ${quoted},pg_catalog`);
      await client.query(m.sql);
      await client.query(`INSERT INTO ${quoted}.sec_migration_history(version,name,checksum) VALUES ($1,$2,$3)`,[m.version,m.name,migrationChecksum(m.sql)]);
    }
    committed=true;await client.query('COMMIT');
    return {version:ordered.length,applied:ordered.length-previous.rows.length};
  } catch(error) {
    if(committed){broken=true;throw new Error('Migration acknowledgement unknown');}
    try{await client.query('ROLLBACK');}catch{broken=true;}
    throw new Error(error instanceof DatabaseSafetyError?'Database safety verification refused':'Migration failed; inspect manifest/history safely');
  } finally {client.release(broken);}
}
