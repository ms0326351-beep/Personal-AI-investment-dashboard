// Disposable loopback-only real PostgreSQL runner. No DB URLs/credentials/env files.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const installed=join(process.env.LOCALAPPDATA??'', 'Programs','DockerDesktop','resources','bin','docker.exe');
const docker=existsSync(installed)?installed:'docker';
const suffix=randomUUID().replaceAll('-',''),name=`investment-sec-pg-${suffix}`,marker=randomUUID();
const image='postgres:17@sha256:d74eeac9a635390a49bc21bd49fccd973de707e2a53a76ac49b552b8712ec46f';
const run=(args)=>execFileSync(docker,args,{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
let created=false;
try {
  run(['run','--detach','--name',name,'--label','investment-dashboard.stage=2c3d',
    '--publish','127.0.0.1::5432','--tmpfs','/var/lib/postgresql/data',
    '-e','POSTGRES_HOST_AUTH_METHOD=trust','-e','POSTGRES_DB=sec_contract_test',image]);
  created=true;
  let ready=false;
  for(let i=0;i<60;i++){
    try{run(['exec',name,'pg_isready','-h','127.0.0.1','-U','postgres','-d','sec_contract_test']);ready=true;break;}catch{}
    await new Promise(resolve=>setTimeout(resolve,500));
  }
  if(!ready)throw new Error('Local PostgreSQL did not become ready');
  run(['exec',name,'psql','-U','postgres','-d','sec_contract_test','-v','ON_ERROR_STOP=1','-c',
    `CREATE TABLE public.sec_local_test_marker (marker text PRIMARY KEY); INSERT INTO public.sec_local_test_marker VALUES ('${marker}');`]);
  const binding=run(['port',name,'5432/tcp']);
  if(!/^127\.0\.0\.1:\d+$/.test(binding))throw new Error('Unexpected test port binding');
  const port=binding.split(':')[1];
  const version=run(['exec',name,'psql','-U','postgres','-d','sec_contract_test','-Atc','SHOW server_version']);
  process.stdout.write(`Disposable local PostgreSQL ${version}; loopback isolation verified.\n`);
  // --all includes existing repository tests in the SAME run with PG enabled.
  const args=process.argv.includes('--all')?['--test','lib/**/*.test.ts']:['--test','lib/services/secPostgres.test.ts'];
  const child=spawn(process.execPath,['node_modules/tsx/dist/cli.mjs','--import','./scripts/test-server-only.mjs',...args],
    {stdio:'inherit',env:{...process.env,SEC_PG_TEST_ENABLED:'1',SEC_PG_TEST_PORT:port,SEC_PG_TEST_MARKER:marker}});
  const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',(code)=>resolve(code??1));});
  process.exitCode=code;
}catch{
  process.stderr.write('Local PostgreSQL runner failed; no external database was used.\n');process.exitCode=1;
}finally{
  if(created){
    // Exact container created by this process; no volumes/other containers removed.
    try{run(['rm','--force',name]);process.stdout.write('Disposable PostgreSQL container removed.\n');}
    catch{process.stderr.write(`Cleanup failed for dedicated test container ${name}.\n`);process.exitCode=1;}
  }
}
