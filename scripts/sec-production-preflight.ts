// Explicit READ-ONLY entry. No provisioning or migration imports.
import { migrationConnection } from '../lib/services/postgres/migrationConnection';
import { productionPreflight } from '../lib/services/postgres/productionPreflight';
async function main(){let connection:ReturnType<typeof migrationConnection>|undefined;
  try{connection=migrationConnection(process.env);console.log(JSON.stringify(await productionPreflight(connection.pool,connection.target)));}
  catch{console.error('READ_ONLY_PREFLIGHT_FAILED: review target/identity/roles without exposing credentials');process.exitCode=1;}
  finally{if(connection)await connection.pool.end();}}
void main();
