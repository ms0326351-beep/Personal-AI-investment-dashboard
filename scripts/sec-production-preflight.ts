// Explicit READ-ONLY entry. No provisioning or migration imports.
import { migrationConnection } from '../lib/services/postgres/migrationConnection';
import { productionPreflight } from '../lib/services/postgres/productionPreflight';
import { discoveryConnection,productionDiscovery,preflightMode,discoveryFailure } from '../lib/services/postgres/productionDiscovery';
async function main(){let connection:{pool:ReturnType<typeof migrationConnection>['pool']}|undefined;
  try{
    const mode=preflightMode(process.argv.slice(2));
    if(mode==='discovery'){const c=discoveryConnection(process.env);connection=c;console.log(JSON.stringify(await productionDiscovery(c.pool,c.target)));}
    else{const c=migrationConnection(process.env);connection=c;console.log(JSON.stringify(await productionPreflight(c.pool,c.target)));}
  }
  catch(error){console.error(JSON.stringify({status:'FAILED',code:discoveryFailure(error).code}));process.exitCode=1;}
  finally{if(connection)await connection.pool.end();}}
void main();
