import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCacheKey, createNewsAnalysisCache, type AnalysisBlobStore } from './newsAnalysisCache';
import type { CachedNewsAnalysis } from '../../types/newsAnalysis';

export function fakeBlobStore(): AnalysisBlobStore {
  const entries=new Map<string,{data:unknown;etag:string}>(); let version=0;
  return {
    async getWithMetadata(k) { return structuredClone(entries.get(k) ?? null); },
    async setJSON(k,data,c) {
      const old=entries.get(k);
      if (c && (('onlyIfNew' in c && old) || ('onlyIfMatch' in c && old?.etag!==c.onlyIfMatch))) return {modified:false};
      entries.set(k,{data:structuredClone(data),etag:String(++version)}); return {modified:true};
    },
  };
}
const analysis: CachedNewsAnalysis={newsId:'rss-test',status:'unavailable',schemaVersion:'v1',modelVersion:'test-model',market:null,disclaimer:'非投資建議',analyzedAt:'2026-09-14T00:00:00Z',unavailableReason:'暫無分析'};
test('each cache key dimension isolates entries', () => {
  assert.equal(buildCacheKey('a','v1','m'),'a:v1:m');
  assert.equal(new Set([buildCacheKey('a','v1','m'),buildCacheKey('b','v1','m'),buildCacheKey('a','v2','m'),buildCacheKey('a','v1','m2')]).size,4);
});
test('both Blobs reads and writes failing still preserve memory results',async()=>{
  const cache=createNewsAnalysisCache(()=>({async getWithMetadata(){throw Error('offline')},async setJSON(){throw Error('offline')}}),Date.now,()=>{});
  assert.equal(await cache.getCachedAnalysis('a'),null);
  await cache.setCachedAnalysis('a',analysis,10);
  assert.deepEqual(await cache.getCachedAnalysis('a'),analysis);
});
test('persistent result survives a new cache instance without portfolio data',async()=>{
  const store=fakeBlobStore();
  const a=createNewsAnalysisCache(()=>store),b=createNewsAnalysisCache(()=>store);
  await a.setCachedAnalysis('a',{...analysis,portfolio:{private:'secret'}} as CachedNewsAnalysis,10);
  assert.deepEqual(await b.getCachedAnalysis('a'),analysis);
});
test('expiry is enforced for both persistent and memory entries',async()=>{
  let time=1000; const cache=createNewsAnalysisCache(()=>fake,()=>time); const fake=fakeBlobStore();
  await cache.setCachedAnalysis('a',analysis,10); time+=10000;
  assert.equal(await cache.getCachedAnalysis('a'),null);
});
test('failed persistent write remains readable even when later read returns missing',async()=>{
  const cache=createNewsAnalysisCache(()=>({async getWithMetadata(){return null},async setJSON(){throw Error('write')}}),Date.now,()=>{});
  await cache.setCachedAnalysis('a',analysis,10); assert.deepEqual(await cache.getCachedAnalysis('a'),analysis);
});
test('distributed leases exclude concurrent owners and expire',async()=>{
  let time=0; const store=fakeBlobStore(); const a=createNewsAnalysisCache(()=>store,()=>time),b=createNewsAnalysisCache(()=>store,()=>time);
  const results=await Promise.all([a.acquireLease('k','a'),b.acquireLease('k','b')]);
  assert.equal(results.filter(Boolean).length,1);
  await b.releaseLease('k','wrong'); assert.equal(await b.acquireLease('k','b'),false);
  time=91000; assert.equal(await b.acquireLease('k','b'),true);
});
test('atomic daily reservations prevent simultaneous requests exceeding limit',async()=>{
  const store=fakeBlobStore(); const a=createNewsAnalysisCache(()=>store),b=createNewsAnalysisCache(()=>store);
  assert.deepEqual((await Promise.all([a.reserveBudget('today',1,'a'),b.reserveBudget('today',1,'b')])).sort(),[false,true]);
  await a.finishBudget('today','a',true);
  assert.equal(await b.reserveBudget('today',1,'c'),false);
  assert.equal(await b.reserveBudget('tomorrow',1,'c'),true);
});
test('failed provider releases reserved budget; zero disables new analyses',async()=>{
  const store=fakeBlobStore(); const c=createNewsAnalysisCache(()=>store);
  assert.equal(await c.reserveBudget('d',0,'x'),false);
  await c.reserveBudget('d',1,'x'); await c.finishBudget('d','x',false);
  assert.equal(await c.reserveBudget('d',1,'y'),true);
});
test('a write outage and recovery never reset locally consumed daily capacity',async()=>{
  const store=fakeBlobStore();let broken=false;
  const cache=createNewsAnalysisCache(()=>({...store,async setJSON(k,v,c){if(broken)throw Error('offline');return store.setJSON(k,v,c)}}),Date.now,()=>{});
  await cache.reserveBudget('d',2,'a');await cache.finishBudget('d','a',true);
  broken=true;assert.equal(await cache.reserveBudget('d',2,'b'),true);await cache.finishBudget('d','b',true);
  broken=false;assert.equal(await cache.reserveBudget('d',2,'c'),false);
});
