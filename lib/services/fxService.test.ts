import test from 'node:test';
import assert from 'node:assert/strict';
import { createFxService } from './fxService';
import { calculatePortfolio } from '../calculations/portfolioMath';
import { holdings, securities } from '../mock/data';
const time=Date.parse('2026-10-06T00:00:00Z');
const quote={price:31.25,change:0,changePercent:0,updatedAt:new Date(time).toISOString()};
test('real FX preserves USD/TWD units, source and timestamp and remains compatible with portfolio math',async()=>{
  const fx=await createFxService({async getQuote(symbol){assert.equal(symbol,'TWD=X');return quote}},()=>time).getFx();
  assert.equal(fx.TWD,1);assert.equal(fx.USD,31.25);assert.equal(fx.source,'yahoo');assert.equal(fx.stale,false);assert.equal(fx.updatedAt,quote.updatedAt);
  assert.ok(Number.isFinite(calculatePortfolio(holdings,securities,fx).value));
});
test('delayed FX marked stale, not presented as instant; expired, future, invalid and failed FX visibly fall back',async()=>{
  assert.equal((await createFxService({async getQuote(){return quote}},()=>time+2*86400000).getFx()).stale,true);
  for(const value of [NaN,0,-1]) assert.equal((await createFxService({async getQuote(){return {...quote,price:value}}},()=>time).getFx()).source,'mock');
  for(const now of [time-600000,time+8*86400000]) assert.equal((await createFxService({async getQuote(){return quote}},()=>now).getFx()).source,'mock');
  const fx=await createFxService({async getQuote(){throw Error('offline')}},()=>time).getFx();
  assert.equal(fx.source,'mock');assert.equal(fx.updatedAt,null);assert.match(fx.fallbackReason!,/示範匯率/);
});
