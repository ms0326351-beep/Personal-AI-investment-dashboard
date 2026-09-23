import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { PortfolioIntelligence } from '../../components/dashboard/PortfolioIntelligence';
import { NewsAIAnalysisContent } from '../../components/dashboard/NewsAIAnalysisPanel';
import { NewsExposurePanel, requestNewsExposure } from '../../components/dashboard/NewsExposurePanel';
import { presentPortfolioIntelligence, exposurePercent, isPortfolioIntelligenceView } from './portfolioIntelligencePresentation';
import { calculateNewsPortfolioIntelligence } from '../calculations/newsExposure';
import { calculatePortfolioExposure } from '../calculations/portfolioExposure';
import { buildPortfolioIntelligence } from '../services/portfolioIntelligenceService';
import type { ExposureDataset, ExposureRelationship } from '../types/exposure';
import type { ExposurePortfolioSnapshot } from '../types/portfolioExposure';
import type { EtfDataset, EtfProvenance } from '../types/etfExposure';
import type { NewsExposureCatalog, NewsExposureEvent } from '../types/newsExposure';
import type { Security } from '../types';

const at='2026-09-22',before='2026-09-21';
function fixture() {
  const edge=(id:string,source:string,target:string,type:ExposureRelationship['type']):ExposureRelationship=>({id,sourceEntityId:source,targetEntityId:target,type,nature:'DIRECT',strength:'high',confidence:'high',claim:'REPORTED',rationale:'Synthetic test only',evidenceIds:['e'],sourceIds:['s'],counterEvidenceIds:[],invalidationConditions:['Orders cancelled'],updatedAt:before});
  const foundation:ExposureDataset={version:'test',entities:[{id:'a',kind:'Asset',name:'股票 A'},{id:'b',kind:'Asset',name:'股票 B'},{id:'fund',kind:'Asset',name:'ETF A'},{id:'companyA',kind:'Company',name:'Acme'},{id:'companyB',kind:'Company',name:'Supplier'},{id:'tech',kind:'Technology',name:'Technology'}],relationships:[edge('issuerA','a','companyA','ISSUED_BY'),edge('issuerB','b','companyB','ISSUED_BY'),edge('supply','companyB','companyA','SUPPLIES'),edge('tech','companyB','tech','DEPENDS_ON')],sources:[{id:'s',title:'Fixture source',url:'https://example.com/source',retrievedAt:before,publishedAt:before}],evidence:[{id:'e',sourceId:'s',excerpt:'Evidence only for testing',observedAt:before}]};
  const portfolio:ExposurePortfolioSnapshot={portfolioId:'test',version:'1',asOf:at,baseCurrency:'TWD',positions:[{id:'direct',assetEntityId:'b',assetType:'stock',marketValue:50,valuationQuality:'known'},{id:'etf',assetEntityId:'fund',assetType:'etf',marketValue:50,valuationQuality:'known'}]};
  const p:EtfProvenance={sourceIds:['s'],evidenceIds:['e'],sourceDate:before,lastVerifiedAt:before,confidence:'high',evidenceType:'reported',dataQuality:'verified'};
  const etf:EtfDataset={version:'1',snapshots:[{...p,id:'snap',etfAssetId:'fund',asOfDate:before,completeness:'complete',holdings:[{...p,id:'b',underlyingAssetId:'b',ticker:'B',name:'Supplier',assetType:'stock',weight:1,weightUnit:'fraction',weightBasis:'netAssets'}]}]};
  const catalog:NewsExposureCatalog={version:'test',bindings:[{entityId:'companyA',aliases:['Acme']}],rules:[{relationshipId:'supply',traversal:'reverse',relationshipType:'customer_to_supplier',sensitivity:'same',rationale:'Conditional test only',evidenceIds:['e'],sourceIds:['s'],confidence:'high',asOf:before,invalidationConditions:['Orders cancelled']}]};
  const event:NewsExposureEvent={news:{id:'rss-ui',title:'Acme announces orders',summary:'Acme order update',source:'Fixture',url:'https://example.com/news',publishedAt:before,relatedSymbols:[],origin:'rss'},observedAt:before,anchors:[{entityId:'companyA',mention:'Acme',direction:'positive',confidence:'high'}]};
  return {foundation,portfolio,etf,catalog,event};
}
function result(f=fixture()) {
  const summary=calculatePortfolioExposure(f.portfolio,f.foundation,{etf:{dataset:f.etf}});
  const news=calculateNewsPortfolioIntelligence(f.event,f.portfolio,f.foundation,f.catalog,{etf:{dataset:f.etf}});
  return presentPortfolioIntelligence(summary,f.foundation,{direct:{name:'Supplier',symbol:'B',estimatedWeight:.5},etf:{name:'ETF A',symbol:'ETF',estimatedWeight:.5}},news,f.event.news.title);
}
const html=(view=result(),mode:'news'|'portfolio'='news')=>renderToStaticMarkup(createElement(PortfolioIntelligence,{view,mode}));
test('UI direct exposure distinguishes literal mention from inferred market impact',()=>{
  const f=fixture();f.catalog.bindings=[{entityId:'companyB',aliases:['Supplier']}];f.event.news.title='Supplier announces revenue';f.event.anchors=[{entityId:'companyB',mention:'Supplier',direction:'uncertain',confidence:'high'}];
  const out=html(result(f));assert.match(out,/直接關聯/);assert.match(out,/來源記載／持有關係；不代表影響已證實/);assert.match(out,/不確定/);
});
test('UI indirect exposure retains second order and weakest confidence',()=>{
  const out=html();assert.match(out,/間接關聯/);assert.match(out,/二階路徑/);assert.match(out,/可信度：中/);assert.match(out,/影響程度/);assert.match(out,/不以曝險權重推定/);
});
test('UI multi-hop keeps each economic and ownership hop with dates',()=>{
  const view=result(),path=view.holdings[1].paths[0];
  assert.deepEqual(path.steps.map(s=>s.relationship),['新聞點名','客戶 → 供應商','發行公司對應','ETF 成分持有','本機持股']);
  assert.ok(path.steps.every(s=>s.date));assert.match(html(view),/多跳關聯/);
  assert.equal(path.steps.at(-1)!.to,'我的持股 · ETF A');
});
test('UI third-order scenario retains inferred label and confidence decay',()=>{
  const f=fixture();f.catalog.rules.push({...f.catalog.rules[0],relationshipId:'tech',traversal:'forward',relationshipType:'technology_dependency',scenario:{condition:'Only if deployment continues',demandKind:'compute'}});
  const view=result(f),third=view.higherOrder.find(p=>p.order==='三階以上')!;
  assert.equal(third.confidence,'低');assert.equal(third.steps.length,3);assert.match(third.steps[2].basis,/推論／情境/);
  assert.match(html(view),/Only if deployment continues/);
});
test('UI ETF look-through and overlap do not add news paths as financial weights',()=>{
  const view=result();assert.match(html(view),/ETF 穿透/);
  assert.equal(view.holdings[0].metrics.find(m=>m.label==='合計已知關聯曝險')!.value,'50.00%');
  const out=html(view,'portfolio');assert.match(out,/直接 50.00% ＋ ETF 間接 50.00% ＝ 合計 100.00%/);assert.match(out,/直接 ＋ ETF 間接合計 100.00%/);
});
test('UI unknown values never become zero percent',()=>{
  const f=fixture();f.portfolio.positions.forEach(p=>{p.marketValue=null;p.valuationQuality='unknown';});
  const view=result(f);assert.equal(view.holdings[0].metrics.find(m=>m.label==='合計已知關聯曝險')!.value,'未知');
  assert.equal(exposurePercent(null),'未知');assert.equal(exposurePercent(0),'0.00%');
});
test('UI partial coverage preserves the unknown residual',()=>{
  const f=fixture();f.etf.snapshots[0].holdings[0].weight=.8;f.etf.snapshots[0].completeness='partial';
  const view=result(f);assert.equal(view.status,'PARTIAL');const out=html(view,'portfolio');assert.match(out,/部分資料 · PARTIAL/);assert.match(out,/該部位已知成分 80.00%／未知 20.00%/);
});
test('UI no path never claims no economic exposure',()=>{
  const f=fixture();f.event.anchors=[];const view=result(f);assert.equal(view.status,'UNKNOWN');assert.match(html(view),/不能解讀為沒有影響/);
  view.holdings=[];assert.match(html(view),/不代表曝險為零/);
});
test('UI evidence links are safe, escaped, dated and preserve invalidation',()=>{
  const view=result();const step=view.holdings[0].paths[0].steps[1];step.evidence.push('<script>alert(1)</script>');step.sources.push({title:'Unsafe',url:'javascript:alert(1)',date:at});
  const out=html(view);assert.match(out,/href="https:\/\/example.com\/source" target="_blank" rel="noopener noreferrer"/);assert.match(out,/&lt;script&gt;/);assert.doesNotMatch(out,/href="javascript:/);assert.match(out,/Orders cancelled/);assert.match(out,/發布：2026-09-21/);
});
test('UI mixed/unknown evidence never silently removes uncertainty',()=>{
  const f=fixture();f.foundation.relationships.find(e=>e.id==='supply')!.evidenceIds=[];const view=result(f);assert.equal(view.status,'UNKNOWN');assert.match(html(view),/證據不足/);assert.match(html(view),/可信度：未知/);
});
test('UI themes explicitly remain overlapping, not additive allocation',()=>{assert.match(html(result(),'portfolio'),/主題可重疊，不可相加視為 100%/);});
test('UI progressive disclosure and mobile styles avoid fixed-width paths',()=>{
  const out=html();assert.match(out,/<details><summary>為什麼會影響我？/);assert.match(out,/<ol>/);
  const css=readFileSync('app/globals.css','utf8');assert.match(css,/\.exposure-panel\{[^}]*overflow-wrap:anywhere/);assert.match(css,/@media\(max-width:420px\)\{\.exposure-panel/);assert.match(css,/grid-template-columns:minmax\(0,1fr\)/);
});
test('UI legacy/failure content remains usable without exposure response',()=>{
  const out=renderToStaticMarkup(createElement(NewsAIAnalysisContent,{result:null,failed:true,onRetry:()=>{},intelligence:createElement(PortfolioIntelligence,{view:result()})}));assert.match(out,/重試 AI 分析/);assert.match(out,/投資組合影響 · 曝險路徑/);
  assert.doesNotThrow(()=>renderToStaticMarkup(createElement(NewsAIAnalysisContent,{result:null})));
});
test('UI exposure starts closed without invoking network',()=>{
  const out=renderToStaticMarkup(createElement(NewsExposurePanel,{newsId:'rss-ui',active:false}));assert.doesNotMatch(out,/正在比對|為什麼/);
});
test('transport validation rejects malformed nested payload and accepts engine DTO',()=>{
  const view=result();assert.equal(isPortfolioIntelligenceView(view),true);assert.equal(isPortfolioIntelligenceView({...view,holdings:[{}]}),false);view.higherOrder[0].steps[0].sources=null as never;assert.equal(isPortfolioIntelligenceView(view),false);
});
test('server integration never fabricates ETF holdings, relations or exact weights from demo FX',async()=>{
  const security={symbol:'A',market:'US',name:'Acme',type:'stock',currency:'USD',price:100} as Security;
  const view=await buildPortfolioIntelligence({holdings:[{id:'p',symbol:'A',shares:1,avgCost:80,buyDate:before}],securities:[security],fx:{TWD:1,USD:32},asOf:at,news:fixture().event.news});
  assert.equal(view.holdings[0].metrics.find(m=>m.label==='持股權重（估算）')!.value,'100.00%');
  assert.equal(view.holdings[0].metrics.find(m=>m.label==='合計已知關聯曝險')!.value,'未知');assert.equal(view.higherOrder.length,0);assert.match(view.notes.join(''),/尚未提供經審核/);
});
test('server integration missing quotes and empty portfolio remain unknown',async()=>{
  const view=await buildPortfolioIntelligence({holdings:[],securities:[],fx:{TWD:1,USD:32},asOf:at});assert.equal(view.status,'UNKNOWN');assert.equal(view.holdings.length,0);
});
test('exposure retry releases failed request and concurrent panels dedupe without GPT',async()=>{
  const original=globalThis.fetch;let calls=0;const view=result();
  try {
    globalThis.fetch=async(url,init)=>{calls++;assert.match(String(url),/\/exposure$/);assert.equal(init?.cache,'no-store');return Response.json({message:'temporary'},{status:503});};
    await assert.rejects(requestNewsExposure('rss-ui'));
    globalThis.fetch=async()=>{calls++;return Response.json(view);};
    const [a,b]=await Promise.all([requestNewsExposure('rss-ui'),requestNewsExposure('rss-ui')]);assert.deepEqual(a,b);assert.equal(calls,2);
  } finally {globalThis.fetch=original;}
});
