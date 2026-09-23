import 'server-only';
import type { Holding, NewsItem, Security, Currency } from '../types';
import type { ExposureDataset } from '../types/exposure';
import type { EtfDataset } from '../types/etfExposure';
import type { NewsExposureCatalog } from '../types/newsExposure';
import { createExposureRepository } from './exposureRepository';
import { createNewsExposureService } from './newsExposureService';
import { calculatePortfolioExposure } from '../calculations/portfolioExposure';
import { adaptLegacyPortfolio } from '../utils/portfolioExposureAdapter';
import { presentPortfolioIntelligence, type PositionLabel } from '../utils/portfolioIntelligencePresentation';
import type { LegacyExposureMapping } from '../types/portfolioExposure';

export interface IntelligenceData { foundation: ExposureDataset; catalog: NewsExposureCatalog; etf: EtfDataset }
/** Metadata identifies assets only. Never manufacture issuer, sector or ETF relationships. */
export function availableIntelligenceData(securities:Security[]):IntelligenceData {
  const assets=securities.filter(s=>s.type!=='index');
  return {
    foundation:{version:'asset-registry-v1',entities:assets.map(s=>({id:`asset:${s.market}:${s.symbol}`,kind:'Asset',name:s.name})),relationships:[],sources:[],evidence:[]},
    catalog:{version:'asset-mentions-v1',bindings:assets.map(s=>({entityId:`asset:${s.market}:${s.symbol}`,symbol:s.symbol,aliases:[s.symbol,s.name]})),rules:[]},
    etf:{version:'no-reviewed-snapshots',snapshots:[]},
  };
}
/** Local deterministic adapter. Private positions never enter an OpenAI request or shared cache. */
export async function buildPortfolioIntelligence(input:{holdings:Holding[];securities:Security[];fx:Record<Currency,number>;asOf:string;news?:NewsItem;data?:IntelligenceData}) {
  const data=input.data ?? availableIntelligenceData(input.securities);
  const mappings:LegacyExposureMapping={},labels:Record<string,PositionLabel>={};
  const values=input.holdings.map(h=>{const s=input.securities.find(s=>s.symbol===h.symbol);return s && Number.isFinite(s.price) && s.price>=0 && Number.isFinite(input.fx[s.currency]) && input.fx[s.currency]>0?h.shares*s.price*input.fx[s.currency]:null;});
  const total=values.every(v=>v!==null)?values.reduce<number>((sum,v)=>sum+v!,0):null;
  input.holdings.forEach((h,i)=>{
    const s=input.securities.find(s=>s.symbol===h.symbol);
    mappings[h.id]={assetEntityId:s?`asset:${s.market}:${s.symbol}`:`unmapped:${h.id}`,assetType:s?.type==='etf'?'etf':s?.type==='stock'?'stock':'other',marketValue:values[i],valuationQuality:values[i]===null?'unknown':'estimated'};
    labels[h.id]={name:s?.name ?? h.symbol,symbol:h.symbol,estimatedWeight:total!==null && total>0?values[i]!/total:null};
  });
  // Mock positions/FX must not become exact financial exposure in the engine.
  const snapshot=adaptLegacyPortfolio(input.holdings,{portfolioId:'current-demo',version:input.asOf,baseCurrency:'TWD',asOf:input.asOf},mappings);
  const summary=calculatePortfolioExposure(snapshot,data.foundation,{etf:{dataset:data.etf}});
  const news=input.news?await createNewsExposureService(createExposureRepository(data.foundation),data.catalog).analyze(input.news,snapshot,{newsObservedAt:input.asOf,etf:{dataset:data.etf}}):undefined;
  return presentPortfolioIntelligence(summary,data.foundation,labels,news,input.news?.title);
}
