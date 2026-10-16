import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import NewsDetail from '../../app/news/[id]/page';
import { newsItemSnapshots } from '../services/news/newsItemSnapshots';
import { FxStatus } from '../../components/ui/FxStatus';
import { NewsList } from '../../components/ui/common';
import type { NewsItem } from '../types';
const news:NewsItem={id:'rss-detail',title:'<script>alert(1)</script>',summary:'<img src=x onerror=alert(1)>',source:'Fixture',url:'https://example.com/article',origin:'rss',publishedAt:'2026-10-06T00:00:00Z',relatedSymbols:[]};
test('news detail escapes source text, states summary scope and demo positions, AI remains closed',async t=>{
  t.mock.method(newsItemSnapshots,'find',async()=>news);
  const html=renderToStaticMarkup(await NewsDetail({params:Promise.resolve({id:news.id})}));
  assert.match(html,/未取得完整原文/);assert.match(html,/Demo \/ Sample/);assert.match(html,/noopener noreferrer/);
  assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>|<img src=x|<details[^>]*open/);
});
test('news list exposes detail deep link while keeping external headline and sample labels',()=>{
  const html=renderToStaticMarkup(createElement(NewsList,{items:[news,{...news,id:'sample',origin:'mock'}]}));
  assert.match(html,/href="\/news\/rss-detail"/);assert.doesNotMatch(html,/href="\/news\/sample"/);assert.match(html,/模擬資料/);
});
test('FX status renders live date, delayed/stale and explicit sample fallback',()=>{
  const live=renderToStaticMarkup(createElement(FxStatus,{data:{TWD:1,USD:31.25,source:'yahoo',updatedAt:news.publishedAt,stale:false}}));
  assert.match(live,/Yahoo Finance/);assert.match(live,/<time/);assert.doesNotMatch(live,/示範匯率/);
  const fallback=renderToStaticMarkup(createElement(FxStatus,{data:{TWD:1,USD:32,source:'mock',updatedAt:null,stale:true}}));
  assert.match(fallback,/Demo \/ Sample 示範匯率/);assert.match(fallback,/非即時/);
});
