import 'server-only';
import type { Pool, PoolClient } from 'pg';
import type { DatabaseEnvironment, DatabaseIdentity, DatabaseTarget } from '../../types/databaseSafety';

const environments = ['development', 'test', 'staging', 'production'];
export class DatabaseSafetyError extends Error {
  constructor() { super('Database safety verification refused'); }
}
export function databaseEnvironment(value: unknown): DatabaseEnvironment {
  if (typeof value !== 'string' || !environments.includes(value)) throw new DatabaseSafetyError();
  return value as DatabaseEnvironment;
}
export function validateDatabaseTarget(target:DatabaseTarget):void {
  databaseEnvironment(target.environment);
  if (!target.databaseName || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(target.databaseInstanceId)) throw new DatabaseSafetyError();
}
export function assertDatabaseIdentity(target: DatabaseTarget, identity: unknown, actualDatabase: string, destructive = false): asserts identity is DatabaseIdentity {
  validateDatabaseTarget(target);
  if (!identity || typeof identity !== 'object') throw new DatabaseSafetyError();
  const i = identity as Partial<DatabaseIdentity>;
  if (i.environment !== target.environment || i.databaseInstanceId !== target.databaseInstanceId ||
      typeof i.createdAt !== 'string' || !Number.isFinite(Date.parse(i.createdAt)) || actualDatabase !== target.databaseName ||
      (destructive && (i.environment === 'production' || target.environment === 'production'))) throw new DatabaseSafetyError();
}
/** Fixed administrative namespace; never taken from payloads or application schema. */
export async function verifyDatabaseIdentity(db: Pool | PoolClient, target: DatabaseTarget, destructive = false): Promise<void> {
  try {
    const r = await db.query<{environment:string; database_instance_id:string; created_at:Date; database_name:string}>(
      'SELECT environment,database_instance_id,created_at,current_database() AS database_name FROM sec_admin.database_identity WHERE singleton=true');
    if (r.rows.length !== 1) throw new DatabaseSafetyError();
    const row = r.rows[0];
    assertDatabaseIdentity(target, {environment:row.environment,databaseInstanceId:row.database_instance_id,createdAt:row.created_at?.toISOString()}, row.database_name, destructive);
  } catch { throw new DatabaseSafetyError(); }
}
export function testDatabaseTarget(env: Readonly<Record<string,string|undefined>>): DatabaseTarget {
  const environment = databaseEnvironment(env.DATABASE_ENV);
  if (!['test','development'].includes(environment)) throw new DatabaseSafetyError();
  const target={environment,databaseInstanceId:env.SEC_PG_EXPECTED_INSTANCE_ID ?? '',databaseName:env.SEC_PG_EXPECTED_DATABASE ?? ''};
  validateDatabaseTarget(target);
  return target;
}
/** Exact endpoints supplied by trusted test configuration, checked before connecting. */
export function assertTestEndpoint(raw: string, env: Readonly<Record<string,string|undefined>>): void {
  try {
    const url = new URL(raw), allowed = (env.SEC_PG_ALLOWED_HOSTS ?? '').split(',');
    testDatabaseTarget(env);
    if (!['postgres:','postgresql:'].includes(url.protocol) || !allowed.includes(url.hostname) ||
        decodeURIComponent(url.pathname.slice(1)) !== env.SEC_PG_EXPECTED_DATABASE ||
        [...url.searchParams.keys()].some(k=>!['sslmode','sslcert','sslkey','sslrootcert','channel_binding'].includes(k))) throw new DatabaseSafetyError();
  } catch { throw new DatabaseSafetyError(); }
}
