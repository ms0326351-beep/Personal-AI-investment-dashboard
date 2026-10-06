import 'server-only';
import { resolveNewsForAnalysis } from './news/newsItemSnapshots';
export async function getNewsDetail(id:string,resolve=resolveNewsForAnalysis) {
  if(!/^rss-[a-z0-9]{1,32}$/i.test(id)) return null;
  try {return await resolve(id);} catch {return null;}
}
export function newsSourceUrl(value:string|undefined):string|undefined {
  if(!value) return;
  try {const url=new URL(value);if(['https:','http:'].includes(url.protocol)&&!url.username&&!url.password)return url.href;}catch{}
}
