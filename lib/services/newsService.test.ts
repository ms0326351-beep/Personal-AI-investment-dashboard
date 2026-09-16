import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchRealNews } from './news/realNewsProvider';
import { selectNewsPool } from './news/selectNewsPool';
import { news } from '../mock/data';
import type { NewsItem } from '../types';
const mockPool:NewsItem[]=news.map(n=>({...n,origin:'mock',fallbackReason:'即時新聞來源暫時無法使用，顯示模擬備援'}));
test('real items are returned unchanged with no mock mixed in',()=>{
  const real:NewsItem[]=[{...news[0],id:'test-real',origin:'rss'}];
  assert.strictEqual(selectNewsPool(real,mockPool),real);
  assert.ok(selectNewsPool(real,mockPool).every(n=>n.origin==='rss'));
});
test('empty results return the marked mock pool and retain original timestamps',()=>{
  const result=selectNewsPool([],mockPool);
  assert.strictEqual(result,mockPool);assert.ok(result.length>0);
  result.forEach((n,i)=>{assert.equal(n.origin,'mock');assert.ok(n.fallbackReason);assert.equal(n.publishedAt,news[i].publishedAt)});
});
test('no symbol matches in a nonempty real pool must not trigger mock fallback',()=>{
  const real:NewsItem[]=[{...news[0],origin:'rss',relatedSymbols:['NVDA']}];
  assert.deepEqual(selectNewsPool(real,mockPool).filter(n=>n.relatedSymbols.includes('0050')),[]);
});
test('successfully fetched but stale feeds fall back to the whole mock pool',async()=>{
  const fetcher:typeof fetch=async()=>new Response('<rss><channel><item><title>Old news</title><link>https://example.com/old</link><pubDate>2026-09-01T00:00:00Z</pubDate></item></channel></rss>');
  const {items,diagnostics}=await fetchRealNews(fetcher,new Date('2026-09-14T04:00:00Z'));
  assert.ok(diagnostics.every(d=>d.ok));
  assert.deepEqual(items,[]);
  assert.strictEqual(selectNewsPool(items,mockPool),mockPool);
});
