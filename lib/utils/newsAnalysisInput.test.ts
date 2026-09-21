import test from 'node:test';
import assert from 'node:assert/strict';
import { selectNewsAnalysisInput, newsInputNotice } from './newsAnalysisInput';
import type { NewsItem } from '../types';
const news:NewsItem={id:'rss-input',title:'NVIDIA reports demand',summary:'RSS summary',source:'Test',publishedAt:'2026-09-16T00:00:00Z',relatedSymbols:['NVDA'],origin:'rss'};
test('input priority is verified article text, RSS content, snippet, summary, then title metadata',()=>{
  const value={...news,articleText:'Actual article',rssContent:'RSS body',contentSnippet:'Snippet'};
  assert.equal(selectNewsAnalysisInput(value)?.item.summary,'Actual article');
  assert.equal(selectNewsAnalysisInput({...value,articleText:' '})?.item.summary,'RSS body');
  assert.equal(selectNewsAnalysisInput({...value,articleText:'',rssContent:''})?.item.summary,'Snippet');
  assert.equal(selectNewsAnalysisInput(news)?.basis,'rss-summary');
  assert.equal(selectNewsAnalysisInput({...news,summary:''})?.basis,'title-only');
  assert.equal(value.summary,'RSS summary');
});
test('empty content is rejected but absent full text is not a failure',()=>{
  assert.ok(selectNewsAnalysisInput(news));assert.ok(selectNewsAnalysisInput({...news,summary:''}));
  assert.equal(selectNewsAnalysisInput({...news,title:' ',summary:''}),null);
  assert.equal(selectNewsAnalysisInput({...news,summary:'',publishedAt:'invalid'}),null);
});
test('excerpt boundaries and input notices never label RSS or title as a full article',()=>{
  assert.equal(selectNewsAnalysisInput({...news,rssContent:'字'.repeat(500)})?.item.summary.length,400);
  assert.equal(newsInputNotice('rss-summary'),'依新聞標題與摘要分析，未取得完整原文');
  assert.match(newsInputNotice('title-only'),/RSS 未提供摘要/);assert.match(newsInputNotice('rss-content'),/未確認為完整原文/);
  assert.match(newsInputNotice('article-excerpt'),/節錄/);
});
