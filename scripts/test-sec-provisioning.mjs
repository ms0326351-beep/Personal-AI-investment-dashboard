// Local-only PG18 rehearsal. Never loads env files or external DB credentials.
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
const name='investment-provisioning-'+randomUUID().replaceAll('-','');
const docker=(args)=>execFileSync('docker',args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:60000}).trim();
let created=false;
try {
  docker(['run','-d','--name',name,'--label','investment-dashboard.stage=2c3hc','--publish','127.0.0.1::5432','--tmpfs','/var/lib/postgresql',
    '-e','POSTGRES_HOST_AUTH_METHOD=trust','-e','POSTGRES_DB=neondb','postgres:18@sha256:5a5a84b19854a9ffaa54082c166ff4ec27473a361e496e5ea167f298f2da9722']);created=true;
  let ready=false;for(let i=0;i<60;i++){try{docker(['exec',name,'pg_isready','-U','postgres','-d','neondb']);ready=true;break;}catch{}await new Promise(r=>setTimeout(r,500));}
  if(!ready)throw Error();
  const binding=docker(['port',name,'5432/tcp']);if(!/^127\.0\.0\.1:\d+$/.test(binding))throw Error();
  console.log('PG18 disposable loopback rehearsal ready');
  const all=process.argv.includes('--all'),marker=randomUUID();
  if(all){
    docker(['exec',name,'createdb','-U','postgres','sec_contract_test']);
    const identity=await readFile(new URL('../lib/services/postgres/identity.sql',import.meta.url),'utf8');
    docker(['exec',name,'psql','-U','postgres','-d','sec_contract_test','-v','ON_ERROR_STOP=1','-c',identity+
      ` INSERT INTO sec_admin.database_identity(environment,database_instance_id) VALUES ('test','${marker}'); CREATE TABLE public.sec_local_test_marker(marker text PRIMARY KEY); INSERT INTO public.sec_local_test_marker VALUES ('${marker}');`]);
  }
  const child=spawn(process.execPath,['node_modules/tsx/dist/cli.mjs','--import','./scripts/test-server-only.mjs','--test',all?'lib/**/*.test.ts':'lib/services/secProvisioning.test.ts'],
    {stdio:'inherit',env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,TEMP:process.env.TEMP,LOCALAPPDATA:process.env.LOCALAPPDATA,
      SEC_PROVISIONING_LOCAL:'1',SEC_PROVISIONING_PORT:binding.split(':')[1],SEC_PROVISIONING_CONTAINER:name,
      SEC_PG_TEST_ENABLED:all?'1':'0',SEC_PG_CLOUD_TEST_ENABLED:'0',SEC_PG_TEST_PORT:binding.split(':')[1],SEC_PG_TEST_MARKER:marker,
      DATABASE_ENV:'test',SEC_PG_EXPECTED_INSTANCE_ID:marker,SEC_PG_EXPECTED_DATABASE:'sec_contract_test'}});
  const timer=setTimeout(()=>child.kill(),180000);
  try{process.exitCode=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',c=>resolve(c??1));});}finally{clearTimeout(timer);}
}catch{console.error('Local provisioning rehearsal failed; external databases never used');process.exitCode=1;}
finally{if(created){try{docker(['rm','-f',name]);console.log('Dedicated rehearsal container/tmpfs removed');}catch{console.error('Dedicated rehearsal cleanup failed');process.exitCode=1;}}}
