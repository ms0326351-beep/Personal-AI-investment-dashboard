import test from 'node:test';
import assert from 'node:assert/strict';
import { createNewsAnalysisService, getNewsAIDailyLimit } from './newsAnalysisService';
import { createNewsAnalysisCache, buildCacheKey, type AnalysisBlobStore } from './ai/newsAnalysisCache';
import { createNewsAnalysisProvider } from './ai/newsAnalysisProvider';
import type { NewsItem, Holding } from '../types';
import type { MarketImpactAnalysis } from '../types/newsAnalysis';
import { deepFixture, directFixture, indirectFixture } from '../utils/deepNewsAnalysis.fixture';
import { NewsAnalysisError } from './ai/newsAnalysisError';
const item:NewsItem={id:'rss-first',title:'NVIDIA discusses Fed rate cut',summary:'Jensen Huang discusses demand.',source:'Test',publishedAt:'2026-09-14T00:00:00Z',relatedSymbols:['NVDA'],relatedPersonIds:['jensen-huang'],origin:'rss'};
const market:MarketImpactAnalysis={...deepFixture,securityImpacts:[{...directFixture,evidenceQuote:'NVIDIA'},{...indirectFixture,symbol:'QQQ',linkage:'macro',anchorSymbol:'',evidenceQuote:'Fed rate cut'}],explicitlyMentionedSymbols:['NVDA'],inferredSymbols:['QQQ'],relatedPersonIds:['jensen-huang'],relatedTopics:['AI'],eventType:'monetary-policy',impactDirection:'uncertain',impactLevel:'low',conclusion:'可能影響供應鏈。',reasoning:'需求→半導體→NVDA，仍需觀察。'};
const holding:Holding={id:'private-holding',symbol:'NVDA',shares:123.456,avgCost:765.432,buyDate:'2021-02-03'};
function store():AnalysisBlobStore {
  const values=new Map<string,{data:unknown;etag:string}>();let revision=0;
  return {async getWithMetadata(k){return structuredClone(values.get(k)??null)},async setJSON(k,data,c){
    const old=values.get(k);if(c && (('onlyIfNew' in c && old)||('onlyIfMatch' in c && c.onlyIfMatch!==old?.etag)))return {modified:false};
    values.set(k,{data:structuredClone(data),etag:String(++revision)});return {modified:true};
  }};
}
const setup=(provider:ReturnType<typeof createNewsAnalysisProvider>={async analyzeNews(){return market}},extra:Parameters<typeof createNewsAnalysisService>[0]={})=>{
  const blobs=store();const cache=createNewsAnalysisCache(()=>blobs);
  return createNewsAnalysisService({cache,provider,model:()=> 'test-model',...extra});
};
test('repeat and concurrent calls share one provider invocation; portfolio stays per caller',async()=>{
  let calls=0;const service=setup({async analyzeNews(){calls++;await Promise.resolve();return market}});
  const [a,b]=await Promise.all([service.getOrCreateAnalysis(item,[holding],[]),service.getOrCreateAnalysis(item,[],['QQQ'])]);
  const c=await service.getOrCreateAnalysis(item,[],[]);
  assert.equal(calls,1);assert.equal(a.portfolio?.portfolioRelevance,'direct');assert.equal(b.portfolio?.portfolioRelevance,'indirect');assert.equal(c.portfolio?.portfolioRelevance,'none');
  assert.deepEqual(a.portfolio?.affectedHoldings,[holding]);
});
test('provider failure is cached unavailable without error details',async()=>{
  let calls=0;const service=setup({async analyzeNews(){calls++;throw Error('secret-provider-detail')}});
  for(let i=0;i<2;i++){const r=await service.getOrCreateAnalysis(item,[],[]);assert.equal(r.status,'unavailable');assert.equal(r.market,null);assert.equal(r.portfolio,null);assert.doesNotMatch(JSON.stringify(r),/secret-provider-detail/);}
  assert.equal(calls,1);
});
test('Blobs read and write outages use process cache without throwing',async()=>{
  let calls=0;const cache=createNewsAnalysisCache(()=>{throw Error('offline')},Date.now,()=>{});
  const s=setup({async analyzeNews(){calls++;return market}},{cache});
  assert.equal((await s.getOrCreateAnalysis(item,[],[])).status,'ok');await s.getOrCreateAnalysis(item,[],[]);assert.equal(calls,1);
});
test('even a cache adapter throwing on every method is contained',async()=>{
  let calls=0;const cache=createNewsAnalysisCache(()=>store());
  const broken=Object.fromEntries(Object.keys(cache).map(k=>[k,async()=>{throw Error('adapter broken')}])) as unknown as typeof cache;
  const s=setup({async analyzeNews(){calls++;return market}},{cache:broken});
  assert.equal((await s.getOrCreateAnalysis(item,[],[])).status,'ok');await s.getOrCreateAnalysis(item,[],[]);assert.equal(calls,1);
});
test('daily limit one rejects a second article and still serves cached first',async()=>{
  let calls=0;const s=setup({async analyzeNews(){calls++;return market}},{dailyLimit:()=>1});
  await s.getOrCreateAnalysis(item,[],[]);
  const r=await s.getOrCreateAnalysis({...item,id:'rss-second'},[],[]);
  assert.equal(r.unavailableReason,'今日 AI 分析次數已達上限');assert.equal(calls,1);
  assert.equal((await s.getOrCreateAnalysis(item,[],[])).status,'ok');
});
test('same article across service/cache instances is deduped by persistent lease',async()=>{
  const blobs=store();let calls=0;
  const provider={async analyzeNews(){calls++;await new Promise(r=>setTimeout(r,10));return market}};
  const a=setup(provider,{cache:createNewsAnalysisCache(()=>blobs)}),b=setup(provider,{cache:createNewsAnalysisCache(()=>blobs),wait:()=>new Promise(r=>setTimeout(r,2))});
  const result=await Promise.all([a.getOrCreateAnalysis(item,[],[]),b.getOrCreateAnalysis(item,[],[])]);
  assert.ok(result.every(r=>r.status==='ok'));assert.equal(calls,1);
});
test('parallel different articles cannot exceed shared budget',async()=>{
  const blobs=store();let calls=0;const provider={async analyzeNews(){calls++;return market}};
  const a=setup(provider,{cache:createNewsAnalysisCache(()=>blobs),dailyLimit:()=>1}),b=setup(provider,{cache:createNewsAnalysisCache(()=>blobs),dailyLimit:()=>1});
  const r=await Promise.all([a.getOrCreateAnalysis(item,[],[]),b.getOrCreateAnalysis({...item,id:'rss-second'},[],[])]);
  assert.equal(calls,1);assert.equal(r.filter(x=>x.status==='ok').length,1);
});
test('new service reads persistent market cache but computes current holdings',async()=>{
  const blobs=store();let calls=0;const provider={async analyzeNews(){calls++;return market}};
  await setup(provider,{cache:createNewsAnalysisCache(()=>blobs)}).getOrCreateAnalysis(item,[holding],[]);
  const r=await setup(provider,{cache:createNewsAnalysisCache(()=>blobs)}).getOrCreateAnalysis(item,[],[]);
  assert.equal(calls,1);assert.equal(r.portfolio?.portfolioRelevance,'none');
});
test('model and schema versions invalidate old analysis',async()=>{
  const blobs=store();let calls=0;const provider={async analyzeNews(){calls++;return market}};
  for(const [model,schemaVersion] of [['a','v1'],['b','v1'],['b','v2']]) await setup(provider,{cache:createNewsAnalysisCache(()=>blobs),model:()=>model,schemaVersion}).getOrCreateAnalysis(item,[],[]);
  assert.equal(calls,3);
});
test('success has long TTL and failures expire after fifteen minutes',async()=>{
  const blobs=store();let time=Date.parse('2026-09-14T00:00:00Z'),calls=0;
  const s=setup({async analyzeNews(){calls++;if(calls===1)throw Error('down');return market}},{cache:createNewsAnalysisCache(()=>blobs,()=>time),now:()=>time});
  await s.getOrCreateAnalysis(item,[],[]);time+=899000;await s.getOrCreateAnalysis(item,[],[]);assert.equal(calls,1);
  time+=1000;assert.equal((await s.getOrCreateAnalysis(item,[],[])).status,'ok');assert.equal(calls,2);
  time+=86400000;await s.getOrCreateAnalysis(item,[],[]);assert.equal(calls,2);
});
test('daily budget rolls over on Taipei midnight',async()=>{
  const blobs=store();let time=Date.parse('2026-09-14T15:59:59Z');const s=setup(undefined,{cache:createNewsAnalysisCache(()=>blobs,()=>time),now:()=>time,dailyLimit:()=>1});
  await s.getOrCreateAnalysis(item,[],[]);time+=1000;
  assert.equal((await s.getOrCreateAnalysis({...item,id:'rss-next-day'},[],[])).status,'ok');
});
test('mock article is never sent to provider',async()=>{
  let calls=0;const s=setup({async analyzeNews(){calls++;return market}});
  assert.equal((await s.getOrCreateAnalysis({...item,origin:'mock'},[],[])).status,'unavailable');assert.equal(calls,0);
});
test('actual provider request never contains holdings or watchlist information',async()=>{
  const provider=createNewsAnalysisProvider({apiKey:()=> 'test-only-key',fetcher:async(_,init)=>{
    assert.doesNotMatch(String(init?.body),/private-holding|123\.456|765\.432|2021-02-03|private-watchlist|avgCost|buyDate|shares/);
    return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(market)}}]}));
  }});
  assert.equal((await setup(provider).getOrCreateAnalysis(item,[holding],['private-watchlist'])).status,'ok');
});
test('daily limit environment defaults, overrides and invalid values fail closed',t=>{
  const old=process.env.NEWS_AI_DAILY_LIMIT;
  const warning=t.mock.method(console,'warn',()=>{});
  try{
    for(const [raw,expected] of [['',50],['1',1],['0',0],['invalid',0],['-1',0],['1.5',0],['9007199254740992',0]] as const){process.env.NEWS_AI_DAILY_LIMIT=raw;assert.equal(getNewsAIDailyLimit(),expected);}
    assert.equal(warning.mock.callCount(),1);
    assert.match(String(warning.mock.calls[0].arguments[0]),/Invalid NEWS_AI_DAILY_LIMIT/);
    assert.doesNotMatch(String(warning.mock.calls[0].arguments[0]),/invalid|-1|1\.5|9007199254740992/);
  }
  finally{if(old===undefined)delete process.env.NEWS_AI_DAILY_LIMIT;else process.env.NEWS_AI_DAILY_LIMIT=old;}
});

