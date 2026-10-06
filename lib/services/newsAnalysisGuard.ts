import 'server-only';
import type { AnalysisBlobStore } from './ai/newsAnalysisCache';
import { getNewsBlobStore } from './news/newsBlobStore';

export async function analysisRequestError(request: Request): Promise<{status:number;message:string}|null> {
  if (request.body !== null) {
    const reader=request.body.getReader();
    try {
      for(;;) {
        const first=await reader.read();
        if(first.done) break;
        if(first.value.byteLength>0) return {status:413,message:'分析請求不接受文章內容或 request body'};
      }
    } finally { await reader.cancel();reader.releaseLock(); }
  }
  if (request.headers.get('X-News-Analysis-Request') !== '1') return {status:403,message:'請從網站的 AI 分析按鈕發送請求'};
  const origin=request.headers.get('Origin');
  const target=new URL(request.url);
  // Next's internal URL can use its listening hostname. Host retains the request authority.
  const host=request.headers.get('Host');
  const requestOrigin=host && /^[a-z0-9.\-\[\]:]+$/i.test(host) ? `${target.protocol}//${host}` : target.origin;
  if ((origin !== null && origin !== requestOrigin) || ['cross-site','same-site'].includes(request.headers.get('Sec-Fetch-Site') ?? ''))
    return {status:403,message:'不允許跨來源分析請求'};
  return null;
}

/** Shared global minute cap, not authentication. No client IP/personal data is stored. */
export function createAnalysisRequestGuard(
  storeFactory:()=>AnalysisBlobStore=()=>getNewsBlobStore('news-ai-requests'),
  now=Date.now,
) {
  return {async check():Promise<{status:number;message:string;retryAfter:number}|null> {
    const time=now(),minute=Math.floor(time/60000),key=`requests:${minute}`;
    const retryAfter=Math.max(1,Math.ceil(((minute+1)*60000-time)/1000));
    try {
      const store=storeFactory();
      for(let i=0;i<5;i++) {
        const old=await store.getWithMetadata(key,{type:'json',consistency:'strong'});
        if(old && (!old.etag || !old.data || typeof old.data!=='object' || !('count' in old.data) || !Number.isSafeInteger(old.data.count) || Number(old.data.count)<0)) throw Error('Invalid rate state');
        const count=old?Number((old.data as {count:number}).count):0;
        if(count>=30) return {status:429,message:'分析請求過於頻繁，請稍後再試',retryAfter};
        const result=await store.setJSON(key,{count:count+1},old?{onlyIfMatch:old.etag!}:{onlyIfNew:true});
        if(result.modified) return null;
      }
      return {status:429,message:'分析請求繁忙，請稍後再試',retryAfter};
    } catch { return {status:503,message:'分析請求協調服務暫時無法使用，請稍後再試',retryAfter}; }
  }};
}
export const analysisRequestGuard=createAnalysisRequestGuard();
