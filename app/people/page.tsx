import type { Metadata } from 'next';
import { peopleService } from '@/lib/services/peopleService';
import { portfolioRepository } from '@/lib/services/portfolioRepository';
import { watchlistRepository } from '@/lib/services/watchlistRepository';
import { PeopleDirectory } from '@/components/people/PeopleDirectory';
export const metadata: Metadata={title:'關鍵人物'};
export default async function PeoplePage() {
  const [snapshot,holdings,watchlist]=await Promise.all([peopleService.getSnapshot(),portfolioRepository.getHoldings(),watchlistRepository.getSymbols()]);
  return <><div className="page-heading"><div><p className="eyebrow">誰在影響市場</p><h1>關鍵人物</h1><p className="muted">追蹤正在影響台股與美股的人物與機構</p></div><span className="mock-badge">模擬資料 · {snapshot.date} {snapshot.time}（台北）</span></div><p className="scenario-note">以下人物職位、發言、事件與影響方向皆為模擬情境，並非真實任職或新聞紀錄，非投資建議。本階段提供列表與標的連結，人物歷史詳細頁將於後續提供。</p><PeopleDirectory summaries={snapshot.summaries} holdings={holdings} watchlist={watchlist}/></>;
}
