import test from 'node:test';
import assert from 'node:assert/strict';
import { displayScenarios, displayWatchFactors, portfolioRelationshipLabel } from './newsAnalysisPresentation';
import { deepFixture, directFixture, indirectFixture } from './deepNewsAnalysis.fixture';
import type { MarketImpactAnalysis, PortfolioImpactAnalysis } from '../types/newsAnalysis';
const market:MarketImpactAnalysis={...deepFixture,explicitlyMentionedSymbols:[],inferredSymbols:[],relatedPersonIds:[],relatedTopics:[],eventType:'other',impactDirection:'uncertain',impactLevel:'low',conclusion:'資訊不足。',reasoning:'需觀察。'};
const portfolio:PortfolioImpactAnalysis={portfolioRelevance:'none',affectedHoldings:[],portfolioConclusion:''};

test('presentation never translates directness into invented numerical or high/low relevance scores',()=>{
  assert.equal(portfolioRelationshipLabel(null),'待確認');
  assert.equal(portfolioRelationshipLabel(portfolio),'待確認');
  assert.equal(portfolioRelationshipLabel({...portfolio,holdingImpacts:[]}), '未確認持股關聯');
  assert.equal(portfolioRelationshipLabel({...portfolio,holdingImpacts:[{...directFixture,name:'NVIDIA'}]}),'直接相關');
  assert.equal(portfolioRelationshipLabel({...portfolio,holdingImpacts:[{...indirectFixture,name:'台積電'}]}),'間接相關');
});
test('watch shortlist preserves source order and reasons without thresholds, mutation or padding',()=>{
  const factors=Array.from({length:7},(_,i)=>({...deepFixture.watchFactors[0],name:`指標${i}`,reason:`理由${i}`}));
  const original=structuredClone(factors);
  assert.deepEqual(displayWatchFactors(factors,3),factors.slice(0,3));
  assert.deepEqual(displayWatchFactors(factors),original);assert.deepEqual(factors,original);
  assert.deepEqual(displayWatchFactors(undefined,3),[]);
  assert.equal(displayWatchFactors([factors[0],{...factors[0],name:' 指標0 '},factors[1]],3).length,2);
});
test('partial scenarios preserve original text and never convert base case into neutral sentiment',()=>{
  const partial={...market,bullCase:undefined,bearCase:''};
  assert.deepEqual(displayScenarios(partial),[{key:'base',label:'基準情境',description:market.baseCase}]);
  assert.equal(displayScenarios({...partial,baseCase:undefined}).length,0);
  assert.deepEqual(displayScenarios(market).map(s=>s.description),[market.bullCase,market.baseCase,market.bearCase]);
});
