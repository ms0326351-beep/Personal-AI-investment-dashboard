import test from 'node:test';
import assert from 'node:assert/strict';
import { getStore } from '@netlify/blobs';
import { createNewsBlobFetch } from './news/newsBlobStore';
import { createNewsAnalysisCache, type AnalysisBlobStore } from './ai/newsAnalysisCache';
import { createAnalysisRequestGuard } from './newsAnalysisGuard';
import { createNewsAnalysisService } from './newsAnalysisService';
import type { NewsItem } from '../types';

const item:NewsItem={id:'rss-b1',title:'NVIDIA news',summary:'Company reports earnings.',source:'Fixture',publishedAt:'2026-10-06T00:00:00Z',relatedSymbols:['NVDA'],origin:'rss'};
// Real installed SDK, with HTTP transport replaced; no external request or secret.
function sdk(failure:number|'network'|'timeout', conditionalConflict=false, budgetOnly=false) {
  let puts=0;
  const fetcher:typeof fetch=async (url,init)=>{
    if(init?.method?.toUpperCase()!=='PUT') return new Response('',{status:404});
    puts++;
    if(budgetOnly && !decodeURIComponent(String(url)).includes('budget:')) return new Response('',{status:200});
    if(failure==='network') throw Error('private-upstream-detail');
    if(failure==='timeout') throw new DOMException('private-upstream-detail','TimeoutError');
    return new Response('',{status:conditionalConflict?412:failure});
  };
  const store=getStore({name:'b1-fixture',siteID:'fixture-site',token:'fixture-placeholder',edgeURL:'https://fixture.invalid',uncachedEdgeURL:'https://fixture.invalid',fetch:createNewsBlobFetch(fetcher)});
  return {store,puts:()=>puts};
}
for(const failure of [401,403,429,500,'network'] as const) {
  test(`B1 ${failure} budget failure after acquired lease still prevents provider`,async()=>{
    const transport=sdk(failure,false,true);
    const cache=createNewsAnalysisCache(()=>transport.store,Date.now,()=>{},()=>true);
    let calls=0;
    const service=createNewsAnalysisService({cache,requireSharedCoordination:()=>true,provider:{async analyzeNews(){calls++;throw Error('must not run');}}});
    const result=await service.getOrCreateAnalysis(item,[],[]);
    assert.equal(result.status,'unavailable');assert.equal(result.market,null);assert.equal(calls,0);
  });
}
for(const failure of [401,403,429,500,'network','timeout'] as const) {
  test(`B1 actual SDK ${failure}: guard, lease, budget and provider fail closed`,async()=>{
    const transport=sdk(failure);
    const cache=createNewsAnalysisCache(()=>transport.store,Date.now,()=>{},()=>true);
    const guard=createAnalysisRequestGuard(()=>transport.store);
    assert.equal((await guard.check())?.status,503);
    await assert.rejects(cache.acquireLease('article','owner'),/coordination unavailable/);
    await assert.rejects(cache.reserveBudget('2026-10-06',50,'owner'),/coordination unavailable/);
    let calls=0;
    const service=createNewsAnalysisService({cache,requireSharedCoordination:()=>true,provider:{async analyzeNews(){calls++;throw Error('must not run');}}});
    for(const retry of [false,true]) {
      const result=await service.getOrCreateAnalysis(item,[],[],retry);
      assert.equal(result.status,'unavailable');assert.equal(result.market,null);
      assert.doesNotMatch(JSON.stringify(result),/private-upstream-detail|fixture-placeholder|fixture.invalid/);
    }
    assert.equal(calls,0);
    assert.equal(await cache.getCachedAnalysis('rss-b1:v2:gpt-4.1-mini'),null);
    assert.ok(transport.puts()<=30,'SDK retries are bounded (five operations, six attempts each)');
  });
}
test('B1 real SDK 412 remains unresolved conditional conflict; no provider call',async()=>{
  const transport=sdk(412,true);
  assert.deepEqual(await transport.store.setJSON('key',{}, {onlyIfNew:true}),{modified:false});
  const cache=createNewsAnalysisCache(()=>transport.store,Date.now,()=>{},()=>true);
  assert.equal(await cache.acquireLease('article','owner'),false);
  assert.equal(await cache.reserveBudget('day',50,'owner'),false);
  assert.equal((await createAnalysisRequestGuard(()=>transport.store).check())?.status,429);
  let calls=0;
  const service=createNewsAnalysisService({cache,requireSharedCoordination:()=>true,wait:async()=>{},provider:{async analyzeNews(){calls++;throw Error('must not run');}}});
  assert.equal((await service.getOrCreateAnalysis(item,[],[])).status,'unavailable');
  assert.equal(calls,0);
});
test('B1 unexpected HTTP responses and unconditional 412 are rejected safely',async()=>{
  for(const status of [302,400,404,412]) {
    const fetcher=createNewsBlobFetch(async()=>new Response('',{status}));
    await assert.rejects(fetcher('https://fixture.invalid',{method:'PUT'}),/^Error: News shared storage unavailable$/);
  }
});
test('B1 successful write and conditional If-Match conflict retain SDK semantics',async()=>{
  const fetcher=createNewsBlobFetch(async()=>new Response('',{status:200}));
  assert.equal((await fetcher('https://fixture.invalid',{method:'PUT'})).status,200);
  const conflict=createNewsBlobFetch(async()=>new Response('',{status:412}));
  assert.equal((await conflict('https://fixture.invalid',{method:'PUT',headers:{'if-match':'revision'}})).status,412);
});
test('B1 malformed SDK write result cannot grant guard or shared capacity',async()=>{
  const broken:AnalysisBlobStore={async getWithMetadata(){return null;},async setJSON(){return {modified:undefined} as unknown as {modified:boolean};}};
  assert.equal((await createAnalysisRequestGuard(()=>broken).check())?.status,503);
  const cache=createNewsAnalysisCache(()=>broken,Date.now,()=>{},()=>true);
  await assert.rejects(cache.acquireLease('key','owner'));
  await assert.rejects(cache.reserveBudget('day',50,'owner'));
});
