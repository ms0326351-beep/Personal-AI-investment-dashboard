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
test('request-shape instrumentation accepts native bodyless representation without logging',async()=>{
  const logs:unknown[]=[];let acquisitions=0;
  const route=createPreviewBlobsDiagnostic(()=>({...config,url:'https://example.com'}),()=>{acquisitions++;throw Error();},fetch,fields=>logs.push(fields));
  const r=request();assert.equal(r.body,null);
  assert.equal((await route(r)).status,503); // Passed request validator; target deliberately unavailable.
  assert.equal(acquisitions,0);assert.deepEqual(logs,[]);
});
test('invalid body/query shape logs only safe metadata and never acquires storage',async()=>{
  const secretBody=randomBytes(24).toString('hex');
  const requests=[request({'content-length':'3'},url,secretBody),request({},`${url}?secret=${secretBody}`),
    request({'content-length':secretBody,'content-type':secretBody,'transfer-encoding':secretBody},url,secretBody)];
  for(const r of requests) {
    const logs:Record<string,string|boolean|number|null>[]=[];let acquisitions=0;
    const route=createPreviewBlobsDiagnostic(()=>config,()=>{acquisitions++;throw Error();},fetch,fields=>logs.push(fields));
    const response=await route(r);assert.equal(response.status,400);assert.deepEqual(await response.json(),{status:'INVALID_REQUEST'});
    assert.equal(acquisitions,0);assert.equal(logs.length,1);
    assert.deepEqual(Object.keys(logs[0]).sort(),['event','method','urlHasQuery','bodyIsNull','contentLengthPresent','contentLength','contentTypePresent','transferEncodingPresent'].sort());
    const text=JSON.stringify(logs);assert.ok(!text.includes(token));assert.ok(!text.includes(secretBody));
    assert.equal(logs[0].bodyIsNull,r.body===null);assert.equal(logs[0].urlHasQuery,Boolean(new URL(r.url).search));
    assert.equal(logs[0].contentLength,r.headers.get('content-length')==='3'?3:null);
  }
});
test('logger failure cannot change non-empty body rejection',async()=>{
  const route=createPreviewBlobsDiagnostic(()=>config,()=>{throw Error('must not acquire');},fetch,()=>{throw Error(token);});
  const r=new Request(url,{method:'POST',headers:{'X-Preview-Diagnostic-Token':token},body:'x'});
  assert.notEqual(r.body,null);
  const response=await route(r);
  assert.equal(response.status,400);assert.deepEqual(await response.json(),{status:'INVALID_REQUEST'});
});
function streamRequest(stream:ReadableStream<Uint8Array>,query='') {
  return new Request(url+query,{method:'POST',headers:{'X-Preview-Diagnostic-Token':token},body:stream,duplex:'half'} as RequestInit);
}
test('Netlify-like non-null zero-byte stream passes and completes disposable diagnostic',async()=>{
  const f=fixture();
  const readRoute=createPreviewBlobsDiagnostic(()=>config,()=>f.store);
  const route=createPreviewBlobsDiagnostic(()=>config,()=>f.store,async(input,init)=>readRoute(new Request(input,init)));
  const r=streamRequest(new ReadableStream({start(c){c.enqueue(new Uint8Array(0));c.close();}}));
  assert.notEqual(r.body,null);
  const response=await route(r);assert.equal(response.status,200);assert.equal((await response.json()).status,'PASS');assert.equal(f.values.size,0);
});
test('one-byte/text payload and empty/non-empty query reject before store acquisition',async()=>{
  const cases=[request({},url,'x'),request({},url,'normal text'),streamRequest(new ReadableStream({start(c){c.close();}}),'?x=1'),request({},url+'?x=1','x')];
  for(const r of cases) {
    let acquisitions=0;
    const route=createPreviewBlobsDiagnostic(()=>config,()=>{acquisitions++;throw Error();},fetch,()=>{});
    const response=await route(r);assert.equal(response.status,400);assert.deepEqual(await response.json(),{status:'INVALID_REQUEST'});assert.equal(acquisitions,0);
  }
});
test('errored stream fails closed and invalid gate never inspects body',async()=>{
  let acquisitions=0;
  const factory=()=>{acquisitions++;throw Error('must not acquire');};
  const r=streamRequest(new ReadableStream({start(c){c.error(Error(token));}}));
  const route=createPreviewBlobsDiagnostic(()=>config,factory,fetch,()=>{});
  assert.equal((await route(r)).status,400);assert.equal(acquisitions,0);
  const denied=request();Object.defineProperty(denied,'body',{get(){throw Error('body must not be inspected');}});
  const invalid=createPreviewBlobsDiagnostic(()=>({...config,enabled:'false'}),factory,fetch,()=>{});
  assert.equal((await invalid(denied)).status,403);assert.equal(acquisitions,0);
});
test('payload detection cancels immediately without waiting for more body',async()=>{
  let cancelled=false;
  const r=streamRequest(new ReadableStream({start(c){c.enqueue(new Uint8Array([1]));},cancel(){cancelled=true;}}));
  const route=createPreviewBlobsDiagnostic(()=>config,()=>{throw Error('must not acquire');},fetch,()=>{});
  assert.equal((await route(r)).status,400);assert.equal(cancelled,true);
});
test('stalled body inspection times out fail closed before storage',async()=>{
  let acquisitions=0;
  const route=createPreviewBlobsDiagnostic(()=>config,()=>{acquisitions++;throw Error();},fetch,()=>{});
  const response=await route(streamRequest(new ReadableStream()));
  assert.equal(response.status,400);assert.equal(acquisitions,0);
});

