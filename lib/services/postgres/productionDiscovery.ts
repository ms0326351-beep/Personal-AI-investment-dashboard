import 'server-only';
import { Pool, type PoolClient } from 'pg';

export type DiscoveryFailure = 'INVALID_CONFIGURATION' | 'INVALID_MODE' | 'CONNECTION_FAILED' | 'AUTHENTICATION_FAILED' | 'INSUFFICIENT_PRIVILEGE' | 'WRONG_DATABASE' | 'DATABASE_NAME_MISMATCH' | 'WRONG_POSTGRES_MAJOR' | 'MALFORMED_IDENTITY_TABLE' | 'MALFORMED_IDENTITY_ROW' | 'MULTIPLE_IDENTITY_ROWS' | 'ENVIRONMENT_MISMATCH' | 'UNEXPECTED_IDENTITY_STATE' | 'QUERY_FAILED';
export class DiscoveryError extends Error {
  constructor(public readonly code:DiscoveryFailure){super(code);}
}
/** Return only an allowlisted category; never expose driver messages/configuration. */
export function discoveryFailure(error:unknown):DiscoveryError {
  if(error instanceof DiscoveryError)return error;
  const code=error&&typeof error==='object'&&'code' in error?String(error.code):'';
  if(['28P01','28000'].includes(code))return new DiscoveryError('AUTHENTICATION_FAILED');
  if(code==='42501')return new DiscoveryError('INSUFFICIENT_PRIVILEGE');
  if(code==='3D000')return new DiscoveryError('WRONG_DATABASE');
  if(code.startsWith('08')||['ECONNREFUSED','ECONNRESET','ENOTFOUND','EAI_AGAIN','ETIMEDOUT'].includes(code))return new DiscoveryError('CONNECTION_FAILED');
  return new DiscoveryError('QUERY_FAILED');
}
export function preflightMode(args:readonly string[]):'discovery'|'verify' {
  if(args.length!==2||args[0]!=='--mode'||!['discovery','verify'].includes(args[1]))throw new DiscoveryError('INVALID_MODE');
  return args[1] as 'discovery'|'verify';
}
export interface DiscoveryTarget {environment:'production';databaseName:string}
/** Tooling only. No UUID, env-file loading, application runtime or provider API. */
export function discoveryConnection(env:Readonly<Record<string,string|undefined>>) {
  try {
    if(env.DATABASE_ENV!=='production'||!env.DB_EXPECTED_DATABASE?.trim())throw new DiscoveryError('INVALID_CONFIGURATION');
    const url=new URL(env.DATABASE_DIRECT_URL??'');
    if(!['postgres:','postgresql:'].includes(url.protocol)||url.hostname.includes('-pooler')||!url.username||!url.password)throw new DiscoveryError('INVALID_CONFIGURATION');
    const target:DiscoveryTarget={environment:'production',databaseName:env.DB_EXPECTED_DATABASE};
    if(decodeURIComponent(url.pathname.slice(1))!==target.databaseName)throw new DiscoveryError('DATABASE_NAME_MISMATCH');
    for(const k of ['sslmode','sslcert','sslkey','sslrootcert'])url.searchParams.delete(k);
    return {target,pool:new Pool({connectionString:url.toString(),ssl:{rejectUnauthorized:true},max:1,connectionTimeoutMillis:10000,query_timeout:15000,idleTimeoutMillis:1000})};
  }catch(error){if(error instanceof DiscoveryError)throw error;throw new DiscoveryError('INVALID_CONFIGURATION');}
}
export async function withDiscoveryReadOnly<T>(pool:Pool,read:(client:PoolClient)=>Promise<T>):Promise<T> {
  let client:PoolClient|undefined;let broken=false;
  try {
    try{client=await pool.connect();}catch(error){const classified=discoveryFailure(error);throw classified.code==='QUERY_FAILED'?new DiscoveryError('CONNECTION_FAILED'):classified;}
    await client.query('BEGIN READ ONLY');
    await client.query("SET LOCAL statement_timeout='10s'");
    await client.query("SET LOCAL idle_in_transaction_session_timeout='15s'");
    const result=await read(client);await client.query('ROLLBACK');return result;
  }catch(error){if(client){try{await client.query('ROLLBACK');}catch{broken=true;}}throw discoveryFailure(error);}
  finally{client?.release(broken);}
}
export async function productionDiscovery(pool:Pool,target:DiscoveryTarget) {
  if(target.environment!=='production'||!target.databaseName?.trim())throw new DiscoveryError('INVALID_CONFIGURATION');
  return withDiscoveryReadOnly(pool,async client=>{
    const server=(await client.query("SELECT current_database() AS database,current_setting('server_version_num')::int AS version")).rows[0];
    if(!server||server.database!==target.databaseName)throw new DiscoveryError('WRONG_DATABASE');
    if(server.version<180000||server.version>=190000)throw new DiscoveryError('WRONG_POSTGRES_MAJOR');
    const schemas=(await client.query("SELECT nspname FROM pg_namespace WHERE nspname IN ('sec_admin','sec_app')")).rows;
    const objects=(await client.query("SELECT n.nspname,c.relname,c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE (n.nspname='sec_admin' AND c.relname='database_identity') OR (n.nspname='sec_app' AND c.relname='sec_migration_history')")).rows;
    const identity=objects.find(r=>r.nspname==='sec_admin'&&r.relname==='database_identity');
    const schemaPresent=schemas.some(r=>r.nspname==='sec_app');
    const migrationHistoryPresent=objects.some(r=>r.nspname==='sec_app'&&r.relname==='sec_migration_history');
    const base={database:server.database,postgresMajor:18,environment:'production',schemaPresent,migrationHistoryPresent};
    if(!identity){
      if(schemas.length||objects.length)throw new DiscoveryError('UNEXPECTED_IDENTITY_STATE');
      return {...base,status:'NOT_BOOTSTRAPPED' as const,identityPresent:false};
    }
    if(identity.relkind!=='r')throw new DiscoveryError('MALFORMED_IDENTITY_TABLE');
    const columns=(await client.query("SELECT attname,atttypid::regtype::text AS type,attnotnull FROM pg_attribute WHERE attrelid='sec_admin.database_identity'::regclass AND attnum>0 AND NOT attisdropped")).rows;
    for(const [name,type] of [['singleton','boolean'],['environment','text'],['database_instance_id','uuid'],['created_at','timestamp with time zone']]){
      if(!columns.some(c=>c.attname===name&&c.type===type&&c.attnotnull))throw new DiscoveryError('MALFORMED_IDENTITY_TABLE');
    }
    const rows=(await client.query('SELECT singleton,environment,database_instance_id,created_at FROM sec_admin.database_identity')).rows;
    if(rows.length>1)throw new DiscoveryError('MULTIPLE_IDENTITY_ROWS');
    if(rows.length!==1)throw new DiscoveryError('MALFORMED_IDENTITY_ROW');
    const row=rows[0];
    if(row.singleton!==true||typeof row.database_instance_id!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(row.database_instance_id)||!(row.created_at instanceof Date)||!Number.isFinite(row.created_at.getTime()))throw new DiscoveryError('MALFORMED_IDENTITY_ROW');
    if(!['production','test','staging','development'].includes(row.environment))throw new DiscoveryError('MALFORMED_IDENTITY_ROW');
    if(row.environment!=='production')throw new DiscoveryError('ENVIRONMENT_MISMATCH');
    // Observed marker is not a trusted expected identity. Never return/adopt its UUID.
    return {...base,status:'IDENTITY_PRESENT_NOT_VERIFIED' as const,identityPresent:true};
  });
}
