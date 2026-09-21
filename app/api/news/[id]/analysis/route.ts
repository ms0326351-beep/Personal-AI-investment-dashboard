import 'server-only';
import { newsAnalysisService, unavailableNewsAnalysis } from '@/lib/services/newsAnalysisService';
import { portfolioRepository } from '@/lib/services/portfolioRepository';
import { watchlistRepository } from '@/lib/services/watchlistRepository';
import type { NewsAIAnalysis } from '@/lib/types/newsAnalysis';
import { resolveNewsForAnalysis } from '@/lib/services/news/newsItemSnapshots';

export const runtime='nodejs';
const respond=(result:NewsAIAnalysis) => Response.json(
  // The model name participates in server cache keys, but environment values stay server-side.
  {...result,modelVersion:'server-managed'},
  {headers:{'Cache-Control':'private, no-store'}},
);
export async function POST(_request:Request, context:{params:Promise<{id:string}>}) {
  let id='';
  try {
    id=(await context.params).id;
    if(!/^rss-[a-z0-9]{1,32}$/i.test(id)) return respond(unavailableNewsAnalysis(id.slice(0,64),'找不到可供分析的新聞內容'));
    const item=await resolveNewsForAnalysis(id);
    if(!item) return respond(unavailableNewsAnalysis(id,'找不到可供分析的新聞內容；此新聞可能已離開來源清單，請重新整理頁面'));
    const [holdings,watchlist]=await Promise.all([portfolioRepository.getHoldings(),watchlistRepository.getSymbols()]);
    // Only an explicit retry flag is accepted; article text remains server-owned.
    const retry=_request.headers.get('X-News-Analysis-Retry')==='1';
    return respond(await newsAnalysisService.getOrCreateAnalysis(item,holdings,watchlist,retry));
  } catch { return respond(unavailableNewsAnalysis(id)); }
}
