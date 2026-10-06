import test from 'node:test';
import assert from 'node:assert/strict';
import { createAnalysisRequestGuard, analysisRequestError } from './newsAnalysisGuard';
import type { AnalysisBlobStore } from './ai/newsAnalysisCache';
import { newsStoreScope } from './news/newsBlobStore';
function fakeBlobStore():AnalysisBlobStore {
  const data=new Map<string,{value:unknown;version:number}>();
  return {async getWithMetadata(key){const row=data.get(key);return row?{data:structuredClone(row.value),etag:String(row.version)}:null},async setJSON(key,value,condition){
    const old=data.get(key);
    if(condition&&(('onlyIfNew' in condition&&old)||('onlyIfMatch' in condition&&condition.onlyIfMatch!==String(old?.version))))return {modified:false};
    data.set(key,{value:structuredClone(value),version:(old?.version??0)+1});return {modified:true};
  }};
}

test('request guard rejects cross-site, body and absent intent while allowing bodyless same-origin POST',async()=>{
  const headers={'X-News-Analysis-Request':'1',Origin:'https://app.invalid'};
  assert.equal((await analysisRequestError(new Request('https://app.invalid',{method:'POST',headers}))),null);
  assert.equal((await analysisRequestError(new Request('https://app.invalid',{method:'POST',headers,body:''}))),null);
  assert.equal((await analysisRequestError(new Request('http://localhost:3011',{method:'POST',headers:{...headers,Host:'127.0.0.1:3011',Origin:'http://127.0.0.1:3011'}}))),null);
  assert.equal((await analysisRequestError(new Request('http://localhost:3011',{method:'POST',headers:{...headers,Host:'127.0.0.1:3011',Origin:'http://other.invalid:3011'}})))?.status,403);
  assert.equal((await analysisRequestError(new Request('https://app.invalid',{method:'POST',headers:{...headers,Origin:'null'}})))?.status,403);
  assert.equal((await analysisRequestError(new Request('https://app.invalid',{method:'POST',headers:{...headers,'Sec-Fetch-Site':'cross-site'}})))?.status,403);
  assert.equal((await analysisRequestError(new Request('https://app.invalid',{method:'POST',headers,body:'x'.repeat(10000)})))?.status,413);
});
test('shared request cap survives new instances and concurrent calls, resets at minute boundary',async()=>{
  const blobs=fakeBlobStore();let time=60000;
  const first=createAnalysisRequestGuard(()=>blobs,()=>time),second=createAnalysisRequestGuard(()=>blobs,()=>time);
  for(let i=0;i<28;i++) assert.equal(await first.check(),null);
  const results=await Promise.all(Array.from({length:10},()=>second.check()));
  assert.equal(results.filter(r=>r===null).length,2);
  assert.ok(results.filter(Boolean).every(r=>r?.status===429));
  assert.equal((await createAnalysisRequestGuard(()=>blobs,()=>time).check())?.status,429);
  time+=60000;assert.equal(await second.check(),null);
});
test('request guard fails closed for outages and malformed shared state, never leaks backend details',async()=>{
  const result=await createAnalysisRequestGuard(()=>{throw Error('private-backend-detail')}).check();
  assert.equal(result?.status,503);assert.doesNotMatch(JSON.stringify(result),/private-backend-detail/);
  const invalid=createAnalysisRequestGuard(()=>({async getWithMetadata(){return {data:{count:-1},etag:'v'}},async setJSON(){throw Error('must not write')}}));
  assert.equal((await invalid.check())?.status,503);
});
test('only explicit production context uses production stores; branch/preview/unknown isolate data',()=>{
  assert.equal(newsStoreScope('production'),'production');
  for(const context of ['deploy-preview','branch-deploy','dev','', 'unknown']) assert.equal(newsStoreScope(context),'nonproduction');
});
