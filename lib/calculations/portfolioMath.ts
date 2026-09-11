import type { Holding, Security, Currency } from '@/lib/types';
export function calculatePortfolio(holdings: Holding[], securities: Security[], fx: Record<Currency,number>) {
  const rows=holdings.map(h=>{const s=securities.find(s=>s.symbol===h.symbol); if(!s) throw new Error(`Missing quote: ${h.symbol}`); const cost=h.shares*h.avgCost, value=h.shares*s.price, profit=value-cost; return {...h,security:s,cost,value,profit,returnRate:cost ? profit/cost*100:0,twdValue:value*fx[s.currency],twdCost:cost*fx[s.currency],dayChange:h.shares*s.change*fx[s.currency]}});
  const value=rows.reduce((a,r)=>a+r.twdValue,0),cost=rows.reduce((a,r)=>a+r.twdCost,0),dayChange=rows.reduce((a,r)=>a+r.dayChange,0);
  const currencies=(['TWD','USD'] as const).map(currency=>({currency,value:rows.filter(r=>r.security.currency===currency).reduce((a,r)=>a+r.value,0)}));
  return {rows:rows.map(r=>({...r,weightPercent:value?r.twdValue/value*100:0})),value,cost,profit:value-cost,returnRate:cost?(value-cost)/cost*100:0,dayChange,dayRate:value-dayChange?dayChange/(value-dayChange)*100:0,currencies};
}
