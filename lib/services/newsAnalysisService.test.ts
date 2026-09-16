import test from 'node:test';
import assert from 'node:assert/strict';
import { createNewsAnalysisService, getNewsAIDailyLimit } from './newsAnalysisService';
import { createNewsAnalysisCache, type AnalysisBlobStore } from './ai/newsAnalysisCache';
import { createNewsAnalysisProvider } from './ai/newsAnalysisProvider';
import type { NewsItem, Holding } from '../types';
import type { MarketImpactAnalysis } from '../types/newsAnalysis';
const item:NewsItem={id:'rss-first',title:'NVIDIA AI',summary:'Jensen Huang discusses demand.',source:'Test',publishedAt:'2026-09-14T00:00:00Z',relatedSymbols:['NVDA'],relatedPersonIds:['jensen-huang'],origin:'rss'};
const market:MarketImpactAnalysis={explicitlyMentionedSymbols:['NVDA'],inferredSymbols:['QQQ'],relatedPersonIds:['jensen-huang'],relatedTopics:['AI'],eventType:'product',impactDirection:'uncertain',impactLevel:'low',conclusion:'可能影響供應鏈。',reasoning:'需求→半導體→NVDA，仍需觀察。'};
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
