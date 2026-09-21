import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NewsAIAnalysisContent, NewsAIAnalysisPanel } from '../../components/dashboard/NewsAIAnalysisPanel';
import { deepFixture, indirectFixture } from './deepNewsAnalysis.fixture';
import { isNewsAIResponse } from './newsAnalysisValidation';
import type { NewsAIAnalysis } from '../types/newsAnalysis';

const result:NewsAIAnalysis={newsId:'rss-deep-ui',status:'ok',schemaVersion:'v2',modelVersion:'test-model',analyzedAt:'2026-09-16T00:00:00Z',disclaimer:'AI 分析，非投資建議',
  market:{...deepFixture,securityImpacts:[indirectFixture],explicitlyMentionedSymbols:['NVDA'],inferredSymbols:['2330'],relatedPersonIds:[],relatedTopics:['AI'],eventType:'product',impactDirection:'uncertain',impactLevel:'medium',conclusion:'需觀察需求。',reasoning:'需求可能傳導至製造環節。'},
  portfolio:{portfolioRelevance:'indirect',affectedHoldings:[{id:'demo',symbol:'2330',shares:1,avgCost:10,buyDate:'2026-01-01'}],portfolioConclusion:'具體供應鏈推論。',holdingImpacts:[{...indirectFixture,name:'台積電'}]},
};
test('deep UI shows event, holding-specific evidence, scenarios and uncertainty in closed disclosures',()=>{
  assert.equal(isNewsAIResponse(result),true);
  const html=renderToStaticMarkup(createElement(NewsAIAnalysisContent,{result}));
  for(const label of ['AI 投資影響摘要','我的投資組合影響','接下來觀察','查看完整深度分析','事件摘要','產品','重要程度','短期','影響傳導路徑','我的持股','2330 台積電','間接關聯（推論）','信心：','新聞引文','基準情境','偏多情境','偏空情境','改變判斷的關鍵','仍不確定','非投資建議']) assert.ok(html.includes(label),label);
  assert.match(html,/<ol class="news-ai-chain">/);assert.match(html,/新聞描述/);assert.match(html,/AI 推論/);
  assert.match(html,/href="\/stock\/2330"/);assert.doesNotMatch(html,/<details[^>]*\bopen/);
  assert.equal((html.match(/<article class="news-ai-holding"/g)??[]).length,1);
});
test('empty relevant holding list never manufactures a holding card or final chain match',()=>{
  const r={...result,portfolio:{portfolioRelevance:'none' as const,affectedHoldings:[],holdingImpacts:[],portfolioConclusion:'沒有足夠依據。'}};
  const html=renderToStaticMarkup(createElement(NewsAIAnalysisContent,{result:r}));
  assert.match(html,/未找到足夠關聯依據/);assert.doesNotMatch(html,/<article class="news-ai-holding"/);
});
test('legacy cached response renders without Phase 3A fields and without fetching',()=>{
  const r=structuredClone(result);r.schemaVersion='v1';
  for(const key of Object.keys(deepFixture)) delete (r.market as unknown as Record<string,unknown>)[key];
  delete r.portfolio!.holdingImpacts;
  const original=globalThis.fetch;let calls=0;
  try {
    globalThis.fetch=async()=>{calls++;throw Error('No API in render')};
    assert.equal(isNewsAIResponse(r),true);
    const html=renderToStaticMarkup(createElement(NewsAIAnalysisContent,{result:r}));
    renderToStaticMarkup(createElement(NewsAIAnalysisPanel,{newsId:r.newsId}));
    assert.match(html,/一般市場影響/);assert.match(html,/我的投資組合影響/);assert.match(html,/此份分析未提供情境資料/);assert.match(html,/目前沒有足夠資料確認直接影響/);assert.equal(calls,0);
  } finally {globalThis.fetch=original;}
});

