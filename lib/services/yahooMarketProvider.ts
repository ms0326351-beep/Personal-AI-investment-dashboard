import type { PricePoint } from '@/lib/types';
export interface ProviderQuote { price: number; change: number; changePercent: number; updatedAt: string }
export interface MarketProvider { getQuote(symbol: string): Promise<ProviderQuote>; getHistory(symbol: string): Promise<{points:PricePoint[];updatedAt:string}> }
type ChartResult = {
  meta: { regularMarketPrice?: number; regularMarketTime?: number; chartPreviousClose?: number; previousClose?: number; exchangeTimezoneName?: string };
  timestamp?: number[];
  indicators?: { quote?: { close?: (number|null)[] }[] };
};
const positive = (v: unknown): v is number => typeof v==='number' && Number.isFinite(v) && v>0;
export function parseQuote(data: ChartResult): ProviderQuote {
  const m=data.meta, previous=m.chartPreviousClose ?? m.previousClose;
  if(!positive(m.regularMarketPrice)||!positive(previous)||!positive(m.regularMarketTime)) throw new Error('Invalid quote');
  const change=m.regularMarketPrice-previous;
  return {price:m.regularMarketPrice,change,changePercent:change/previous*100,updatedAt:new Date(m.regularMarketTime*1000).toISOString()};
}
export function parseHistory(data: ChartResult) {
  const closes=data.indicators?.quote?.[0]?.close;
  const points: PricePoint[]=[];
  let updatedAt='';
  data.timestamp?.forEach((stamp,i)=>{
    const price=closes?.[i];
    if(!positive(price)||!positive(stamp)) return;
    const date=new Date(stamp*1000);
    points.push({label:new Intl.DateTimeFormat('zh-TW',{timeZone:data.meta.exchangeTimezoneName ?? 'UTC',month:'2-digit',day:'2-digit'}).format(date),price});
    updatedAt=date.toISOString();
  });
  if(points.length<2) throw new Error('Empty history');
  return {points,updatedAt};
}
export function createYahooProvider(fetcher: typeof fetch = fetch): MarketProvider {
  async function chart(symbol: string, range: '1d'|'1mo'): Promise<ChartResult> {
    const url=`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=${range}`;
    const response=await fetcher(url,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(7000),next:{revalidate:300}});
    if(!response.ok) throw new Error(`Market HTTP ${response.status}`);
    const body=await response.json(), result=body?.chart?.result?.[0];
    if(body?.chart?.error || !result?.meta) throw new Error('Invalid chart');
    return result;
  }
  return {async getQuote(symbol){return parseQuote(await chart(symbol,'1d'))},async getHistory(symbol){return parseHistory(await chart(symbol,'1mo'))}};
}