test('deep missing fields and invalid JSON become cached unavailable, preserving news input',async()=>{
  for(const content of ['not json',JSON.stringify({...market,eventSummary:undefined})]) {
    let calls=0;
    const original=structuredClone(item);
    const provider=createNewsAnalysisProvider({apiKey:()=> 'test-only',fetcher:async()=>{
      calls++;return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content}}]}));
    }});
    const service=setup(provider);
    for(let i=0;i<2;i++) {
      const r=await service.getOrCreateAnalysis(item,[holding],[]);
      assert.equal(r.status,'unavailable');assert.equal(r.market,null);assert.equal(r.portfolio,null);
    }
    assert.equal(calls,1);assert.deepEqual(item,original);
  }
});
test('v2 rejects incomplete cached success then creates one complete result',async()=>{
  const cache=createNewsAnalysisCache(()=>store());let calls=0;
  await cache.setCachedAnalysis(buildCacheKey(item.id,'v2','test-model'),{
    newsId:item.id,status:'ok',schemaVersion:'v2',modelVersion:'test-model',market:{...market,eventSummary:undefined},disclaimer:'非投資建議',analyzedAt:item.publishedAt,
  },86400);
  const service=setup({async analyzeNews(){calls++;return market}},{cache});
  for(let i=0;i<2;i++) assert.equal((await service.getOrCreateAnalysis(item,[],[])).market?.eventSummary,deepFixture.eventSummary);
  assert.equal(calls,1);
});
test('v1 cache stays intact while v2 is generated once on demand',async()=>{
  const cache=createNewsAnalysisCache(()=>store());let calls=0;
  const legacy={...market};for(const key of Object.keys(deepFixture)) delete (legacy as unknown as Record<string,unknown>)[key];
  const key=buildCacheKey(item.id,'v1','test-model');
  await cache.setCachedAnalysis(key,{newsId:item.id,status:'ok',schemaVersion:'v1',modelVersion:'test-model',market:legacy,disclaimer:'非投資建議',analyzedAt:item.publishedAt},86400);
  const service=setup({async analyzeNews(){calls++;return market}},{cache});
  assert.equal(calls,0);
  for(let i=0;i<2;i++) assert.equal((await service.getOrCreateAnalysis(item,[],[])).schemaVersion,'v2');
  assert.equal(calls,1);assert.deepEqual((await cache.getCachedAnalysis(key))?.market,legacy);
});
test('RSS title-only reaches provider and its information scope survives the analysis cache',async()=>{
  let calls=0;const s=setup({async analyzeNews(input){calls++;assert.equal(input.title,item.title);assert.equal(input.summary,'');return {...market,securityImpacts:[]}}});
  const titleOnly={...item,summary:''};
  for(let i=0;i<2;i++) {const result=await s.getOrCreateAnalysis(titleOnly,[],[]);assert.equal(result.status,'ok');assert.equal(result.inputBasis,'title-only');}
  assert.equal(calls,1);
});
test('empty news never consumes a provider call and preserves explicit failure state',async()=>{
  let calls=0;const s=setup({async analyzeNews(){calls++;return market}});
  const result=await s.getOrCreateAnalysis({...item,title:'',summary:''},[],[]);
  assert.equal(result.status,'unavailable');assert.equal(result.unavailableReason,'找不到可供分析的新聞內容');assert.equal(calls,0);
});

