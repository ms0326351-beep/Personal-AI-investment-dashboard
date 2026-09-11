import test from 'node:test';
import assert from 'node:assert/strict';
import { createYahooProvider, parseQuote, parseHistory } from './yahooMarketProvider';
import { withMarketFallback } from './marketFallback';
import { normalizeSymbol } from '../utils/marketSymbols';
test('normalizes Taiwan aliases and URL encoded index symbols',()=>{
  assert.equal(normalizeSymbol('2330.TW'),'2330');
  assert.equal(normalizeSymbol('0050.TW'),'0050');
  assert.equal(normalizeSymbol('%5ETWII'),'^TWII');
  assert.equal(normalizeSymbol('aapl'),'AAPL');
  assert.equal(normalizeSymbol('%invalid'),'');
});
const meta={regularMarketPrice:105,chartPreviousClose:100,regularMarketTime:1789104600};
test('quote uses previous trading close and provider timestamp',()=>{
  const q=parseQuote({meta}); assert.equal(q.change,5); assert.equal(q.changePercent,5); assert.equal(q.updatedAt,new Date(meta.regularMarketTime*1000).toISOString());
  assert.equal(parseQuote({meta:{...meta,regularMarketPrice:95}}).changePercent,-5);
});
test('invalid quote values fail instead of rendering NaN',()=>{
  for(const price of [0,NaN,Infinity]) assert.throws(()=>parseQuote({meta:{...meta,regularMarketPrice:price}}));
  assert.throws(()=>parseQuote({meta:{...meta,chartPreviousClose:0}}));
});
test('history removes null points without shifting date alignment',()=>{
  const h=parseHistory({meta:{exchangeTimezoneName:'Asia/Taipei'},timestamp:[1788840000,1788926400,1789012800],indicators:{quote:[{close:[100,null,105]}]}});
  assert.deepEqual(h.points.map(p=>p.price),[100,105]); assert.equal(h.updatedAt,new Date(1789012800*1000).toISOString());
  assert.throws(()=>parseHistory({meta:{},timestamp:[],indicators:{}}));
});
test('quote requests one-day baseline; history requests month separately',async()=>{
  const urls:string[]=[];
  const fetcher:typeof fetch=async input=>{urls.push(String(input));return Response.json({chart:{result:[{meta,timestamp:[1788926400,1789012800],indicators:{quote:[{close:[100,105]}]}}]}})};
  const provider=createYahooProvider(fetcher); await provider.getQuote('2330.TW'); await provider.getHistory('2330.TW');
  assert.ok(urls[0].endsWith('range=1d')); assert.ok(urls[1].endsWith('range=1mo'));
});
test('HTTP errors, malformed responses and timeout retain dated mock fallback',async()=>{
  const fetchers:typeof fetch[]=[async()=>new Response('',{status:429}),async()=>Response.json({chart:{result:null}}),async()=>{throw new DOMException('Timeout','TimeoutError')}];
  for(const fetcher of fetchers){
    const result=await withMarketFallback(()=>createYahooProvider(fetcher).getQuote('AAPL'),{price:50,change:1,changePercent:2,updatedAt:'2026-09-10T00:00:00Z'},'備援');
    assert.equal(result.source,'mock');assert.equal(result.price,50);assert.equal(result.updatedAt,'2026-09-10T00:00:00Z');assert.equal(result.fallbackReason,'備援');
  }
});
test('a failed symbol does not discard successful sibling quotes',async()=>{
  const result=await Promise.all([withMarketFallback(async()=>({price:105}),{price:50},'備援'),withMarketFallback(async()=>{throw new Error('down')},{price:60},'備援')]);
  assert.equal(result[0].source,'yahoo');assert.equal(result[0].price,105);assert.equal(result[1].source,'mock');
});
