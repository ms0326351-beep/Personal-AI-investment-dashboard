import 'server-only';
import type { Pool,PoolClient } from 'pg';
import { migrationConnection } from './migrationConnection';
import { loadBootstrapArtifact,prepareBootstrap,type BootstrapPreparation } from './productionBootstrap';
import { inspectBootstrap } from './bootstrapVerification';
import type { DatabaseTarget } from '../../types/databaseSafety';

export type BootstrapTerminal='SUCCESS_COMMITTED'|'FAILED_ROLLED_BACK'|'UNKNOWN_COMMIT';
export interface BootstrapExecutionConfig {target:DatabaseTarget; preparation:BootstrapPreparation}
/** Exact action/checksum/instance-bound acknowledgement. Never print this value. */
export async function bootstrapConfig(env:Readonly<Record<string,string|undefined>>):Promise<BootstrapExecutionConfig> {
  const {manifest}=await loadBootstrapArtifact();
  const id=env.DB_EXPECTED_INSTANCE_ID??'';
  if(env.PRODUCTION_BOOTSTRAP_WRITE_APPROVED!==`BOOTSTRAP_V2:${manifest.actions[0].sha256}:${id}`||!id||
    env.DATABASE_ENV!=='production'||env.DB_EXPECTED_DATABASE!=='neondb')throw Error('Bootstrap configuration refused');
  const preparation:BootstrapPreparation={environment:'production',database:'neondb',postgresMajor:18,instanceUuid:id,
    migratorPassword:env.BOOTSTRAP_MIGRATOR_PASSWORD??'',runtimePassword:env.BOOTSTRAP_RUNTIME_PASSWORD??'',
    operatorTargetConfirmed:env.BOOTSTRAP_TARGET_ACCEPTED==='CONFIRMED',uuidStoredOutsideRepository:env.BOOTSTRAP_UUID_STORED==='CONFIRMED',
    rolesReviewed:env.BOOTSTRAP_ROLES_ACCEPTED==='CONFIRMED',restoreCapabilityReviewed:env.BOOTSTRAP_RESTORE_ACCEPTED==='CONFIRMED',
    restorePointReviewed:env.BOOTSTRAP_RECOVERY_POINT_ACCEPTED==='CONFIRMED',forwardFixReviewed:env.BOOTSTRAP_RECOVERY_PROCEDURE_ACCEPTED==='CONFIRMED'};
  await prepareBootstrap(preparation);
  // Validate URL without acquiring a connection. No env file or implicit provider defaults.
  const u=new URL(env.DATABASE_DIRECT_URL??'');
  if(!['postgres:','postgresql:'].includes(u.protocol)||u.hostname.includes('-pooler')||!u.username||!u.password||decodeURIComponent(u.pathname.slice(1))!=='neondb')throw Error('Bootstrap configuration refused');
  return {target:{environment:'production',databaseName:'neondb',databaseInstanceId:id},preparation};
}
export function bootstrapPool(env:Readonly<Record<string,string|undefined>>) {return migrationConnection(env).pool;}
/** No retry, no public injection switches. Tests instrument the local pg boundary. */
export async function executeBootstrap(pool:Pool,config:BootstrapExecutionConfig):Promise<{status:BootstrapTerminal; verificationRequired:boolean}> {
  const plan=await prepareBootstrap(config.preparation);
  if(config.target.environment!=='production'||config.target.databaseName!=='neondb'||config.target.databaseInstanceId!==config.preparation.instanceUuid)throw Error('Bootstrap target refused');
  const start='\nBEGIN;\n',end='\nCOMMIT;';
  if(!plan.sql.includes(start)||!plan.sql.endsWith(end+'\n'))throw Error('Bootstrap boundary refused');
  const body=plan.sql.slice(plan.sql.indexOf(start)+start.length,plan.sql.lastIndexOf(end));
  const marker='CREATE SCHEMA sec_admin;';const index=body.indexOf(marker);
  if(index<0)throw Error('Bootstrap boundary refused');
  let c:PoolClient|undefined;let commitSent=false,broken=false;
  try{
    c=await pool.connect();await c.query('BEGIN');await c.query(body.slice(0,index));
    if((await inspectBootstrap(c,config.target)).status!=='NOT_BOOTSTRAPPED')throw Error('Existing or partial bootstrap refused');
    await c.query(body.slice(index));
    if((await inspectBootstrap(c,config.target)).status!=='VERIFIED')throw Error('Bootstrap verification refused');
    commitSent=true;await c.query('COMMIT');
    return {status:'SUCCESS_COMMITTED',verificationRequired:true};
  }catch{
    if(commitSent){broken=true;return {status:'UNKNOWN_COMMIT',verificationRequired:true};}
    if(c){try{await c.query('ROLLBACK');}catch{broken=true;return {status:'UNKNOWN_COMMIT',verificationRequired:true};}}
    return {status:'FAILED_ROLLED_BACK',verificationRequired:false};
  }finally{c?.release(broken);}
}
