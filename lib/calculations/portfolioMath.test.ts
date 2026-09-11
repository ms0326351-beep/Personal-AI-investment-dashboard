import test from 'node:test';
import assert from 'node:assert/strict';
import { calculatePortfolio } from './portfolioMath';
import type { Security } from '../types';
const security=(symbol:string,currency:'TWD'|'USD',price:number,change:number):Security=>({symbol,name:symbol,market:currency==='TWD'?'TW':'US',currency,type:'stock',price,change,changePercent:0,sector:'test',dividendYield:0,updatedAt:''});
test('mixed currencies are converted before aggregation and weights sum to 100',()=>{const r=calculatePortfolio([{id:'1',symbol:'TW',shares:10,avgCost:8,buyDate:''},{id:'2',symbol:'US',shares:2,avgCost:4,buyDate:''}],[security('TW','TWD',10,1),security('US','USD',5,-1)],{TWD:1,USD:32});assert.equal(r.value,420);assert.equal(r.cost,336);assert.equal(r.profit,84);assert.equal(r.returnRate,25);assert.equal(r.dayChange,-54);assert.equal(r.rows.reduce((a,r)=>a+r.weightPercent,0),100);assert.deepEqual(r.currencies,[{currency:'TWD',value:100},{currency:'USD',value:10}]);});
test('empty holdings have finite zero metrics',()=>{const r=calculatePortfolio([],[],{TWD:1,USD:32});assert.equal(r.value,0);assert.equal(r.returnRate,0);assert.equal(r.dayRate,0)});
test('missing quotes fail explicitly instead of silently understating value',()=>{assert.throws(()=>calculatePortfolio([{id:'1',symbol:'missing',shares:1,avgCost:1,buyDate:''}],[],{TWD:1,USD:32}),/Missing quote/)});
