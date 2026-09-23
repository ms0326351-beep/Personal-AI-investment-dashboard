import type { Metadata } from 'next';
import { peopleService } from '@/lib/services/peopleService';
import { portfolioRepository } from '@/lib/services/portfolioRepository';
import { watchlistRepository } from '@/lib/services/watchlistRepository';
import { PeopleDirectory } from '@/components/people/PeopleDirectory';
import { publicIntelligenceRepository } from '@/lib/services/publicIntelligenceRepository';
import { FollowingProvider } from '@/components/people/Following';
import { IntelligenceDirectory } from '@/components/people/IntelligenceDirectory';
export const metadata: Metadata={title:'關鍵人物'};
export default async function PeoplePage() {
  const [snapshot,holdings,watchlist]=await Promise.all([peopleService.getSnapshot(),portfolioRepository.getHoldings(),watchlistRepository.getSymbols()]);
  const intelligence=await publicIntelligenceRepository.getSnapshot();
  return <><div className="page-heading"><div><p className="eyebrow">誰在影響市場</p><h1>關鍵人物</h1><p className="muted">追蹤人物與機構，分辨公開揭露、提及與投資觀點。</p></div></div><FollowingProvider><IntelligenceDirectory data={intelligence}/></FollowingProvider><section className="intelligence-legacy"><h2>既有人物與事件 · 模擬情境</h2><p className="scenario-note">以下保留原有分類、排序與人物錨點。{snapshot.date} {snapshot.time}（台北）的事件、發言與影響方向皆為模擬情境，非真實交易或新聞紀錄，非投資建議。</p><PeopleDirectory summaries={snapshot.summaries} holdings={holdings} watchlist={watchlist}/></section></>;
}
