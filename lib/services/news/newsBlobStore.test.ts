import test from 'node:test';
import assert from 'node:assert/strict';
import { getStore } from '@netlify/blobs';
import { getNewsBlobStore, newsStoreScope } from './newsBlobStore';
import { createAnalysisRequestGuard } from '../newsAnalysisGuard';
import { createNewsAnalysisCache } from '../ai/newsAnalysisCache';
import { createNewsAnalysisService } from '../newsAnalysisService';
test('runtime scope selects exact factory, preserves strong consistency, ignores CONTEXT and rejects missing/invalid',()=>{
  const previous=process.env.NEWS_BLOB_STORE_SCOPE,context=process.env.CONTEXT;
  const calls:string[]=[];
  const fixture=getStore({name:'scope-fixture',siteID:'fixture-site',token:'fixture-placeholder',edgeURL:'https://fixture.invalid'});
  const factories={site:(options:Parameters<typeof getStore>[0])=>{calls.push('site');assert.equal(typeof options,'object');assert.equal((options as {consistency:string}).consistency,'strong');return fixture;},
    deploy:()=>{calls.push('deploy');return fixture;}};
  try {
    for(const runtimeContext of [undefined,'production','deploy-preview','branch-deploy']) {
      if(runtimeContext===undefined)delete process.env.CONTEXT;else process.env.CONTEXT=runtimeContext;
      for(const scope of ['site','deploy']) {
        process.env.NEWS_BLOB_STORE_SCOPE=scope;
        assert.equal(newsStoreScope(),scope);assert.equal(getNewsBlobStore('news-ai-analysis',factories),fixture);assert.equal(calls.at(-1),scope);
      }
      for(const scope of [undefined,'','invalid']) {
        if(scope===undefined)delete process.env.NEWS_BLOB_STORE_SCOPE;else process.env.NEWS_BLOB_STORE_SCOPE=scope;
        const count=calls.length;
        assert.throws(()=>getNewsBlobStore('news-ai-analysis',factories),/NEWS_BLOB_STORE_SCOPE/);assert.equal(calls.length,count);
      }
    }
  } finally {
    if(previous===undefined)delete process.env.NEWS_BLOB_STORE_SCOPE;else process.env.NEWS_BLOB_STORE_SCOPE=previous;
    if(context===undefined)delete process.env.CONTEXT;else process.env.CONTEXT=context;
  }
});
test('missing/invalid runtime scope denies guard, lease, budget and provider without leaking config',async()=>{
  const previous=process.env.NEWS_BLOB_STORE_SCOPE;
  try {
    for(const scope of [undefined,'invalid']) {
      if(scope===undefined)delete process.env.NEWS_BLOB_STORE_SCOPE;else process.env.NEWS_BLOB_STORE_SCOPE=scope;
      assert.equal((await createAnalysisRequestGuard().check())?.status,503);
      const cache=createNewsAnalysisCache(undefined,Date.now,()=>{},()=>true);
      await assert.rejects(cache.acquireLease('scope-check','owner'),/coordination unavailable/);
      await assert.rejects(cache.reserveBudget('2026-10-16',50,'owner'),/coordination unavailable/);
      let calls=0;
      const service=createNewsAnalysisService({cache,requireSharedCoordination:()=>true,provider:{async analyzeNews(){calls++;throw Error('must not call');}}});
      const result=await service.getOrCreateAnalysis({id:'rss-scope',title:'NVIDIA reports earnings',summary:'Company announcement.',source:'Fixture',publishedAt:'2026-10-16T00:00:00Z',relatedSymbols:['NVDA'],origin:'rss'},[],[]);
      assert.equal(result.status,'unavailable');assert.equal(result.market,null);assert.equal(calls,0);assert.ok(!JSON.stringify(result).includes('NEWS_BLOB_STORE_SCOPE'));
    }
  } finally {if(previous===undefined)delete process.env.NEWS_BLOB_STORE_SCOPE;else process.env.NEWS_BLOB_STORE_SCOPE=previous;}
});
