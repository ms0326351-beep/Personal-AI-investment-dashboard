// Test-only runner. Credentials must be supplied in process memory by the caller.
import { spawn } from 'node:child_process';
const repeat=Number(process.argv.find(a=>a.startsWith('--repeat='))?.split('=')[1]??1);
if(!Number.isInteger(repeat)||repeat<1||repeat>3)throw new Error('Invalid repeat count');
const pattern=process.argv.find(a=>a.startsWith('--pattern='))?.slice(10);
for(let run=1;run<=repeat;run++){
  process.stdout.write(`CLOUD_RUN ${run} START\n`);
  let current='',completed='',last='',buffer='',failed=false;
  const recent=[];
  const args=['node_modules/tsx/dist/cli.mjs','--import','./scripts/test-server-only.mjs','--test','--test-reporter=spec',
    '--test-timeout=90000',...(pattern?[`--test-name-pattern=${pattern}`]:[]),'lib/services/secPostgres.test.ts'];
  const child=spawn(process.execPath,args,{env:{...process.env,SEC_PG_CLOUD_TRACE:'1'},stdio:['ignore','pipe','pipe']});
  const consume=line=>{
    if(line.startsWith('SEC_TEST ')){
      last=line;recent.push(line);if(recent.length>80)recent.shift();
      if(line.startsWith('SEC_TEST START ')){current=line.slice(15);process.stdout.write(line+'\n');}
      if(line.startsWith('SEC_TEST DONE ')){completed=line.slice(14);process.stdout.write(line+'\n');}
      if(line.includes('TIMEOUT')||line.includes(' failed '))process.stdout.write(line+'\n');
    }else if(/^ℹ (tests|pass|fail|cancelled|skipped|duration)|^Cloud PostgreSQL|^[✔✖]/u.test(line)){
      if(line.startsWith('✖')){failed=true;process.stdout.write(recent.join('\n')+'\n');}
      process.stdout.write(line+'\n');
    }
  };
  child.stdout.on('data',data=>{buffer+=data;let i;while((i=buffer.indexOf('\n'))>=0){consume(buffer.slice(0,i));buffer=buffer.slice(i+1);}});
  // Never forward raw driver errors, options, credentials or query parameters.
  child.stderr.on('data',()=>{});
  const heartbeat=setInterval(()=>process.stdout.write(`CLOUD_PROGRESS current=${current} lastCompleted=${completed} step=${last}\n`),15000);
  const watchdog=setTimeout(()=>{process.stdout.write('CLOUD_RUN overall timeout\n');child.kill();},480000);
  const code=await new Promise(resolve=>{child.on('error',()=>resolve(1));child.on('close',code=>resolve(code??1));});
  clearInterval(heartbeat);clearTimeout(watchdog);
  if(buffer)consume(buffer);
  process.stdout.write(`CLOUD_RUN ${run} END exit=${code}\n`);
  if(code||failed){process.exitCode=code||1;break;}
}
