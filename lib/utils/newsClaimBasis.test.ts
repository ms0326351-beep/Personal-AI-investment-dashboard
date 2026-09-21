import test from 'node:test';
import assert from 'node:assert/strict';
import { constrainClaimBasis } from './newsClaimBasis';
import { constrainMarketImpact } from '../services/ai/newsAnalysisProvider';
import { deepFixture } from './deepNewsAnalysis.fixture';
import type { NewsItem } from '../types';
import type { ImpactChainNode, MarketImpactAnalysis } from '../types/newsAnalysis';

const node=(text:string):ImpactChainNode=>({stage:'event',label:text,explanation:text,basis:'reported'});
for(const [name,text,basis] of [
  ['A factual announcement','NVIDIA 宣布成立能源管理聯盟','reported'],
  ['B directional investment claim','晶片需求提升具利多','inferred'],
  ['C historical revenue fact','公司公布營收成長 20%','reported'],
  ['D causal stock-price inference','營收成長可能推升股價','inferred'],
] as const) test(name,()=>{
  assert.equal(constrainClaimBasis(node(text),{title:text,summary:text}).basis,basis);
});

test('judgments remain inferred even when copied from the description or attributed to a named source',()=>{
  for(const text of ['需求提升將有利於公司','因此可能上漲','股價可能下跌','訂單受惠','新政策可能帶動市場','分析師王明表示：晶片需求提升具利多','Demand growth will benefit NVIDIA'])
    assert.equal(constrainClaimBasis(node(text),{title:'新聞',summary:text}).basis,'inferred');
});

test('both label and explanation require source support; existing inference never becomes fact',()=>{
  const source={title:'公司公布營收成長 20%',summary:''};
  assert.equal(constrainClaimBasis({...node(source.title),explanation:'公司獲利成長 30%'},source).basis,'inferred');
  assert.equal(constrainClaimBasis({...node(source.title),label:'成長將推升股價'},source).basis,'inferred');
  assert.equal(constrainClaimBasis({...node(source.title),basis:'inferred'},source).basis,'inferred');
});

test('provider/cache common constraint corrects old reported labels without mutation or altering explicit symbol mentions',()=>{
  const item:NewsItem={id:'rss-basis',title:'NVIDIA 宣布成立能源管理聯盟',summary:'晶片需求提升具利多',source:'Test',publishedAt:'2026-09-17T00:00:00Z',relatedSymbols:['NVDA'],origin:'rss'};
  const market:MarketImpactAnalysis={...deepFixture,impactChain:[node(item.title),{...node(item.summary),stage:'security'}],explicitlyMentionedSymbols:['NVDA'],inferredSymbols:[],relatedPersonIds:[],relatedTopics:['AI'],eventType:'other',impactDirection:'uncertain',impactLevel:'low',conclusion:'需觀察。',reasoning:'資訊有限。'};
  const before=structuredClone(market);
  const result=constrainMarketImpact(market,item,['NVDA']);
  assert.deepEqual(result.impactChain?.map(n=>n.basis),['reported','inferred']);
  assert.deepEqual(result.explicitlyMentionedSymbols,['NVDA']);assert.deepEqual(market,before);
  assert.deepEqual(constrainMarketImpact(result,item,['NVDA']),result);
});