test('explicit retry waits for cooldown, dedupes and replaces failed cache without bypassing success or budget',async()=>{
  let time=Date.parse('2026-09-16T00:00:00Z'),calls=0;
  const s=setup({async analyzeNews(){if(++calls===1)throw new NewsAnalysisError('timeout','等待逾時');return market}},{now:()=>time,dailyLimit:()=>1});
  const failure=await s.getOrCreateAnalysis(item,[],[]);
  assert.equal(failure.errorCode,'timeout');assert.equal(failure.market,null);
  await s.getOrCreateAnalysis(item,[],[],true);assert.equal(calls,1);
  time+=30000;
  const results=await Promise.all([s.getOrCreateAnalysis(item,[holding],[],true),s.getOrCreateAnalysis(item,[],[],true)]);
  assert.equal(calls,2);assert.ok(results.every(r=>r.status==='ok'));
  assert.equal(results[0].portfolio?.affectedHoldings.length,1);assert.equal(results[1].portfolio?.affectedHoldings.length,0);
  await s.getOrCreateAnalysis(item,[],[],true);assert.equal(calls,2);
  const limited=await s.getOrCreateAnalysis({...item,id:'rss-limited'},[],[],true);
  assert.equal(limited.errorCode,'daily_limit');assert.equal(calls,2);
});