test('first layer shows summary, holdings and at most three factors; full analysis is closed',()=>{
  const r=structuredClone(result);
  r.market!.watchFactors=Array.from({length:7},(_,i)=>({name:`指標${i+1}`,type:'market',reason:`觀察理由${i+1}`}));
  const html=renderToStaticMarkup(createElement(NewsAIAnalysisContent,{result:r}));
  const firstLayer=html.split('<details')[0];
  assert.ok(firstLayer.indexOf('AI 投資影響摘要')<firstLayer.indexOf('我的投資組合影響'));
  assert.ok(firstLayer.indexOf('我的投資組合影響')<firstLayer.indexOf('接下來觀察'));
  for(const text of ['需觀察需求。','2330 台積電','指標1','指標2','指標3']) assert.ok(firstLayer.includes(text));
  for(const text of ['指標4','偏多情境','新聞引文','分析限制與不確定性']) assert.ok(!firstLayer.includes(text));
  assert.equal((html.match(/<details/g)??[]).length,1);assert.doesNotMatch(html,/<details[^>]*\bopen/);
  assert.match(html,/指標7/);
});
test('missing portfolio and empty relevance render market summary without inventing an impact',()=>{
  for(const portfolio of [null,{portfolioRelevance:'' as never,affectedHoldings:[],holdingImpacts:[],portfolioConclusion:''}]) {
    const html=renderToStaticMarkup(createElement(NewsAIAnalysisContent,{result:{...result,portfolio}}));
    assert.match(html,/AI 投資影響摘要/);assert.match(html,/目前沒有足夠資料確認直接影響/);
    assert.doesNotMatch(html,/<article class="news-ai-holding"/);
  }
});
test('many holdings stay compact and all supplied reasons and paths remain in full analysis',()=>{
  const r=structuredClone(result);
  r.portfolio!.holdingImpacts=Array.from({length:4},(_,i)=>({...indirectFixture,symbol:`TEST${i}`,name:`測試持股${i}`}));
  const html=renderToStaticMarkup(createElement(NewsAIAnalysisContent,{result:r}));
  const firstLayer=html.split('<details')[0];
  assert.equal((firstLayer.match(/<article class="news-ai-holding"/g)??[]).length,2);
  assert.match(firstLayer,/另有 2 檔/);assert.doesNotMatch(firstLayer,/TEST3/);assert.match(html,/TEST3/);
});
test('ETF display uses supplied transmission only and does not fabricate weights or scenario targets',()=>{
  const r=structuredClone(result);
  r.portfolio!.holdingImpacts=[{...indirectFixture,symbol:'0050',name:'元大台灣50',reason:'可能經由大盤風險偏好傳導，仍需觀察。',transmissionPath:['政策訊號','大盤風險偏好','0050']}];
  const html=renderToStaticMarkup(createElement(NewsAIAnalysisContent,{result:r}));
  assert.match(html,/大盤風險偏好/);assert.match(html,/逐情境標的/);assert.doesNotMatch(html,/\d+%|目標價|中性情境/);
});
test('deep content is escaped and malformed holding fields are rejected',()=>{
  const r=structuredClone(result);r.market!.eventSummary='<script>alert(1)</script>';
  const html=renderToStaticMarkup(createElement(NewsAIAnalysisContent,{result:r}));
  assert.doesNotMatch(html,/<script>/);assert.match(html,/&lt;script&gt;/);
  for(const change of [{relationship:'maybe'},{confidence:'absolute'},{timeHorizon:'forever'},{watchFactors:null},{transmissionPath:[]},{name:''}]) {
    const broken={...result,portfolio:{...result.portfolio,holdingImpacts:[{...result.portfolio!.holdingImpacts![0],...change}]}};
    assert.equal(isNewsAIResponse(broken),false);
  }
});
test('UI accurately labels summary-only and title-only analysis, and rejects unknown scope',()=>{
  for(const [inputBasis,label] of [['rss-summary','依新聞標題與摘要分析，未取得完整原文'],['title-only','RSS 未提供摘要']] as const) {
    const html=renderToStaticMarkup(createElement(NewsAIAnalysisContent,{result:{...result,inputBasis}}));assert.ok(html.includes(label));
  }
  assert.equal(isNewsAIResponse({...result,inputBasis:'invented-full-article'}),false);
});
