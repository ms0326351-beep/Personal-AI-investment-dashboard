import type { Holding, Security, Currency } from '@/lib/types';
import { buildPortfolioIntelligence } from '@/lib/services/portfolioIntelligenceService';
import { PortfolioIntelligence } from './PortfolioIntelligence';

export async function PortfolioExposureSection({holdings,securities,fx}:{holdings:Holding[];securities:Security[];fx:Record<Currency,number>}) {
  try {
    const view=await buildPortfolioIntelligence({holdings,securities,fx,asOf:new Date().toISOString()});
    return <PortfolioIntelligence mode="portfolio" view={view}/>;
  } catch {
    return <section className="exposure-panel" aria-label="投資組合曝險視角"><h3>投資組合曝險視角</h3><p>資料暫不可用 · UNKNOWN。原有持股明細不受影響；稍後重新整理再試。</p></section>;
  }
}