test('rate-limit retry-after survives persistent cache and cannot trigger early provider calls',async()=>{
  let time=Date.now(),calls=0;const blobs=store();
  const provider={async analyzeNews(){calls++;throw new NewsAnalysisError('rate_limit','限流',429,[],120)}};
  const options={now:()=>time,cache:createNewsAnalysisCache(()=>blobs,()=>time)};
  const a=setup(provider,options);await a.getOrCreateAnalysis(item,[],[]);
  time+=60000;
  const b=setup(provider,{...options,cache:createNewsAnalysisCache(()=>blobs,()=>time)});
  assert.equal((await b.getOrCreateAnalysis(item,[],[],true)).errorCode,'rate_limit');assert.equal(calls,1);
  time+=60000;await b.getOrCreateAnalysis(item,[],[],true);assert.equal(calls,2);
});

test('diagnostic logging retains only classification, field paths and status',async t=>{
  const logs=t.mock.method(console,'warn',()=>{});
  const s=setup({async analyzeNews(){throw new Error('private-key-private-payload')}});
  await s.getOrCreateAnalysis(item,[],[]);
  const output=JSON.stringify(logs.mock.calls.map(c=>c.arguments));
  assert.match(output,/internal/);assert.doesNotMatch(output,/private-key-private-payload/);
});
