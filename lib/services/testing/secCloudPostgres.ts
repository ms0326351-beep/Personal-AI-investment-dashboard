import { Pool, type PoolClient } from 'pg';
import type { TLSSocket } from 'node:tls';
import { observeCloudPool, cloudTrace } from './secCloudDiagnostics';
import { assertTestEndpoint, testDatabaseTarget, verifyDatabaseIdentity } from '../postgres/databaseSafety';

export function verifiedCloudTls(client:PoolClient):boolean{
  // node-postgres client transport; Neon backend pg_stat_ssl is not client TLS.
  const socket=(client as PoolClient & {connection:{stream:TLSSocket}}).connection.stream;
  return socket.encrypted===true && socket.authorized===true;
}

/** Test-only, process supplied connection. Never imported by production routes. */
export async function cloudTestPool(admin=false):Promise<Pool>{
  if(process.env.SEC_PG_CLOUD_TEST_ENABLED!=='1')throw new Error('Cloud tests not enabled');
  let url:URL;
  const pooled=!admin && process.env.SEC_PG_CLOUD_TEST_MODE==='pooled';
  try{url=new URL((admin?process.env.SEC_PG_CLOUD_ADMIN_CONNECTION:process.env.SEC_PG_CLOUD_TEST_CONNECTION)??'');}catch{throw new Error('Cloud test configuration invalid');}
  assertTestEndpoint(url.toString(),process.env);
  if(!['postgres:','postgresql:'].includes(url.protocol)||!url.hostname.endsWith('.neon.tech')||url.hostname.includes('-pooler')!==pooled)throw new Error('Unexpected cloud endpoint mode');
  for(const key of ['sslmode','sslcert','sslkey','sslrootcert'])url.searchParams.delete(key);
  const pool=new Pool({connectionString:url.toString(),ssl:{rejectUnauthorized:true},max:12,
    connectionTimeoutMillis:20000,query_timeout:30000,idleTimeoutMillis:1000,application_name:'sec-stage2c3e-validation'});
  observeCloudPool(pool);
  try{
    cloudTrace('TLS acquire before',pool);const client=await pool.connect();
    try{if(!verifiedCloudTls(client))throw new Error('TLS required');await verifyDatabaseIdentity(client,testDatabaseTarget(process.env),true);}finally{client.release();}
    return pool;
  }catch{await pool.end();throw new Error('Cloud connection or TLS validation failed');}
}
