import { bootstrapConfig,bootstrapPool,executeBootstrap } from '../lib/services/postgres/bootstrapExecution';
async function main(){let pool:ReturnType<typeof bootstrapPool>|undefined;
  try{
    if(process.argv.length!==3||process.argv[2]!=='--execute')throw Error('Explicit execution required');
    const config=await bootstrapConfig(process.env);pool=bootstrapPool(process.env);
    const result=await executeBootstrap(pool,config);console.log(JSON.stringify(result));
    process.exitCode=result.status==='SUCCESS_COMMITTED'?0:result.status==='UNKNOWN_COMMIT'?3:2;
  }catch{console.error(JSON.stringify({status:'REFUSED',code:'INVALID_CONFIGURATION_OR_ARTIFACT'}));process.exitCode=1;}
  finally{if(pool)try{await pool.end();}catch{process.exitCode=3;}}
}
void main();
