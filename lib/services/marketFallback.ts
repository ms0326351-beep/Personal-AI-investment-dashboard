import type { MarketSource } from '@/lib/types/marketSource';
export async function withMarketFallback<T>(load:()=>Promise<T>, fallback:T, reason:string):Promise<T & MarketSource> {
  try { return {...await load(),source:'yahoo'}; }
  catch { return {...fallback,source:'mock',fallbackReason:reason}; }
}
