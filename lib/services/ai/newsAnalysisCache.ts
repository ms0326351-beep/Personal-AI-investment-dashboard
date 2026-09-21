import 'server-only';
import { getStore } from '@netlify/blobs';
import type { CachedNewsAnalysis } from '../../types/newsAnalysis';

type Conditions = {onlyIfNew: true} | {onlyIfMatch: string};
export interface AnalysisBlobStore {
  getWithMetadata(key: string, options: {type:'json'; consistency:'strong'}): Promise<{data: unknown; etag?: string} | null>;
  setJSON(key: string, value: unknown, options?: Conditions): Promise<{modified: boolean}>;
}
type Envelope = {value: unknown; expiresAt: number};
type Budget = {used: number; pending: string[]};
const isEnvelope = (v: unknown): v is Envelope => !!v && typeof v === 'object' && 'expiresAt' in v && typeof v.expiresAt === 'number' && 'value' in v;
export const buildCacheKey = (newsId: string, schemaVersion: string, modelVersion: string) => `${newsId}:${schemaVersion}:${modelVersion}`;

export function createNewsAnalysisCache(
  storeFactory: () => AnalysisBlobStore = () => getStore({name:'news-ai-analysis',consistency:'strong', fetch: (url, init) => fetch(url,{...init,signal:AbortSignal.timeout(3000)})}),
  now: () => number = Date.now,
  // During a Blobs outage the daily limit is per-instance, NOT per-app.
  // Keep the agreed memory fallback; refusing new analyses requires a policy change.
  log: () => void = () => console.warn('[news-ai] Persistent cache unavailable; using process memory. Daily limit is per-instance, not per-app.'),
) {
  const memory = new Map<string, Envelope>();
  const degradedBudgets = new Set<string>();
  let logged = false;
  const warn = () => { if (!logged) { logged=true; log(); } };
  const live = (e: Envelope | undefined) => e && e.expiresAt > now() ? e : undefined;
  const remember = (key: string, e: Envelope) => {
    for (const [k,v] of memory) if (v.expiresAt <= now()) { memory.delete(k); degradedBudgets.delete(k); }
    memory.set(key,e);
  };
  async function read(key: string): Promise<unknown | null> {
    try {
      const entry = await storeFactory().getWithMetadata(key,{type:'json',consistency:'strong'});
      if (entry && isEnvelope(entry.data) && live(entry.data)) {
        remember(key,entry.data); return structuredClone(entry.data.value);
      }
    } catch { warn(); }
    const cached=live(memory.get(key));
    return cached ? structuredClone(cached.value) : null;
  }
  async function write(key: string, value: unknown, ttlSeconds: number) {
    const e={value:structuredClone(value),expiresAt:now()+ttlSeconds*1000};
    remember(key,e);
    try { await storeFactory().setJSON(key,e); } catch { warn(); }
  }
  // Strong reads + conditional writes make budgets/leases safe across function instances.
  // A transport outage explicitly degrades to one-process coordination only.
  async function mutate<T>(key: string, ttl: number, initial: T, update: (value: T) => T | null): Promise<boolean> {
    try {
      const store=storeFactory();
      for (let attempt=0;attempt<10;attempt++) {
        const old=await store.getWithMetadata(key,{type:'json',consistency:'strong'});
        if (old && !old.etag) return false;
        let current=old && isEnvelope(old.data) && live(old.data) ? old.data.value as T : structuredClone(initial);
        const shadow=live(memory.get(key));
        if(degradedBudgets.has(key) && shadow) {
          // Recovery must not reset locally reserved/spent capacity. A conservative
          // merge can overcount after outages, but cannot grant extra local calls.
          const remote=current as Budget, local=shadow.value as Budget;
          current={used:Math.max(remote.used,local.used),pending:[...new Set([...remote.pending,...local.pending])]} as T;
        }
        // Preserve the last confirmed shared state if the following write fails.
        if(old && isEnvelope(old.data) && live(old.data)) remember(key,{...old.data,value:current});
        const value=update(current);
        if (value===null) return false;
        const e={value,expiresAt:now()+ttl*1000};
        const result=await store.setJSON(key,e,old ? {onlyIfMatch:old.etag!} : {onlyIfNew:true});
        if (result.modified) { remember(key,e); return true; }
      }
      return false; // Contention is not a storage outage: never bypass the shared limit.
    } catch { warn(); if(key.startsWith('budget:')) degradedBudgets.add(key); }
    const previous=live(memory.get(key));
    const value=update(previous ? structuredClone(previous.value) as T : structuredClone(initial));
    if (value===null) return false;
    remember(key,{value,expiresAt:now()+ttl*1000});
    return true;
  }
  return {
    async getCachedAnalysis(key: string): Promise<CachedNewsAnalysis | null> {
      return await read(key) as CachedNewsAnalysis | null;
    },
    async setCachedAnalysis(key: string, value: CachedNewsAnalysis, ttl: number) {
      // Pick fields explicitly so even a full response cannot leak portfolio into Blobs.
      const {newsId,status,schemaVersion,modelVersion,market,disclaimer,analyzedAt,unavailableReason,inputBasis,errorCode,retryAt}=value;
      await write(key,{newsId,status,schemaVersion,modelVersion,market,disclaimer,analyzedAt,...(unavailableReason?{unavailableReason}:{}),...(inputBasis?{inputBasis}:{}),...(errorCode?{errorCode}:{}),...(retryAt?{retryAt}:{})},ttl);
    },
    acquireLease: (key: string, token: string) => mutate(`lease:${key}`,90,{owner:''},v=>v.owner ? null : {owner:token}),
    releaseLease: (key: string, token: string) => mutate(`lease:${key}`,1,{owner:''},v=>v.owner===token ? {owner:''} : null),
    reserveBudget: (date: string, limit: number, token: string) => mutate<Budget>(`budget:${date}`,172800,{used:0,pending:[]},v=>{
      if (!Number.isInteger(v.used) || !Array.isArray(v.pending) || v.used+v.pending.length>=limit) return null;
      return {...v,pending:[...v.pending,token]};
    }),
    finishBudget: (date: string, token: string, success: boolean) => mutate<Budget>(`budget:${date}`,172800,{used:0,pending:[]},v=>{
      if (!v.pending.includes(token)) return null;
      return {used:v.used+(success?1:0),pending:v.pending.filter(t=>t!==token)};
    }),
  };
}
export const newsAnalysisCache = createNewsAnalysisCache();
export const {getCachedAnalysis,setCachedAnalysis} = newsAnalysisCache;
