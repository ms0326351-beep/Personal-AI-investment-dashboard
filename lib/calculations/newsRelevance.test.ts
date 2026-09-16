import test from 'node:test';
import assert from 'node:assert/strict';
import { computeNewsPortfolioImpact } from './newsRelevance';
import { symbolRelation } from '../utils/relevance';
import type { Holding } from '../types';
const holding: Holding = {id:'private-holding',symbol:'0050',shares:42,avgCost:80,buyDate:'2026-01-01'};
const market = {explicitlyMentionedSymbols:['0050'],inferredSymbols:['QQQ'],impactDirection:'uncertain',impactLevel:'low'} as const;
const input = () => ({...market, explicitlyMentionedSymbols:[...market.explicitlyMentionedSymbols],inferredSymbols:[...market.inferredSymbols]});
test('explicit holding match returns direct with matching holdings only', () => {
  const r=computeNewsPortfolioImpact(input(),[holding,{...holding,id:'other',symbol:'MSFT'}],['QQQ']);
  assert.equal(r.portfolioRelevance,'direct'); assert.deepEqual(r.affectedHoldings,[holding]);
  assert.match(r.portfolioConclusion,/0050.*直接相關.*不確定/);
});
test('inferred holding match also returns direct', () => {
  assert.equal(computeNewsPortfolioImpact(input(),[{...holding,symbol:'QQQ'}],[]).portfolioRelevance,'direct');
});
test('watchlist-only match is indirect with no affected holdings', () => {
  const r=computeNewsPortfolioImpact(input(),[],['QQQ']);
  assert.equal(r.portfolioRelevance,'indirect'); assert.deepEqual(r.affectedHoldings,[]);
  assert.match(r.portfolioConclusion,/QQQ.*觀察清單間接相關.*未命中持股/);
});
test('no matches and empty inputs explicitly report no relevance', () => {
  for (const r of [computeNewsPortfolioImpact(input(),[],[]),computeNewsPortfolioImpact({...input(),explicitlyMentionedSymbols:[],inferredSymbols:[]},[holding],['QQQ'])]) {
    assert.equal(r.portfolioRelevance,'none'); assert.deepEqual(r.affectedHoldings,[]); assert.match(r.portfolioConclusion,/無直接關聯/);
  }
});
test('union is duplicate-free in conclusion and inputs stay unchanged', () => {
  const m={...input(),inferredSymbols:['0050']}; const original=structuredClone(m);
  const r=computeNewsPortfolioImpact(m,[holding],[]);
  assert.equal(r.portfolioConclusion.match(/0050/g)?.length,1); assert.deepEqual(m,original);
});

test('holding takes precedence over watchlist for the same explicit and inferred symbols', () => {
  const m={...input(),inferredSymbols:['0050','QQQ']};
  const symbols=[...new Set([...m.explicitlyMentionedSymbols,...m.inferredSymbols])];
  const holdings=[holding],watchlist=['0050','QQQ'];
  const r=computeNewsPortfolioImpact(m,holdings,watchlist);
  assert.deepEqual(symbols.filter(s=>symbolRelation(s,holdings,watchlist)==='你持有'),r.affectedHoldings.map(h=>h.symbol));
  assert.deepEqual(symbols.filter(s=>symbolRelation(s,holdings,watchlist)==='你關注'),['QQQ']);
  assert.equal(r.portfolioRelevance,'direct');
  assert.match(r.portfolioConclusion,/你持有 0050.*直接相關/);
  assert.doesNotMatch(r.portfolioConclusion,/QQQ|間接相關/);
});

test('special symbols use consistent exact matching in holdings and watched conclusions', () => {
  const m={...input(),explicitlyMentionedSymbols:['^TWII'],inferredSymbols:['QQQ','^TWII']};
  const indexHolding={...holding,symbol:'^TWII'};
  const direct=computeNewsPortfolioImpact(m,[indexHolding],['^TWII','QQQ']);
  assert.equal(symbolRelation('^TWII',[indexHolding],['^TWII']),'你持有');
  assert.deepEqual(direct.affectedHoldings,[indexHolding]);
  const indirect=computeNewsPortfolioImpact(m,[holding],['^TWII','QQQ']);
  assert.equal(indirect.portfolioRelevance,'indirect');
  assert.deepEqual(indirect.affectedHoldings,[]);
  assert.match(indirect.portfolioConclusion,/你關注的 \^TWII、QQQ/);
  assert.equal(indirect.portfolioConclusion.match(/\^TWII/g)?.length,1);
});
