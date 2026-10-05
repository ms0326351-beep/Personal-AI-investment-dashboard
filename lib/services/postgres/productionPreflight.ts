import 'server-only';
import type { Pool,PoolClient } from 'pg';
import type { DatabaseTarget } from '../../types/databaseSafety';
import { verifyDatabaseIdentity } from './databaseSafety';

export async function withReadOnlyTransaction<T>(pool:Pool,read:(client:PoolClient)=>Promise<T>):Promise<T>{
  const client=await pool.connect();let broken=false;
  try{await client.query('BEGIN READ ONLY');await client.query("SET LOCAL statement_timeout='10s'");await client.query("SET LOCAL idle_in_transaction_session_timeout='15s'");
    const result=await read(client);await client.query('ROLLBACK');return result;
  }catch{try{await client.query('ROLLBACK');}catch{broken=true;}throw Error('Read-only production preflight refused');}
  finally{client.release(broken);}
}
export async function productionPreflight(pool:Pool,target:DatabaseTarget){
  if(target.environment!=='production')throw Error('Production target required');
  return withReadOnlyTransaction(pool,async client=>{
    await verifyDatabaseIdentity(client,target);
    const server=(await client.query('SELECT current_database() AS database,current_setting(\'server_version_num\')::int AS version')).rows[0];
    if(server.version<180000||server.version>=190000)throw Error('Expected PostgreSQL 18');
    const roles=await client.query("SELECT oid,rolname,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls FROM pg_roles WHERE rolname IN ('investment_dashboard_runtime','investment_dashboard_migrator')");
    if(roles.rows.length!==2||roles.rows.some(r=>r.rolsuper||r.rolcreatedb||r.rolcreaterole||r.rolreplication||r.rolbypassrls))throw Error('Unsafe role');
    const runtime=roles.rows.find(r=>r.rolname==='investment_dashboard_runtime');
    if((await client.query('SELECT count(*)::int AS n FROM pg_auth_members WHERE member=$1',[runtime.oid])).rows[0].n)throw Error('Runtime membership refused');
    const migrator=roles.rows.find(r=>r.rolname==='investment_dashboard_migrator');
    if((await client.query('SELECT count(*)::int AS n FROM pg_auth_members WHERE member=$1',[migrator.oid])).rows[0].n)throw Error('Migrator membership refused');
    const privileges=(await client.query("SELECT has_database_privilege('investment_dashboard_runtime',current_database(),'CREATE') AS create_db,has_database_privilege('investment_dashboard_runtime',current_database(),'TEMP') AS temp_db,has_schema_privilege('investment_dashboard_runtime','sec_app','CREATE') AS create_schema")).rows[0];
    if(privileges.create_db||privileges.temp_db||privileges.create_schema)throw Error('Unsafe runtime privileges');
    const schemas=await client.query("SELECT nspname,pg_get_userbyid(nspowner) AS owner FROM pg_namespace WHERE nspname IN ('sec_app','sec_admin')");
    if(schemas.rows.length!==2||schemas.rows.find(r=>r.nspname==='sec_app')?.owner!=='investment_dashboard_migrator'||schemas.rows.some(r=>r.owner==='investment_dashboard_runtime'))throw Error('Unsafe schema owner');
    const objects=await client.query("SELECT c.relname,pg_get_userbyid(c.relowner) AS owner FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='sec_app'");
    if(objects.rows.some(r=>r.owner!=='investment_dashboard_migrator'))throw Error('Unsafe object owner');
    const identityOwner=(await client.query("SELECT pg_get_userbyid(relowner) AS owner FROM pg_class WHERE oid='sec_admin.database_identity'::regclass")).rows[0].owner;
    if(['investment_dashboard_runtime','investment_dashboard_migrator'].includes(identityOwner))throw Error('Identity must remain admin-owned');
    const historyExists=(await client.query("SELECT to_regclass('sec_app.sec_migration_history') AS object")).rows[0].object;
    const history=historyExists?(await client.query('SELECT version,name,checksum FROM sec_app.sec_migration_history ORDER BY version')).rows:[];
    const extensions=(await client.query('SELECT extname FROM pg_extension ORDER BY extname')).rows.map(r=>r.extname);
    return {status:'VERIFIED' as const,database:server.database,postgresMajor:18,environment:'production',schemaPresent:true,migrationHistory:history,extensions,
      providerProjectBranch:'MANUAL_VERIFICATION_REQUIRED',productionRuntime:'NOT_VERIFIED'};
  });
}
