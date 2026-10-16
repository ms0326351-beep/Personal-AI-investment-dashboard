import 'server-only';
import { getStore, getDeployStore } from '@netlify/blobs';

/** Preview writes must never share the production cache or quota. */
export function newsStoreScope(scope = process.env.NEWS_BLOB_STORE_SCOPE):'site'|'deploy' {
  if(scope==='site'||scope==='deploy') return scope;
  throw new Error('NEWS_BLOB_STORE_SCOPE must be explicitly configured as site or deploy');
}
type NewsStoreFactory=(options:{name:string;consistency:'strong';fetch:typeof fetch})=>ReturnType<typeof getStore>;
export function getNewsBlobStore(name: string, stores:{site:NewsStoreFactory;deploy:NewsStoreFactory}={site:getStore,deploy:getDeployStore}) {
  const scope=newsStoreScope();
  const boundedFetch=createNewsBlobFetch();
  const options = {name, consistency: 'strong' as const, fetch:boundedFetch};
  return stores[scope](options);
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
