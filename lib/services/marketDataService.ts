import type { MarketIndex, Security, PricePoint } from '@/lib/types';
import { indices, securities, fx } from '@/lib/mock/data';
export interface MarketDataService { getIndices(): Promise<MarketIndex[]>; getSecurities(): Promise<Security[]>; getSecurity(symbol: string): Promise<Security | undefined>; getFx(): Promise<typeof fx>; getHistory(symbol: string): Promise<PricePoint[]> }
export const mockMarketDataService: MarketDataService = {
  async getIndices(){return indices}, async getSecurities(){return securities}, async getSecurity(symbol){return securities.find(s=>s.symbol===symbol.toUpperCase())}, async getFx(){return fx},
  async getHistory(symbol){const s=securities.find(s=>s.symbol===symbol.toUpperCase()); return s ? Array.from({length:30},(_,i)=>({label:`08/${12+i <=31 ? 12+i : 12+i-31}`,price:Number((s.price*(0.92+i*0.08/29+Math.sin(i*1.6)*0.009*(29-i)/29)).toFixed(2))})).map((p,i)=>({...p,label: i<20 ? `08/${12+i}` : `09/${String(i-19).padStart(2,'0')}`})) : []},
};
export const marketDataService: MarketDataService = mockMarketDataService;
