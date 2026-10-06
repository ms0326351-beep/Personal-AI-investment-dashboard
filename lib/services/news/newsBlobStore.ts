import 'server-only';
import { getStore, getDeployStore } from '@netlify/blobs';

/** Preview writes must never share the production cache or quota. */
export function newsStoreScope(context = process.env.CONTEXT) {
  return context === 'production' ? 'production' : 'nonproduction';
}
export function getNewsBlobStore(name: string) {
  const boundedFetch=createNewsBlobFetch();
  const options = {name, consistency: 'strong' as const, fetch:boundedFetch};
  return newsStoreScope() === 'production' ? getStore(options) : getDeployStore(options);
}

/** Reject HTTP failures before the SDK can report a conditional PUT as modified.
 * GET 404 is a missing blob; conditional PUT 412 is a legitimate CAS conflict.
 * SDK retries remain finite; every attempt must pass this boundary.
 */
export function createNewsBlobFetch(fetcher:typeof fetch=fetch):typeof fetch {
  return async (url,init)=>{
    try {
      const response=await fetcher(url,{...init,signal:AbortSignal.timeout(3000)});
      const method=(init?.method ?? 'GET').toUpperCase();
      const headers=new Headers(init?.headers);
      const conflict=method==='PUT' && response.status===412 &&
        (headers.has('if-match') || headers.get('if-none-match')==='*');
      if(response.ok || method==='GET' && response.status===404 || conflict) return response;
    } catch { /* Never expose SDK URLs, credentials or upstream error details. */ }
    throw new Error('News shared storage unavailable');
  };
}
