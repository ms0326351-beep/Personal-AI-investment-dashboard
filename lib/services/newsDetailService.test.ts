import test from 'node:test';
import assert from 'node:assert/strict';
import { getNewsDetail, newsSourceUrl } from './newsDetailService';
import type { NewsItem } from '../types';
test('news detail uses trusted resolver and rejects malformed IDs before resolution',async()=>{
  const news:NewsItem={id:'rss-detail',title:'Title',summary:'RSS summary',source:'Fixture',publishedAt:'2026-10-06',relatedSymbols:[],origin:'rss'};
  assert.deepEqual(await getNewsDetail(news.id,async id=>{assert.equal(id,news.id);return news}),news);
  assert.equal(await getNewsDetail('../url',async()=>{throw Error('must not call')}),null);
  assert.equal(await getNewsDetail(news.id,async()=>{throw Error('offline')}),null);
  assert.equal(await getNewsDetail(news.id,async()=>null),null);
});
test('external news links reject executable schemes and embedded credentials',()=>{
  for(const url of ['javascript:alert(1)','data:text/html,x','//host.invalid','https://user:pass@host.invalid']) assert.equal(newsSourceUrl(url),undefined);
  assert.equal(newsSourceUrl('https://example.com/news'),'https://example.com/news');
});
