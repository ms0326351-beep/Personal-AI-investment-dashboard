import 'server-only';
import { getStore, getDeployStore } from '@netlify/blobs';

/** Preview writes must never share the production cache or quota. */
export function newsStoreScope(context = process.env.CONTEXT) {
  return context === 'production' ? 'production' : 'nonproduction';
}
export function getNewsBlobStore(name: string) {
  const boundedFetch:typeof fetch=(url,init)=>fetch(url,{...init,signal:AbortSignal.timeout(3000)});
  const options = {name, consistency: 'strong' as const, fetch:boundedFetch};
  return newsStoreScope() === 'production' ? getStore(options) : getDeployStore(options);
}
