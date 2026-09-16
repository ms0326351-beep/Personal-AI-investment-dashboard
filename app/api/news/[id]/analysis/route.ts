import 'server-only';
import { fetchRealNews } from '@/lib/services/news/realNewsProvider';
import { newsAnalysisService, unavailableNewsAnalysis } from '@/lib/services/newsAnalysisService';
import { portfolioRepository } from '@/lib/services/portfolioRepository';
import { watchlistRepository } from '@/lib/services/watchlistRepository';
import type { NewsAIAnalysis } from '@/lib/types/newsAnalysis';

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
    if(!/^rss-[a-z0-9]{1,32}$/i.test(id)) return respond(unavailableNewsAnalysis(id.slice(0,64),'找不到原始新聞內容'));
    const {items}=await fetchRealNews();
    const item=items.find(n=>n.id===id);
    if(!item) return respond(unavailableNewsAnalysis(id,'找不到原始新聞內容'));
    const [holdings,watchlist]=await Promise.all([portfolioRepository.getHoldings(),watchlistRepository.getSymbols()]);
    return respond(await newsAnalysisService.getOrCreateAnalysis(item,holdings,watchlist));
  } catch { return respond(unavailableNewsAnalysis(id)); }
}
