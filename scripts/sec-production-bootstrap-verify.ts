import { migrationConnection } from '../lib/services/postgres/migrationConnection';
import { verifyBootstrap } from '../lib/services/postgres/bootstrapVerification';
async function main(){let pool:ReturnType<typeof migrationConnection>['pool']|undefined;
  try{
    if(process.argv.length!==3||process.argv[2]!=='--verify'||process.env.DATABASE_ENV!=='production'||process.env.DB_EXPECTED_DATABASE!=='neondb')throw Error('Explicit verification required');
    const c=migrationConnection(process.env);pool=c.pool;
    if(c.target.databaseName!=='neondb')throw Error('Wrong database');
    const result=await verifyBootstrap(pool,c.target);console.log(JSON.stringify(result));process.exitCode=result.status==='VERIFIED'?0:2;
  }catch{console.error(JSON.stringify({status:'UNKNOWN',code:'INVALID_CONFIGURATION_OR_VERIFICATION'}));process.exitCode=1;}
  finally{if(pool)try{await pool.end();}catch{process.exitCode=1;}}
}
void main();
