import 'server-only';
import { randomUUID } from 'node:crypto';
import type { Holding, NewsItem } from '../types';
import type { CachedNewsAnalysis, NewsAIAnalysis } from '../types/newsAnalysis';
import { peopleRegistry } from '../data/peopleRegistry';
import { symbolAliases } from '../data/symbolAliases';
import { computeNewsPortfolioImpact } from '../calculations/newsRelevance';
import { createNewsAnalysisCache, newsAnalysisCache, buildCacheKey } from './ai/newsAnalysisCache';
import { newsAnalysisProvider, getNewsAIModel, constrainMarketImpact } from './ai/newsAnalysisProvider';

export const NEWS_ANALYSIS_SCHEMA_VERSION='v1';
export const NEWS_AI_DISCLAIMER='AI 分析，非投資建議；僅描述可能影響與不確定性，非事實斷言。AI 推論可能有誤。';
export const NEWS_AI_UNAVAILABLE='AI 分析暫時無法使用，請稍後再試';
const OK_TTL=14*86400;
const FAILURE_TTL=15*60;
let warnedInvalidDailyLimit=false;
export function getNewsAIDailyLimit() {
  const raw=process.env.NEWS_AI_DAILY_LIMIT?.trim();
  if (!raw) return 50;
  const value=Number(raw);
  if (/^\d+$/.test(raw) && Number.isSafeInteger(value)) return value;
  if (!warnedInvalidDailyLimit) {
    warnedInvalidDailyLimit=true;
    console.warn('[news-ai] Invalid NEWS_AI_DAILY_LIMIT; new analyses disabled. Check server configuration.');
  }
  return 0;
}
export function unavailableNewsAnalysis(newsId:string, reason=NEWS_AI_UNAVAILABLE, modelVersion='server-managed', now=Date.now()): NewsAIAnalysis {
  return {newsId,status:'unavailable',schemaVersion:NEWS_ANALYSIS_SCHEMA_VERSION,modelVersion,market:null,portfolio:null,disclaimer:NEWS_AI_DISCLAIMER,analyzedAt:new Date(now).toISOString(),unavailableReason:reason};
}
export function createNewsAnalysisService(options: {
  cache?:typeof newsAnalysisCache;
  provider?:typeof newsAnalysisProvider;
  model?:()=>string;
  dailyLimit?:()=>number;
  now?:()=>number;
  schemaVersion?:string;
  wait?:()=>Promise<void>;
} = {}) {
  const cache=options.cache ?? newsAnalysisCache;
  const provider=options.provider ?? newsAnalysisProvider;
  const now=options.now ?? Date.now;
  const schemaVersion=options.schemaVersion ?? NEWS_ANALYSIS_SCHEMA_VERSION;
  const fallback=createNewsAnalysisCache(()=>{throw new Error('Memory only')},now,()=>{});
  const inFlight=new Map<string,Promise<CachedNewsAnalysis>>();
  const safe=async<T>(operation:()=>Promise<T>, backup:()=>Promise<T>):Promise<T>=>{try{return await operation()}catch{return backup()}};
  const unavailable=(id:string,model:string,reason=NEWS_AI_UNAVAILABLE):CachedNewsAnalysis=>{
    const {portfolio:_,...result}=unavailableNewsAnalysis(id,reason,model,now());
    return {...result,schemaVersion};
  };
  async function read(key:string,item:NewsItem,model:string):Promise<CachedNewsAnalysis|null> {
    const cached=await safe(()=>cache.getCachedAnalysis(key),()=>fallback.getCachedAnalysis(key)) ?? await fallback.getCachedAnalysis(key);
    if (!cached || cached.newsId!==item.id || cached.schemaVersion!==schemaVersion || cached.modelVersion!==model) return null;
    if (cached.status==='unavailable' && cached.market===null && typeof cached.unavailableReason==='string') return cached;
    if (cached.status==='ok') {
      try { return {...cached,market:constrainMarketImpact(cached.market,item,Object.keys(symbolAliases))}; } catch {return null;}
    }
    return null;
  }
  async function save(key:string,value:CachedNewsAnalysis) {
    const ttl=value.status==='ok'?OK_TTL:FAILURE_TTL;
    // Extra memory copy also protects callers using a faulty/injected cache adapter.
    await fallback.setCachedAnalysis(key,value,ttl);
    await safe(()=>cache.setCachedAnalysis(key,value,ttl),async()=>{});
  }
  async function create(item:NewsItem,key:string,model:string):Promise<CachedNewsAnalysis> {
    const cached=await read(key,item,model); if(cached) return cached;
    const token=randomUUID();
    const acquired=await safe(()=>cache.acquireLease(key,token),()=>fallback.acquireLease(key,token));
    if(!acquired) {
      // Another function owns this news. Read its result, never issue a second GPT call.
      for(let attempt=0;attempt<20;attempt++) {
        await (options.wait ?? (()=>new Promise<void>(resolve=>setTimeout(resolve,250))))();
        const result=await read(key,item,model); if(result) return result;
      }
      return unavailable(item.id,model,'此新聞正在分析中，請稍後重新開啟頁面查看');
    }
    let reserved=false,success=false;
    const day=new Date(now()+8*3600000).toISOString().slice(0,10); // Asia/Taipei calendar day
    try {
      const again=await read(key,item,model); if(again) return again;
      const limit=(options.dailyLimit ?? getNewsAIDailyLimit)();
      reserved=await safe(()=>cache.reserveBudget(day,limit,token),()=>fallback.reserveBudget(day,limit,token));
      if(!reserved) {
        const result=unavailable(item.id,model,'今日 AI 分析次數已達上限'); await save(key,result); return result;
      }
      let result:CachedNewsAnalysis;
      try {
        const candidatePersons=peopleRegistry.filter(p=>(item.relatedPersonIds ?? []).includes(p.id)).map(({id,name,title,organization})=>({id,name,title,organization}));
        const tracked=Object.keys(symbolAliases);
        const market=constrainMarketImpact(await provider.analyzeNews(item,candidatePersons,tracked,model),item,tracked);
        success=true;
        result={newsId:item.id,status:'ok',schemaVersion,modelVersion:model,market,disclaimer:NEWS_AI_DISCLAIMER,analyzedAt:new Date(now()).toISOString()};
      } catch { result=unavailable(item.id,model); }
      await save(key,result);
      return result;
    } finally {
      if(reserved) await safe(()=>cache.finishBudget(day,token,success),()=>fallback.finishBudget(day,token,success));
      await safe(()=>cache.releaseLease(key,token),()=>fallback.releaseLease(key,token));
    }
  }
  return {
    async getOrCreateAnalysis(item:NewsItem,holdings:Holding[],watchlist:string[]):Promise<NewsAIAnalysis> {
      try {
        if(item.origin!=='rss') return unavailableNewsAnalysis(item.id,'模擬備援新聞不進行 AI 分析');
        const model=(options.model ?? getNewsAIModel)();
        const key=buildCacheKey(item.id,schemaVersion,model);
        let pending=inFlight.get(key);
        if(!pending) {
          pending=create(item,key,model).catch(()=>unavailable(item.id,model));
          inFlight.set(key,pending);
          void pending.finally(()=>inFlight.delete(key));
        }
        const result=await pending;
        // Never reuse a cached/pending caller's portfolio. Recompute for each request.
        return {...result,portfolio:result.status==='ok' && result.market ? computeNewsPortfolioImpact(result.market,holdings,watchlist) : null};
      } catch { return unavailableNewsAnalysis(item.id); }
    },
  };
}
export const newsAnalysisService=createNewsAnalysisService();
