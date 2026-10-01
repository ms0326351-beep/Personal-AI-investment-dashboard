import { Pool, type PoolClient } from 'pg';
import type { TLSSocket } from 'node:tls';

export function verifiedCloudTls(client:PoolClient):boolean{
  // node-postgres client transport; Neon backend pg_stat_ssl is not client TLS.
  const socket=(client as PoolClient & {connection:{stream:TLSSocket}}).connection.stream;
  return socket.encrypted===true && socket.authorized===true;
}

/** Test-only, process supplied connection. Never imported by production routes. */
export async function cloudTestPool():Promise<Pool>{
  if(process.env.SEC_PG_CLOUD_TEST_ENABLED!=='1')throw new Error('Cloud tests not enabled');
  let url:URL;
  try{url=new URL(process.env.SEC_PG_CLOUD_TEST_CONNECTION??'');}catch{throw new Error('Cloud test configuration invalid');}
  if(!['postgres:','postgresql:'].includes(url.protocol)||!url.hostname.endsWith('.neon.tech')||url.hostname.includes('-pooler'))throw new Error('Direct test connection required');
  for(const key of ['sslmode','sslcert','sslkey','sslrootcert'])url.searchParams.delete(key);
  const pool=new Pool({connectionString:url.toString(),ssl:{rejectUnauthorized:true},max:12,
    connectionTimeoutMillis:15000,idleTimeoutMillis:1000,application_name:'sec-stage2c3e-validation'});
  try{
    const client=await pool.connect();
    try{if(!verifiedCloudTls(client))throw new Error('TLS required');}finally{client.release();}
    return pool;
  }catch{await pool.end();throw new Error('Cloud connection or TLS validation failed');}
}
