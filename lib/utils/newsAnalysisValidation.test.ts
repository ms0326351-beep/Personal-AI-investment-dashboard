import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NewsAIAnalysisPanel, NewsAIAnalysisContent, requestAnalysis } from '../../components/dashboard/NewsAIAnalysisPanel';
import { isNewsAIResponse } from './newsAnalysisValidation';
import type { NewsAIAnalysis } from '../types/newsAnalysis';
const result:NewsAIAnalysis={newsId:'rss-test',status:'ok',schemaVersion:'v1',modelVersion:'server-managed',analyzedAt:'2026-09-14T00:00:00Z',disclaimer:'AI 推論可能有誤，非投資建議',
  market:{explicitlyMentionedSymbols:['NVDA'],inferredSymbols:['QQQ'],relatedPersonIds:['jensen-huang'],relatedTopics:['AI'],eventType:'product',impactDirection:'uncertain',impactLevel:'low',conclusion:'需求可能影響供應鏈。',reasoning:'需求→半導體→NVDA，仍需觀察。'},
  portfolio:{portfolioRelevance:'none',affectedHoldings:[],portfolioConclusion:'與你目前的持股／觀察清單無直接關聯。'},
};
test('initial panel renders closed and never fetches analysis',()=>{
  const previous=globalThis.fetch;let calls=0;
  try {
    globalThis.fetch=async()=>{calls++;throw Error('must not fetch')};
    const html=renderToStaticMarkup(createElement(NewsAIAnalysisPanel,{newsId:'rss-test'}));
    assert.match(html,/<summary>AI 影響分析/);assert.doesNotMatch(html,/<details[^>]*\bopen/);assert.equal(calls,0);
  } finally {globalThis.fetch=previous;}
});
test('successful result separates market, inference and portfolio with safe links',()=>{
  assert.equal(isNewsAIResponse(result),true);
  const html=renderToStaticMarkup(createElement(NewsAIAnalysisContent,{result}));
  for(const text of ['一般市場影響','與我的投資組合','文中提及','AI 推論可能影響','非原文點名','AI 分析，非投資建議','AI 推論可能有誤','無直接關聯']) assert.ok(html.includes(text));
  assert.match(html,/href="\/stock\/NVDA"/);assert.match(html,/href="\/people#jensen-huang"/);
  assert.match(html,/impact-uncertain/);assert.doesNotMatch(html,/class="(?:up|down)"/);
});
test('loading and unavailable states retain disclaimer without empty result sections',()=>{
  for(const props of [{result:null,loading:true},{result:null,failed:true},{result:{...result,status:'unavailable',market:null,portfolio:null,unavailableReason:'今日 AI 分析次數已達上限'} as NewsAIAnalysis}]) {
    const html=renderToStaticMarkup(createElement(NewsAIAnalysisContent,props));
    assert.match(html,/AI 分析，非投資建議/);assert.doesNotMatch(html,/一般市場影響|與我的投資組合/);
    assert.match(html,/role="status"/);
  }
});
test('malformed network responses are rejected before rendering',()=>{
  for(const value of [null,{},'error',{...result,market:null},{...result,portfolio:{affectedHoldings:null}},{...result,market:{...result.market,relatedPersonIds:null}},{...result,status:'unavailable',market:null,portfolio:null}]) assert.equal(isNewsAIResponse(value),false);
});
test('AI generated text is escaped and unknown people do not create broken tags',()=>{
  const value={...result,market:{...result.market!,conclusion:'<script>alert(1)</script>',relatedPersonIds:['unknown']}};
  const html=renderToStaticMarkup(createElement(NewsAIAnalysisContent,{result:value}));
  assert.doesNotMatch(html,/<script>|\/people#unknown/);assert.match(html,/&lt;script&gt;/);
});

test('transport failure offers retry',()=>{
  const failed=renderToStaticMarkup(createElement(NewsAIAnalysisContent,{result:null,failed:true,onRetry:()=>{}}));
  assert.match(failed,/type="button"[^>]*>重試 AI 分析/);
  assert.match(failed,/連線失敗或等待逾時/);
  assert.match(failed,/原始新聞仍可閱讀/);
});

test('successful analysis does not offer retry',()=>{
  const html=renderToStaticMarkup(createElement(NewsAIAnalysisContent,{result,onRetry:()=>{}}));
  assert.doesNotMatch(html,/重試 AI 分析/);
});

test('HTTP 200 unavailable response offers retry without a transport failure',async()=>{
  const previous=globalThis.fetch;
  try {
    for(const reason of ['AI 分析暫時無法使用，請稍後再試','今日 AI 分析次數已達上限']) {
      const unavailable:NewsAIAnalysis={...result,status:'unavailable',market:null,portfolio:null,unavailableReason:reason};
      globalThis.fetch=async()=>new Response(JSON.stringify(unavailable),{status:200});
      const received=await requestAnalysis(result.newsId);
      const html=renderToStaticMarkup(createElement(NewsAIAnalysisContent,{result:received,failed:false,onRetry:()=>{}}));
      assert.match(html,/type="button"[^>]*>重試 AI 分析/);
      assert.ok(html.includes(reason));assert.match(html,/15 分鐘內重試可能仍顯示相同結果/);
      assert.match(html,/AI 分析，非投資建議/);
    }
  } finally {globalThis.fetch=previous;}
});

test('retry requires a handler and is disabled while unavailable is loading',()=>{
  const unavailable:NewsAIAnalysis={...result,status:'unavailable',market:null,portfolio:null,unavailableReason:'暫時無法使用'};
  for(const props of [{result:null,failed:true},{result:unavailable}]) {
    assert.doesNotMatch(renderToStaticMarkup(createElement(NewsAIAnalysisContent,props)),/重試 AI 分析/);
  }
  const html=renderToStaticMarkup(createElement(NewsAIAnalysisContent,{result:unavailable,loading:true,onRetry:()=>{}}));
  assert.match(html,/<button[^>]*disabled=""[^>]*>重試 AI 分析/);
});

test('failed and timed-out requests release pending entries and concurrent retries dedupe',async()=>{
  const previous=globalThis.fetch;
  try {
    for(const failure of [new TypeError('network'),new DOMException('timeout','TimeoutError')]) {
      let calls=0;
      globalThis.fetch=async(_url,init)=>{
        calls++;assert.equal(init?.method,'POST');assert.ok(init?.signal);
        if(calls===1)throw failure;
        return new Response(JSON.stringify(result));
      };
      await assert.rejects(requestAnalysis(result.newsId));
      const values=await Promise.all([requestAnalysis(result.newsId),requestAnalysis(result.newsId)]);
      assert.equal(calls,2);assert.deepEqual(values,[result,result]);
    }
  } finally {globalThis.fetch=previous;}
});

test('HTTP and malformed response failures can be retried without bypass parameters',async()=>{
  const previous=globalThis.fetch;
  try {
    for(const response of [new Response('',{status:503}),new Response('not json'),new Response(JSON.stringify({...result,newsId:'rss-other'}))]) {
      let calls=0;
      globalThis.fetch=async(url)=>{
        assert.equal(url,'/api/news/rss-test/analysis');
        return ++calls===1?response:new Response(JSON.stringify(result));
      };
      await assert.rejects(requestAnalysis(result.newsId));
      assert.deepEqual(await requestAnalysis(result.newsId),result);assert.equal(calls,2);
    }
  } finally {globalThis.fetch=previous;}
});
