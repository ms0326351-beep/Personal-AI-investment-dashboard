import 'server-only';
import { Pool } from 'pg';
import { databaseEnvironment, DatabaseSafetyError,validateDatabaseTarget } from './databaseSafety';

/** Tooling only. Runtime must never import this module. */
export function migrationConnection(env:Readonly<Record<string,string|undefined>>) {
  try {
    const environment=databaseEnvironment(env.DATABASE_ENV),url=new URL(env.DATABASE_DIRECT_URL ?? '');
    if (!['postgres:','postgresql:'].includes(url.protocol) || url.hostname.includes('-pooler') || !url.username || !url.password) throw new DatabaseSafetyError();
    const target={environment,databaseInstanceId:env.DB_EXPECTED_INSTANCE_ID??'',databaseName:decodeURIComponent(url.pathname.slice(1))};
    validateDatabaseTarget(target);
    for(const k of ['sslmode','sslcert','sslkey','sslrootcert'])url.searchParams.delete(k);
    return {pool:new Pool({connectionString:url.toString(),ssl:{rejectUnauthorized:true},max:1,connectionTimeoutMillis:10000,query_timeout:15000,idleTimeoutMillis:1000}),
      target,mode:'direct' as const};
  } catch { throw new DatabaseSafetyError(); }
}
