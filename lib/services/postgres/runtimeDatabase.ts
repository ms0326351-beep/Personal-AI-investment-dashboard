import 'server-only';
import { Pool, type PoolClient } from 'pg';
import { databaseEnvironment, DatabaseSafetyError, verifyDatabaseIdentity,validateDatabaseTarget } from './databaseSafety';

const bounded = (value:string|undefined, fallback:number, min:number, max:number):number => {
  const n = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new DatabaseSafetyError();
  return n;
};
export function runtimeDatabaseConfig(env:Readonly<Record<string,string|undefined>>) {
  try {
    const environment = databaseEnvironment(env.DATABASE_ENV);
    const url = new URL(env.DATABASE_URL ?? '');
    if (!['postgres:','postgresql:'].includes(url.protocol) || !url.hostname.includes('-pooler') || !url.username || !url.password) throw new DatabaseSafetyError();
    if(environment==='production' && decodeURIComponent(url.username)==='neondb_owner')throw new DatabaseSafetyError();
    const target={environment,databaseInstanceId:env.DB_EXPECTED_INSTANCE_ID ?? '',databaseName:decodeURIComponent(url.pathname.slice(1))};
    validateDatabaseTarget(target);
    for (const key of ['sslmode','sslcert','sslkey','sslrootcert']) url.searchParams.delete(key);
    return { target,
      options:{connectionString:url.toString(),ssl:{rejectUnauthorized:true},
        max:bounded(env.DB_POOL_MAX,2,1,5),connectionTimeoutMillis:bounded(env.DB_ACQUIRE_TIMEOUT_MS,10000,5000,30000),
        idleTimeoutMillis:bounded(env.DB_IDLE_TIMEOUT_MS,10000,1000,60000),query_timeout:bounded(env.DB_QUERY_TIMEOUT_MS,15000,10000,60000),
        application_name:'sec-runtime'} };
  } catch { throw new DatabaseSafetyError(); }
}
/** One factory per process/module. Lazy, no routes import this yet. */
export function createRuntimeDatabase(env:Readonly<Record<string,string|undefined>> = process.env) {
  let ready:Promise<Pool>|undefined;
  async function getPool():Promise<Pool> {
    if (!ready) ready = (async()=>{
      const {options,target}=runtimeDatabaseConfig(env), pool=new Pool(options);
      pool.on('error',()=>{}); // No driver error/configuration is logged.
      try { await verifyDatabaseIdentity(pool,target);return pool; }
      catch { await pool.end();throw new DatabaseSafetyError(); }
    })().catch(error=>{ready=undefined;throw error;});
    return ready;
  }
  return {getPool,async withClient<T>(fn:(client:PoolClient)=>Promise<T>):Promise<T>{
    let client:PoolClient;
    try{client=await (await getPool()).connect();}catch{throw new DatabaseSafetyError();}
    let broken=false;
    try{return await fn(client);}catch(error){broken=true;throw error;}finally{client.release(broken);}
  },async close():Promise<void>{const pending=ready;ready=undefined;if(pending)await (await pending).end();}};
}
export const runtimeDatabase = createRuntimeDatabase();
