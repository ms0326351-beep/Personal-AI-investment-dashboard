import 'server-only';
import { cache } from 'react';
import { connection } from 'next/server';
import type { MarketIndex, Security } from '@/lib/types';
import type { PriceHistory } from '@/lib/types/marketSource';
import { indices, securities, fx } from '@/lib/mock/data';
import { createYahooProvider } from './yahooMarketProvider';
import { withMarketFallback } from './marketFallback';

export interface MarketDataService {
  getIndices(): Promise<MarketIndex[]>;
  getSecurities(): Promise<Security[]>;
  getSecurity(symbol: string): Promise<Security | undefined>;
  getFx(): Promise<typeof fx>;
  getHistory(symbol: string): Promise<PriceHistory>;
}
import { normalizeSymbol } from '@/lib/utils/marketSymbols';
const providerSymbols: Record<string,string> = {'0050':'0050.TW','2330':'2330.TW','2317':'2317.TW',TAIEX:'^TWII',SP500:'^GSPC',NASDAQ:'^IXIC',DOW:'^DJI'};
const provider = createYahooProvider();
const quote = cache((symbol:string)=>provider.getQuote(providerSymbols[symbol] ?? symbol));
const history = cache((symbol:string)=>provider.getHistory(providerSymbols[symbol] ?? symbol));
const fallbackReason='行情來源暫時無法使用，顯示模擬備援';
function mockHistory(symbol:string): PriceHistory {
  const s=securities.find(s=>s.symbol===symbol);
  return {source:'mock',updatedAt:s?.updatedAt ?? '',points:s?Array.from({length:30},(_,i)=>({label:i<20?`08/${12+i}`:`09/${String(i-19).padStart(2,'0')}`,price:Number((s.price*(0.92+i*0.08/29+Math.sin(i*1.6)*0.009*(29-i)/29)).toFixed(2))})):[]};
}
export const mockMarketDataService: MarketDataService = {
  async getIndices(){return indices.map(i=>({...i,source:'mock'}))},
  async getSecurities(){return securities.map(s=>({...s,source:'mock'}))},
  async getSecurity(symbol){const s=securities.find(s=>s.symbol===normalizeSymbol(symbol));return s?{...s,source:'mock'}:undefined},
  async getFx(){return fx},
  async getHistory(symbol){return mockHistory(normalizeSymbol(symbol))},
};
export const marketDataService: MarketDataService = {
  async getIndices(){
    await connection();
    return Promise.all(indices.map(async i=>{
      if(i.code==='TPEX') return {...i,source:'mock' as const,fallbackReason:'櫃買指數尚未串接'};
      return withMarketFallback(async()=>{const q=await quote(i.code);return {...i,...q,value:q.price}},i,fallbackReason);
    }));
  },
  async getSecurities(){return (await Promise.all(securities.map(s=>this.getSecurity(s.symbol)))).filter((s):s is Security=>Boolean(s))},
  async getSecurity(symbol){
    await connection();
    const base=securities.find(s=>s.symbol===normalizeSymbol(symbol));
    if(!base) return undefined;
    return withMarketFallback(async()=>({...base,...await quote(base.symbol)}),base,fallbackReason);
  },
  async getFx(){return fx},
  async getHistory(symbol){
    await connection();
    const canonical=normalizeSymbol(symbol);
    if(!securities.some(s=>s.symbol===canonical)) return mockHistory(canonical);
    return withMarketFallback(()=>history(canonical),mockHistory(canonical),'走勢來源暫時無法使用，顯示模擬備援');
  },
};
