import type { Holding } from '@/lib/types';
import type { PersonSummary } from '@/lib/types/people';
export function isRelevantToUser(symbols: string[], holdings: Holding[], watchlist: string[]): boolean {
  return symbols.some(s => holdings.some(h=>h.symbol===s) || watchlist.includes(s));
}
export function symbolRelation(symbol: string, holdings: Holding[], watchlist: string[]): string {
  if (holdings.some(h=>h.symbol===symbol)) return '你持有';
  return watchlist.includes(symbol) ? '你關注' : '';
}
export function rankPeople(items: PersonSummary[], holdings: Holding[], watchlist: string[], latest=false) {
  const levels={high:3,medium:2,low:1};
  return [...items].sort((a,b)=>{
    const time=(Date.parse(b.latestEvent?.occurredAt ?? '') || 0)-(Date.parse(a.latestEvent?.occurredAt ?? '') || 0);
    if(latest) return time;
    return Number(isRelevantToUser(b.person.relatedSymbols,holdings,watchlist))-Number(isRelevantToUser(a.person.relatedSymbols,holdings,watchlist)) || levels[b.person.currentImpactLevel]-levels[a.person.currentImpactLevel] || time;
  });
}
