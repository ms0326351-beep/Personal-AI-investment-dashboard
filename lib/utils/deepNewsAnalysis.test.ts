import test from 'node:test';
import assert from 'node:assert/strict';
import { deepFixture, directFixture, indirectFixture } from './deepNewsAnalysis.fixture';
import { isDeepMarketImpact, containsTradingInstruction } from './deepNewsAnalysis';
import { isMarketImpact } from './newsAnalysisValidation';
import { constrainMarketImpact, createNewsAnalysisProvider } from '../services/ai/newsAnalysisProvider';
import { computeNewsPortfolioImpact } from '../calculations/newsRelevance';
import type { MarketImpactAnalysis } from '../types/newsAnalysis';
import type { NewsItem, Holding } from '../types';

const item:NewsItem={id:'rss-deep',title:'NVIDIA discusses AI',summary:'Demand is uncertain.',source:'Test',origin:'rss',publishedAt:'2026-09-16',relatedSymbols:['NVDA']};
const legacy:MarketImpactAnalysis={explicitlyMentionedSymbols:['NVDA'],inferredSymbols:['2330'],relatedPersonIds:[],relatedTopics:['AI'],eventType:'product',impactDirection:'uncertain',impactLevel:'medium',conclusion:'需求仍需觀察。',reasoning:'需求可能透過製造環節傳導。'};
const market=():MarketImpactAnalysis=>({...legacy,...structuredClone(deepFixture),securityImpacts:[structuredClone(directFixture),structuredClone(indirectFixture)]});
const holding=(symbol:string):Holding=>({id:symbol,symbol,shares:10,avgCost:100,buyDate:'2026-01-01'});
const constrained=(value=market())=>constrainMarketImpact(value,item,['NVDA','2330','AAPL']);

test('deep direct holding has local name and position data',()=>{
  const r=computeNewsPortfolioImpact(constrained(),[holding('NVDA')],[]);
  assert.equal(r.portfolioRelevance,'direct');assert.equal(r.holdingImpacts?.[0].name,'NVIDIA');assert.deepEqual(r.affectedHoldings,[holding('NVDA')]);
});
test('deep inferred holding is indirect, never mislabeled direct',()=>{
  const r=computeNewsPortfolioImpact(constrained(),[holding('2330')],[]);
  assert.equal(r.portfolioRelevance,'indirect');assert.equal(r.holdingImpacts?.[0].relationship,'indirect');assert.equal(r.holdingImpacts?.[0].anchorSymbol,'NVDA');
});
test('unrelated holdings and unsupported same-topic links are excluded',()=>{
  const m=market();m.securityImpacts!.push({...indirectFixture,symbol:'AAPL'});m.inferredSymbols.push('AAPL');
  const r=computeNewsPortfolioImpact(constrained(m),[holding('AAPL')],[]);
  assert.equal(r.portfolioRelevance,'none');assert.deepEqual(r.affectedHoldings,[]);
});
test('weak confidence, invented quote and false direct claim are excluded',()=>{
  for(const change of [{confidence:'low' as const},{evidenceQuote:'Not in news'},{relationship:'direct' as const}]) {
    const m=market();m.securityImpacts=[{...indirectFixture,...change}];assert.deepEqual(constrained(m).securityImpacts,[]);
  }
});
test('macro requires a policy event and specific evidence, not AI or technology words',()=>{
  const m=market();m.securityImpacts=[{...indirectFixture,linkage:'macro',anchorSymbol:''}];
  assert.deepEqual(constrained(m).securityImpacts,[]);
  const policy={...item,title:'Fed rate cut announced'};m.eventType='monetary-policy';m.securityImpacts[0].evidenceQuote=policy.title;
  assert.equal(constrainMarketImpact(m,policy,['2330']).securityImpacts?.length,1);
});
test('no unverified ETF constituent inference is accepted',()=>{
  const m=market();m.inferredSymbols=['0050'];m.securityImpacts=[{...indirectFixture,symbol:'0050',linkage:'index-exposure'}];
  assert.deepEqual(constrainMarketImpact(m,item,['0050']).securityImpacts,[]);
});
test('a company name plus AI alone is insufficient for a supply-chain holding link',()=>{
  const r=constrainMarketImpact(market(),{...item,summary:''},['2330','NVDA']);
  assert.deepEqual(r.securityImpacts?.map(s=>s.symbol),['NVDA']);assert.deepEqual(r.inferredSymbols,[]);
});
test('local rate news without a supported monetary policy actor is not a global holding link',()=>{
  const m=market();m.eventType='monetary-policy';m.securityImpacts=[{...indirectFixture,linkage:'macro',anchorSymbol:'',evidenceQuote:'Local bank rate cut'}];
  assert.deepEqual(constrainMarketImpact(m,{...item,title:'Local bank rate cut',summary:''},['2330']).securityImpacts,[]);
});
test('impact chain rejects empty, invalid stage, wrong order and invalid basis',()=>{
  for(const chain of [[],[{...deepFixture.impactChain[0],stage:'unknown'}],[...deepFixture.impactChain].reverse(),[{...deepFixture.impactChain[0],basis:'certain'}]])
    assert.equal(isDeepMarketImpact({...deepFixture,impactChain:chain}),false);
});
test('old cached market remains valid, partially populated deep data does not',()=>{
  assert.equal(isMarketImpact(legacy),true);assert.equal(isMarketImpact({...legacy,eventSummary:'partial'}),false);
  assert.equal(isMarketImpact(market()),true);
});
test('watch factors reject unknown type, empty reason, excess entries and invented fields',()=>{
  for(const factors of [[{name:'x',type:'unknown',reason:'why'}],[{name:'x',type:'rate',reason:''}],Array(8).fill(deepFixture.watchFactors[0]),[{...deepFixture.watchFactors[0],value:100}]])
    assert.equal(isDeepMarketImpact({...deepFixture,watchFactors:factors}),false);
});
test('scenario and uncertainty fields must be complete and bounded',()=>{
  for(const change of [{baseCase:''},{bullCase:null},{bearCase:'a'.repeat(301)},{whatWouldChangeTheView:undefined},{uncertainties:[]}])
    assert.equal(isDeepMarketImpact({...deepFixture,...change}),false);
});
test('trading instructions are rejected across all new narrative fields',()=>{
  for(const text of ['建議買進台積電','賣出股票','加碼 NVDA','減碼','Buy NVDA','sell shares','目標價100','一定會上漲']) {
    assert.equal(containsTradingInstruction(text),true);assert.equal(isDeepMarketImpact({...deepFixture,bullCase:text}),false);
  }
});
test('provider rejects missing deep fields, invalid JSON and trade instructions',async()=>{
  for(const content of [JSON.stringify(legacy),'not json',JSON.stringify({...market(),baseCase:'建議買進'})]) {
    const provider=createNewsAnalysisProvider({apiKey:()=> 'test-only',fetcher:async()=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content}}]}))});
    await assert.rejects(provider.analyzeNews(item,[],['NVDA','2330']),{message:'News analysis provider failed'});
  }
});
