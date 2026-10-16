import 'server-only';
import type { Pool, PoolClient } from 'pg';
import type { DatabaseTarget } from '../../types/databaseSafety';
import { loadBootstrapArtifact } from './productionBootstrap';
import { validateDatabaseTarget } from './databaseSafety';

export type BootstrapVerificationStatus = 'VERIFIED'|'NOT_BOOTSTRAPPED'|'IDENTITY_MISMATCH'|'ARTIFACT_MISMATCH'|'PARTIAL_BOOTSTRAP'|'PRIVILEGE_MISMATCH'|'UNKNOWN';
class Refusal extends Error { constructor(readonly status:BootstrapVerificationStatus){super(status);} }
const runtime='investment_dashboard_runtime',migrator='investment_dashboard_migrator';
const refuse=(condition:boolean,status:BootstrapVerificationStatus)=>{if(condition)throw new Refusal(status);};
/** Same implementation is used before write and for acknowledgement recovery. SELECT only. */
export async function inspectBootstrap(client:PoolClient,target:DatabaseTarget):Promise<{status:BootstrapVerificationStatus}> {
  validateDatabaseTarget(target);
  refuse(target.environment!=='production'||target.databaseName!=='neondb','IDENTITY_MISMATCH');
  const {manifest}=await loadBootstrapArtifact();
  const server=(await client.query("SELECT current_database() AS name,current_user AS admin,current_setting('server_version_num')::int AS version")).rows[0];
  refuse(server.name!==target.databaseName||server.version<180000||server.version>=190000,'IDENTITY_MISMATCH');
  const schemas=(await client.query("SELECT oid,nspname,pg_get_userbyid(nspowner) AS owner FROM pg_namespace WHERE nspname IN ('sec_admin','sec_app')")).rows;
  const roles=(await client.query("SELECT oid,rolname,rolcanlogin,rolinherit,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls FROM pg_roles WHERE rolname IN ('investment_dashboard_runtime','investment_dashboard_migrator')")).rows;
  if(!schemas.length&&!roles.length)return {status:'NOT_BOOTSTRAPPED'};
  refuse(schemas.length!==2||roles.length!==2,'PARTIAL_BOOTSTRAP');
  const admin=schemas.find(x=>x.nspname==='sec_admin')!.owner;
  refuse([runtime,migrator].includes(admin)||server.admin!==admin,'PRIVILEGE_MISMATCH');
  refuse(schemas.find(x=>x.nspname==='sec_app')?.owner!==migrator,'PRIVILEGE_MISMATCH');
  refuse(roles.some(r=>!r.rolcanlogin||r.rolinherit||r.rolsuper||r.rolcreatedb||r.rolcreaterole||r.rolreplication||r.rolbypassrls),'PRIVILEGE_MISMATCH');
  const objects=(await client.query("SELECT n.nspname,c.relname,c.relkind,pg_get_userbyid(c.relowner) AS owner FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('sec_admin','sec_app')")).rows;
  // Immediate bootstrap verification deliberately refuses application migrations or extra objects.
  refuse(objects.some(o=>o.nspname==='sec_app'),'PARTIAL_BOOTSTRAP');
  const allowed=['database_identity','database_identity_pkey','database_identity_database_instance_id_key','bootstrap_history','bootstrap_history_pkey'];
  refuse(objects.length!==allowed.length||objects.some(o=>!allowed.includes(o.relname)),'PARTIAL_BOOTSTRAP');
  refuse(objects.some(o=>o.owner!==admin),'PRIVILEGE_MISMATCH');
  refuse(objects.filter(o=>['database_identity','bootstrap_history'].includes(o.relname)).some(o=>o.relkind!=='r'),'PARTIAL_BOOTSTRAP');
  const identity=(await client.query('SELECT singleton,environment,database_instance_id,created_at FROM sec_admin.database_identity')).rows;
  refuse(identity.length!==1||identity[0].singleton!==true||identity[0].environment!=='production'||identity[0].database_instance_id!==target.databaseInstanceId||!(identity[0].created_at instanceof Date),'IDENTITY_MISMATCH');
  const history=(await client.query('SELECT version,template_sha256,status,completed_at FROM sec_admin.bootstrap_history')).rows;
  refuse(history.length!==1||history[0].version!==2||history[0].template_sha256!==manifest.actions[0].sha256||history[0].status!=='COMPLETE'||!(history[0].completed_at instanceof Date),'ARTIFACT_MISMATCH');
  const memberships=(await client.query('SELECT count(*)::int AS n FROM pg_auth_members WHERE member=ANY($1::oid[])',[roles.map(r=>r.oid)])).rows[0];
  refuse(memberships.n!==0,'PRIVILEGE_MISMATCH');
  // ACLs include PUBLIC and indirect effective privileges; reject extra grantees or grant options.
  const acl=(await client.query(`
    SELECT 'database' AS kind,current_database() AS object,a.grantee::text,pg_get_userbyid(a.grantee) AS grantee_name,a.privilege_type,a.is_grantable
    FROM pg_database d CROSS JOIN LATERAL aclexplode(COALESCE(d.datacl,acldefault('d',d.datdba))) a WHERE d.datname=current_database()
    UNION ALL SELECT 'schema',n.nspname,a.grantee::text,pg_get_userbyid(a.grantee),a.privilege_type,a.is_grantable
    FROM pg_namespace n CROSS JOIN LATERAL aclexplode(COALESCE(n.nspacl,acldefault('n',n.nspowner))) a WHERE n.nspname IN ('sec_admin','sec_app','public')
    UNION ALL SELECT 'table',c.relname,a.grantee::text,pg_get_userbyid(a.grantee),a.privilege_type,a.is_grantable
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a
    WHERE n.nspname='sec_admin' AND c.relkind='r'`)).rows;
  for(const a of acl){
    if(a.grantee_name===admin||a.kind==='schema'&&a.object==='public'&&a.grantee_name==='pg_database_owner'||a.kind==='schema'&&a.object==='sec_app'&&a.grantee_name===migrator)continue;
    const actor=[runtime,migrator].includes(a.grantee_name);
    const permitted=actor&&(a.kind==='database'&&a.privilege_type==='CONNECT'||a.kind==='schema'&&a.object==='sec_admin'&&a.privilege_type==='USAGE'||a.kind==='schema'&&a.object==='sec_app'&&a.grantee_name===runtime&&a.privilege_type==='USAGE'||a.kind==='table'&&a.object==='database_identity'&&a.privilege_type==='SELECT');
    refuse(!permitted||a.is_grantable,'PRIVILEGE_MISMATCH');
  }
  for(const role of [runtime,migrator]){
    const p=(await client.query("SELECT has_database_privilege($1,current_database(),'CONNECT') AS connect,has_database_privilege($1,current_database(),'CREATE') AS create_db,has_database_privilege($1,current_database(),'TEMP') AS temp_db,has_schema_privilege($1,'public','CREATE') AS public_create,has_schema_privilege($1,'sec_admin','USAGE') AS admin_usage,has_schema_privilege($1,'sec_admin','CREATE') AS admin_create,has_schema_privilege($1,'sec_app','USAGE') AS app_usage,has_schema_privilege($1,'sec_app','CREATE') AS app_create,has_table_privilege($1,'sec_admin.database_identity','SELECT') AS identity_select",[role])).rows[0];
    refuse(!p.connect||p.create_db||p.temp_db||p.public_create||!p.admin_usage||p.admin_create||!p.app_usage||p.app_create!==(role===migrator)||!p.identity_select,'PRIVILEGE_MISMATCH');
    for(const table of ['database_identity','bootstrap_history'])for(const priv of ['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']){
      const granted=(await client.query('SELECT has_table_privilege($1,$2,$3) AS granted',[role,'sec_admin.'+table,priv])).rows[0].granted;
      refuse(granted!==(table==='database_identity'&&priv==='SELECT'),'PRIVILEGE_MISMATCH');
    }
  }
  const mid=roles.find(r=>r.rolname===migrator)!.oid;
  const defaults=(await client.query('SELECT defaclnamespace,defaclobjtype,defaclacl FROM pg_default_acl WHERE defaclrole=$1',[mid])).rows;
  const schemaIds=schemas.map(s=>s.oid);
  refuse(defaults.some(d=>d.defaclnamespace!==0&&!schemaIds.includes(d.defaclnamespace)),'PRIVILEGE_MISMATCH');
  const grants=(await client.query('SELECT a.grantee::text,a.privilege_type,a.is_grantable FROM pg_default_acl d CROSS JOIN LATERAL aclexplode(d.defaclacl) a WHERE d.defaclrole=$1',[mid])).rows;
  refuse(grants.some(a=>a.grantee!==String(mid)),'PRIVILEGE_MISMATCH');
  // Functions normally grant PUBLIC EXECUTE. Absence of this global revoke is unsafe.
  refuse(!defaults.some(d=>d.defaclnamespace===0&&d.defaclobjtype==='f'),'PRIVILEGE_MISMATCH');
  // No sequence/functions should exist at this bootstrap-only checkpoint.
  refuse((await client.query("SELECT count(*)::int AS n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('sec_admin','sec_app')")).rows[0].n!==0,'PARTIAL_BOOTSTRAP');
  return {status:'VERIFIED'};
}
export async function verifyBootstrap(pool:Pool,target:DatabaseTarget):Promise<{status:BootstrapVerificationStatus}> {
  let c:PoolClient|undefined;let broken=false;
  try{validateDatabaseTarget(target);c=await pool.connect();await c.query('BEGIN READ ONLY');await c.query("SET LOCAL statement_timeout='10s'");await c.query("SET LOCAL transaction_timeout='30s'");
    const result=await inspectBootstrap(c,target);await c.query('ROLLBACK');return result;
  }catch(e){if(c)try{await c.query('ROLLBACK');}catch{broken=true;}return {status:e instanceof Refusal?e.status:'UNKNOWN'};}
  finally{c?.release(broken);}
}
