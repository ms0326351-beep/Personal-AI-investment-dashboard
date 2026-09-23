import 'server-only';
import { resolveNewsForAnalysis } from '@/lib/services/news/newsItemSnapshots';
import { portfolioRepository } from '@/lib/services/portfolioRepository';
import { marketDataService } from '@/lib/services/marketDataService';
import { buildPortfolioIntelligence } from '@/lib/services/portfolioIntelligenceService';

export const runtime='nodejs';
export const dynamic='force-dynamic';
const response=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store'}});
/** Independent read-only calculation: never invokes GPT or changes its retry/daily-limit/cache. */
export async function GET(_request:Request,context:{params:Promise<{id:string}>}) {
  try {
    const {id}=await context.params;
    if(!/^rss-[a-z0-9]{1,32}$/i.test(id)) return response({message:'無法取得此新聞的曝險資料'},404);
    const news=await resolveNewsForAnalysis(id);
    if(!news) return response({message:'原始新聞暫不可用，仍可閱讀目前新聞'},404);
    const [holdings,securities,fx]=await Promise.all([portfolioRepository.getHoldings(),marketDataService.getSecurities(),marketDataService.getFx()]);
    return response(await buildPortfolioIntelligence({holdings,securities,fx,news,asOf:new Date().toISOString()}));
  } catch {return response({message:'曝險資料暫時無法取得；不影響原有 AI 分析'},503);}
}
