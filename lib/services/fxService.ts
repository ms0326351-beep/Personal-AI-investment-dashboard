import 'server-only';
import type { FxSnapshot } from '../types/fx';
import { createYahooProvider, type MarketProvider } from './yahooMarketProvider';
import { fx } from '../mock/data';

export const sampleFx:FxSnapshot={...fx,source:'mock',updatedAt:null,stale:true,fallbackReason:'匯率來源暫時無法使用，使用示範匯率，非即時匯率'};
export function createFxService(provider:Pick<MarketProvider,'getQuote'>=createYahooProvider(),now=Date.now) {
  return {async getFx():Promise<FxSnapshot> {
    try {
      // Yahoo TWD=X quotes TWD per USD; TWD remains the portfolio base currency.
      const quote=await provider.getQuote('TWD=X'),stamp=Date.parse(quote.updatedAt),age=now()-stamp;
      if(!Number.isFinite(quote.price)||quote.price<=0||!Number.isFinite(stamp)||age< -300000||age>7*86400000) throw Error('Invalid FX observation');
      return {TWD:1,USD:quote.price,source:'yahoo',updatedAt:quote.updatedAt,stale:age>36*3600000};
    } catch {return {...sampleFx};}
  }};
}
export const fxService=createFxService();
