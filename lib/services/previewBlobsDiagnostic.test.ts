import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createPreviewBlobsDiagnostic } from './previewBlobsDiagnostic';
import { netlifyDiagnosticBuildMetadata } from '../../next.config';
const url='https://deploy-preview-1--fixture.netlify.app/api/diagnostics/blobs';
const token=randomBytes(32).toString('hex');
const config={context:'deploy-preview',enabled:'true',token,url};
function fixture(cleanupFails=false) {
  const values=new Map<string,{data:unknown;etag:string}>();let revision=0;let operations=0;const deleted:string[]=[];
  const store={async getWithMetadata(key:string){operations++;return values.get(key)??null;},async setJSON(key:string,data:unknown,conditions?:{onlyIfNew?:boolean;onlyIfMatch?:string}) {
    operations++;const old=values.get(key);
    if(conditions?.onlyIfNew&&old||conditions?.onlyIfMatch&&conditions.onlyIfMatch!==old?.etag)return {modified:false};
    values.set(key,{data,etag:String(++revision)});return {modified:true};
  },async delete(key:string){deleted.push(key);if(cleanupFails)throw Error(token);values.delete(key);}};
  return {store,values,deleted,operations:()=>operations};
}
const request=(headers:Record<string,string>={},path=url,body?:string)=>new Request(path,{method:'POST',headers:{'X-Preview-Diagnostic-Token':token,...headers},...(body?{body}: {})});
for(const context of ['production','branch-deploy',undefined])test(`reject ${context} before storage`,async()=>{
  const f=fixture();const route=createPreviewBlobsDiagnostic(()=>({...config,context}),()=>f.store);
  assert.equal((await route(request())).status,403);assert.equal(f.operations(),0);
});
test('missing enable/token and wrong token reject before storage',async()=>{
  for(const c of [{...config,enabled:undefined},{...config,token:undefined},config]) {
    const f=fixture();const route=createPreviewBlobsDiagnostic(()=>c,()=>f.store);
    assert.equal((await route(request({'X-Preview-Diagnostic-Token':'wrong'}))).status,403);assert.equal(f.operations(),0);
  }
});
test('client body/query/unsigned run cannot choose store or key',async()=>{
  const f=fixture();const route=createPreviewBlobsDiagnostic(()=>config,()=>f.store);
  for(const r of [request({},url,JSON.stringify({store:'production',key:'quota'})),request({},`${url}?key=quota`),request({'X-Preview-Diagnostic-Receipt':'arbitrary-key'})]) assert.ok((await route(r)).status>=400);
  assert.equal(f.operations(),0);
});
test('create/CAS/race and separate protected read request pass then cleanup only own keys',async()=>{
  const f=fixture();let separateRequests=0;
  const readRoute=createPreviewBlobsDiagnostic(()=>config,()=>f.store);
  const fetcher:typeof fetch=async(input,init)=>{separateRequests++;return readRoute(new Request(input,init));};
  const route=createPreviewBlobsDiagnostic(()=>config,()=>f.store,fetcher);
  const response=await route(request());const text=await response.text();const result=JSON.parse(text);
  assert.equal(response.status,200);assert.equal(result.status,'PASS');assert.equal(result.cleanup,true);
  assert.equal(separateRequests,1);assert.equal(f.values.size,0);assert.equal(f.deleted.length,3);
  assert.ok(f.deleted.every(k=>k.startsWith(`preview-diagnostic/${result.runId}/`)));
  assert.doesNotMatch(text,new RegExp(token));assert.deepEqual(Object.values(result.results),[true,true,true,true,true,true]);
});
test('storage failure is sanitized and all three cleanup attempts run',async()=>{
  const f=fixture();f.store.setJSON=async()=>{throw Error(token);};
  const response=await createPreviewBlobsDiagnostic(()=>config,()=>f.store)(request());
  assert.equal(response.status,503);assert.equal(f.deleted.length,3);assert.ok(!(await response.text()).includes(token));
});
test('cleanup failure explicitly fails without leaking upstream details',async()=>{
  const f=fixture(true);const response=await createPreviewBlobsDiagnostic(()=>config,()=>f.store,async()=>Response.json({persisted:true}))(request());
  const text=await response.text();assert.equal(response.status,503);assert.equal(JSON.parse(text).cleanup,false);assert.ok(!text.includes(token));assert.equal(f.deleted.length,3);
});
test('wrong preview target refuses storage operations',async()=>{
  const f=fixture();const response=await createPreviewBlobsDiagnostic(()=>({...config,url:'https://example.com'}),()=>f.store)(request());
  assert.equal(response.status,503);assert.equal(f.operations(),0);
});