const crossCases:{name:string;fetcher:typeof fetch;stage:string;pass?:boolean;missing?:boolean}[]=[
  {name:'success',fetcher:async()=>Response.json({persisted:true}),stage:'response_received',pass:true},
  {name:'network',fetcher:async()=>{throw new TypeError(`${url} ${token}`);},stage:'fetch_error',missing:true},
  {name:'timeout',fetcher:async()=>{throw new DOMException(`${token} ${url}`,'TimeoutError');},stage:'timeout',missing:true},
  {name:'redirect',fetcher:async()=>new Response('{"persisted":true}',{status:302,headers:{'content-type':'application/json'}}),stage:'redirect_detected'},
  {name:'HTTP failure',fetcher:async()=>Response.json({persisted:true},{status:403}),stage:'http_status_invalid'},
  {name:'non-JSON',fetcher:async()=>new Response('<html>private</html>',{headers:{'content-type':'text/html'}}),stage:'content_type_invalid',missing:true},
  {name:'malformed JSON',fetcher:async()=>new Response('{broken', {headers:{'content-type':'application/json'}}),stage:'json_parse_error',missing:true},
  {name:'wrong shape',fetcher:async()=>Response.json({other:true}),stage:'payload_shape_invalid'},
  {name:'persisted false',fetcher:async()=>Response.json({persisted:false}),stage:'cross_request_result_false'},
];
for(const scenario of crossCases) test(`cross-request ${scenario.name}: safe stage evidence and cleanup`,async()=>{
  const f=fixture();const logs:Record<string,string|boolean|number|null>[]=[];
  const route=createPreviewBlobsDiagnostic(()=>config,()=>f.store,scenario.fetcher,fields=>logs.push(fields));
  const response=await route(request());const result=await response.json();
  assert.equal(response.status,scenario.pass?200:503);assert.equal(result.cleanup,true);
  assert.equal(f.values.size,0);assert.equal(f.deleted.length,3);
  assert.equal(result.results.crossRequest,scenario.missing?undefined:Boolean(scenario.pass));
  assert.ok(logs.some(l=>l.stage===scenario.stage));assert.equal(logs[0].stage,'fetch_start');
  for(const l of logs) {assert.equal(l.event,'preview_blobs_cross_request_failure');assert.equal(l.sameOrigin,true);assert.equal(l.targetKind,'preview-alias');assert.ok(Number(l.durationMs)>=0);}
  const text=JSON.stringify(logs);assert.ok(!text.includes(token));assert.ok(!text.includes(url));assert.ok(!text.includes('private'));assert.ok(!text.includes('preview-diagnostic/'));
});
test('cross-request logs sanitize arbitrary content type and preserve original semantics',async()=>{
  const f=fixture();const logs:Record<string,string|boolean|number|null>[]=[];
  const fetcher:typeof fetch=async(_input,init)=>{
    assert.equal(init?.redirect,'error');assert.ok(init?.signal);assert.equal(init?.method,'POST');
    return new Response('{"persisted":true}',{headers:{'content-type':`unsafe-${token}`}});
  };
  const response=await createPreviewBlobsDiagnostic(()=>config,()=>f.store,fetcher,fields=>logs.push(fields))(request());
  assert.equal(response.status,200); // Existing semantics do not require a particular MIME for valid JSON.
  assert.ok(logs.some(l=>l.stage==='content_type_invalid'&&l.contentType==='other'));
  assert.ok(!JSON.stringify(logs).includes(token));assert.equal(f.values.size,0);
});
