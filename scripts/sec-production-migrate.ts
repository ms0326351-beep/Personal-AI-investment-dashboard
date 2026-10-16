// Separate explicit WRITE entry; never called by application routes or preflight.
import { migrationConnection } from '../lib/services/postgres/migrationConnection';
import { executeProductionMigration } from '../lib/services/postgres/productionMigration';
async function main(){let connection:ReturnType<typeof migrationConnection>|undefined;
  try{connection=migrationConnection(process.env);const yes=(name:string)=>process.env[name]==='YES';
    console.log(JSON.stringify(await executeProductionMigration(connection.pool,connection.target,{writeApproved:yes('SEC_MIGRATION_WRITE_APPROVED'),restoreCapabilityReviewed:yes('SEC_RESTORE_CAPABILITY_REVIEWED'),restorePointReviewed:yes('SEC_RESTORE_POINT_REVIEWED'),forwardFixReviewed:yes('SEC_FORWARD_FIX_REVIEWED')})));}
  catch{console.error('MIGRATION_FAILED_OR_UNKNOWN: verify history before retry; credentials withheld');process.exitCode=1;}
  finally{if(connection)await connection.pool.end();}}
void main();