test('gate denial logs exactly safe metadata before any store acquisition',async()=>{
  const mismatch=randomBytes(32).toString('hex');
  const cases=[
    {c:{...config,context:'production'},header:token},
    {c:{...config,context:'branch-deploy'},header:token},
    {c:{...config,enabled:'false'},header:token},
    {c:{...config,token:undefined},header:token},
    {c:config,header:undefined},
    {c:config,header:mismatch},
  ];
  for(const {c,header} of cases) {
    const logs:Record<string,string|boolean|number|null>[]=[];let acquisitions=0;
    const route=createPreviewBlobsDiagnostic(()=>c,()=>{acquisitions++;throw Error('must not acquire');},fetch,fields=>logs.push(fields));
    const response=await route(new Request(url,{method:'POST',headers:header?{'X-Preview-Diagnostic-Token':header}:{}}));
    assert.equal(response.status,403);assert.deepEqual(await response.json(),{status:'DENIED'});
    assert.equal(acquisitions,0);assert.equal(logs.length,1);
    assert.deepEqual(Object.keys(logs[0]).sort(),['event','context','contextOk','enabledPresent','enabledOk','envTokenPresent','envTokenLength','headerPresent','headerLength','tokenMatch'].sort());
    const text=JSON.stringify(logs);assert.ok(!text.includes(token));assert.ok(!text.includes(mismatch));
    assert.equal(logs[0].envTokenLength,c.token?.length??0);assert.equal(logs[0].headerLength,header?.length??0);
    assert.equal(logs[0].tokenMatch,Boolean(c.token)&&header===c.token);
  }
});
test('valid gate emits no denial log and logger failure still denies without storage',async()=>{
  let logs=0;
  const valid=createPreviewBlobsDiagnostic(()=>({...config,url:'https://example.com'}),()=>{throw Error('must not acquire');},fetch,()=>{logs++;});
  assert.equal((await valid(request())).status,503);assert.equal(logs,0);
  const denied=createPreviewBlobsDiagnostic(()=>({...config,enabled:undefined}),()=>{throw Error('must not acquire');},fetch,()=>{throw Error(token);});
  const response=await denied(request());assert.equal(response.status,403);assert.equal(await response.text(),'{"status":"DENIED"}');
});
test('build metadata accepts platform Preview only and never captures secrets',()=>{
  assert.deepEqual(netlifyDiagnosticBuildMetadata({NETLIFY:'true',CONTEXT:'deploy-preview',DEPLOY_PRIME_URL:url,PREVIEW_BLOBS_DIAGNOSTIC_TOKEN:token}),{PREVIEW_DIAGNOSTIC_BUILD_CONTEXT:'deploy-preview',PREVIEW_DIAGNOSTIC_BUILD_URL:new URL(url).origin});
  for(const env of [{},{CONTEXT:'deploy-preview'},{NETLIFY:'true'},{NETLIFY:'true',CONTEXT:'invalid'}]) assert.equal(netlifyDiagnosticBuildMetadata(env).PREVIEW_DIAGNOSTIC_BUILD_CONTEXT,'unknown');
  for(const context of ['production','branch-deploy']) {
    const metadata=netlifyDiagnosticBuildMetadata({NETLIFY:'true',CONTEXT:context,DEPLOY_PRIME_URL:url});
    assert.equal(metadata.PREVIEW_DIAGNOSTIC_BUILD_CONTEXT,context);assert.equal(metadata.PREVIEW_DIAGNOSTIC_BUILD_URL,'');
  }
});
test('spoofed Host/context headers cannot override missing or Production build context',async()=>{
  for(const context of [undefined,'production','branch-deploy','unknown']) {
    let acquisitions=0;
    const route=createPreviewBlobsDiagnostic(()=>({...config,context}),()=>{acquisitions++;throw Error();},fetch,()=>{});
    const response=await route(request({Host:'deploy-preview-1--fixture.netlify.app','X-Netlify-Context':'deploy-preview','X-Forwarded-Host':'deploy-preview-1--fixture.netlify.app'}));
    assert.equal(response.status,403);assert.equal(acquisitions,0);
  }
});
