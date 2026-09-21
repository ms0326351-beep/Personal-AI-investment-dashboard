import 'server-only';
import { getStore } from '@netlify/blobs';
import type { NewsItem } from '../../types';
import type { AnalysisBlobStore } from '../ai/newsAnalysisCache';
import { fetchRealNews } from './realNewsProvider';

const TTL=48*3600000;
const MAX_ITEMS=500;
const KEY='recent-items-v1';
type Entry={item:NewsItem;expiresAt:number};
function isEntry(value:unknown):value is Entry {
  if(!value || typeof value!=='object') return false;
  const e=value as Entry,n=e.item;
  return typeof e.expiresAt==='number' && !!n && n.origin==='rss' && /^rss-[a-z0-9]{1,32}$/i.test(n.id)
    && ['title','summary','source','publishedAt'].every(k=>typeof n[k as keyof NewsItem]==='string')
    && Array.isArray(n.relatedSymbols) && n.relatedSymbols.every(s=>typeof s==='string');
}

/** Retain trusted server RSS items independently of the moving feed window.
 * One bounded snapshot blob avoids one network write per news card.
 */
export function createNewsItemSnapshots(
  storeFactory:()=>AnalysisBlobStore=()=>getStore({name:'news-source-snapshots',consistency:'strong',fetch:(url,init)=>fetch(url,{...init,signal:AbortSignal.timeout(3000)})}),
  now=Date.now,
  warn=()=>console.warn('[news-input] Persistent snapshots unavailable; retaining RSS items in process memory.'),
) {
  let memory:Entry[]=[];
  let warned=false;
  let retryAfter=0;
  let pending:Promise<void>|undefined;
  const merge=(...groups:Entry[][])=>{
    const map=new Map<string,Entry>();
    for(const group of groups) for(const entry of group) if(isEntry(entry) && entry.expiresAt>now()) map.set(entry.item.id,entry);
    return [...map.values()].sort((a,b)=>b.expiresAt-a.expiresAt).slice(0,MAX_ITEMS);
  };
  const entries=(data:unknown):Entry[]=>Array.isArray(data)?data.filter(isEntry):[];
  const failed=()=>{retryAfter=now()+60000;if(!warned){warned=true;warn();}};
  return {
    async remember(items:NewsItem[]):Promise<void> {
      const incoming=items.filter(item=>item.origin==='rss').map(item=>({item:structuredClone(item),expiresAt:now()+TTL}));
      // Unchanged items need not write again while comfortably within their retention period.
      const changed=incoming.some(e=>!memory.some(old=>old.item.id===e.item.id && old.expiresAt>now()+TTL/2 && JSON.stringify(old.item)===JSON.stringify(e.item)));
      memory=merge(memory,incoming);
      if(!changed || now()<retryAfter) return;
      if(pending) await pending;
      pending=(async()=>{
        try {
          const store=storeFactory();
          for(let attempt=0;attempt<4;attempt++) {
            const old=await store.getWithMetadata(KEY,{type:'json',consistency:'strong'});
            if(old && !old.etag) throw Error('Snapshot version missing');
            memory=merge(entries(old?.data),memory);
            const saved=await store.setJSON(KEY,memory,old?{onlyIfMatch:old.etag!}:{onlyIfNew:true});
            if(saved.modified) return;
          }
          throw Error('Snapshot contention');
        } catch {failed();}
      })();
      try {await pending;} finally {pending=undefined;}
    },
    async find(id:string):Promise<NewsItem|null> {
      memory=merge(memory);
      const local=memory.find(e=>e.item.id===id);
      if(local) return structuredClone(local.item);
      if(now()<retryAfter) return null;
      try {
        const stored=await storeFactory().getWithMetadata(KEY,{type:'json',consistency:'strong'});
        memory=merge(entries(stored?.data),memory);
        return structuredClone(memory.find(e=>e.item.id===id)?.item ?? null);
      } catch {failed();return null;}
    },
  };
}

// Next's page and route bundles can instantiate modules separately in one process.
const root=globalThis as typeof globalThis & {__investmentNewsSnapshots?:ReturnType<typeof createNewsItemSnapshots>};
export const newsItemSnapshots=root.__investmentNewsSnapshots ??=createNewsItemSnapshots();

export async function resolveNewsForAnalysis(id:string, options:{snapshots?:ReturnType<typeof createNewsItemSnapshots>;fetchNews?:typeof fetchRealNews}={}) {
  const snapshots=options.snapshots ?? newsItemSnapshots;
  const remembered=await snapshots.find(id);
  if(remembered) return remembered;
  const {items}=await (options.fetchNews ?? fetchRealNews)();
  await snapshots.remember(items);
  return items.find(n=>n.id===id) ?? null;
}
