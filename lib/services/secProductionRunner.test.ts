import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync,writeFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve,dirname,basename } from 'node:path';
import { pathToFileURL } from 'node:url';

// Child processes intentionally do not inherit NODE_OPTIONS, DB settings or
// test-server-only hooks. They use the actual installed package and tsx CLI.
const env:NodeJS.ProcessEnv={NODE_ENV:'test',PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,TEMP:process.env.TEMP,LOCALAPPDATA:process.env.LOCALAPPDATA};
const cwd=resolve(import.meta.dirname,'../..');
const require=createRequire(import.meta.url);
test('E0.1 installed server-only resolves and loads under real react-server condition',()=>{
  const r=spawnSync(process.execPath,['--conditions=react-server','-e',"const p=require.resolve('server-only'); require('server-only'); console.log(p)"],{cwd,env,encoding:'utf8',timeout:15000});
  assert.equal(r.status,0);assert.match(r.stdout,/server-only[\\/]empty\.js/);assert.equal(r.stderr,'');
});
test('E0.1 default server-only export continues to reject unsupported client/default context',()=>{
  const r=spawnSync(process.execPath,['-e',"try { require('server-only'); process.exit(2); } catch(e) { if(!e.message.includes('Client Component'))process.exit(3); }"],{cwd,env,encoding:'utf8',timeout:15000});
  assert.equal(r.status,0);assert.equal(r.stderr,'');
});
for(const mode of ['discovery','verify'])test(`E0.1 standalone tsx ${mode} loads without alias and fails closed before any DB call`,()=>{
  const dir=mkdtempSync(join(tmpdir(),'sec-runner-loading-'));
  try{
    const guard=join(dir,'db-guard.cjs');
    // Only DB boundaries are instrumented. No module resolution hooks or
    // server-only aliases/mocks; any connection/query attempt fails the test.
    writeFileSync(guard,`const pg=require(${JSON.stringify(require.resolve('pg'))});
let calls=0;
for(const type of [pg.Pool,pg.Client])for(const method of ['connect','query'])type.prototype[method]=function(){calls++;throw Error('Unexpected database boundary call');};
process.on('exit',()=>console.error('DB_BOUNDARY_CALLS='+calls));
`);
    const r=spawnSync(process.execPath,['node_modules/tsx/dist/cli.mjs','--conditions=react-server','--import',pathToFileURL(guard).href,'scripts/sec-production-preflight.ts','--mode',mode],{cwd,env,encoding:'utf8',timeout:15000});
    assert.equal(r.error,undefined);assert.equal(r.status,1);assert.equal(r.stdout,'');
    assert.doesNotMatch(r.stderr,/MODULE_NOT_FOUND|Cannot find module|INVALID_MODE/);
    const lines=r.stderr.trim().split(/\r?\n/);
    assert.deepEqual(JSON.parse(lines[0]),{status:'FAILED',code:mode==='discovery'?'INVALID_CONFIGURATION':'QUERY_FAILED'});
    assert.equal(lines[1],'DB_BOUNDARY_CALLS=0');assert.equal(lines.length,2);
  }finally{
    assert.equal(dirname(resolve(dir)),resolve(tmpdir()));
    assert.ok(basename(dir).startsWith('sec-runner-loading-'));
    rmSync(dir,{recursive:true,force:true});
  }
});
