import type { MarketImpactAnalysis, PortfolioImpactAnalysis, WatchFactor } from '../types/newsAnalysis';

/** Display categories only: never estimate exposure, confidence, or monetary impact. */
export function portfolioRelationshipLabel(portfolio:PortfolioImpactAnalysis|null|undefined):string {
  const impacts=portfolio?.holdingImpacts;
  if(!portfolio || !impacts) return '待確認';
  if(!impacts.length) return '未確認持股關聯';
  return impacts.some(h=>h.relationship==='direct')?'直接相關':'間接相關';
}

/** Keep provider ordering; the schema has no per-factor importance score. */
export function displayWatchFactors(factors:WatchFactor[]|undefined,limit?:number):WatchFactor[] {
  const seen=new Set<string>();
  const unique=(factors ?? []).filter(f=>{
    const key=f.name.trim().toLocaleLowerCase();
    if(!key || seen.has(key)) return false;
    seen.add(key);return true;
  });
  return limit===undefined?unique:unique.slice(0,Math.max(0,limit));
}

export function displayScenarios(market:MarketImpactAnalysis) {
  return [
    {key:'bull',label:'偏多情境',description:market.bullCase},
    {key:'base',label:'基準情境',description:market.baseCase},
    {key:'bear',label:'偏空情境',description:market.bearCase},
  ].filter((scenario):scenario is {key:string;label:string;description:string}=>!!scenario.description?.trim());
}
