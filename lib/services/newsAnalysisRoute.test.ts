import test from 'node:test';
import assert from 'node:assert/strict';
import { POST } from '../../app/api/news/[id]/analysis/route';
import { newsItemSnapshots } from './news/newsItemSnapshots';
import { newsAnalysisService, unavailableNewsAnalysis } from './newsAnalysisService';
import type { NewsItem } from '../types';

test('analysis route resolves displayed RSS ID from server snapshot, never trusts client news text',async t=>{
  const news:NewsItem={id:'rss-route',title:'Server RSS headline',summary:'Verified RSS summary',source:'CNBC',publishedAt:'2026-09-16T00:00:00Z',relatedSymbols:[],origin:'rss'};
  t.mock.method(newsItemSnapshots,'find',async(id:string)=>{assert.equal(id,news.id);return news});
  let calls=0;
  t.mock.method(newsAnalysisService,'getOrCreateAnalysis',async(item:NewsItem)=>{calls++;assert.deepEqual(item,news);return unavailableNewsAnalysis(item.id,'Test result')});
  const response=await POST(new Request('http://localhost/api/news/rss-route/analysis',{method:'POST',body:JSON.stringify({title:'Forged article',fullText:'Invented body'})}),{params:Promise.resolve({id:news.id})});
  const result=await response.json();assert.equal(result.newsId,news.id);assert.equal(result.unavailableReason,'Test result');assert.equal(calls,1);
});
test('invalid route ID fails without fetching or calling analysis provider',async t=>{
  t.mock.method(newsItemSnapshots,'find',async()=>{throw Error('must not lookup')});
  t.mock.method(newsAnalysisService,'getOrCreateAnalysis',async()=>{throw Error('must not analyze')});
  const response=await POST(new Request('http://localhost',{method:'POST'}),{params:Promise.resolve({id:'invalid'})});
  assert.equal((await response.json()).unavailableReason,'找不到可供分析的新聞內容');
});
