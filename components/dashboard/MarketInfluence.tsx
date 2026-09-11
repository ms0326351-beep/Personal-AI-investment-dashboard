import type { Holding } from '@/lib/types';
import { peopleService } from '@/lib/services/peopleService';
import { newsService } from '@/lib/services/newsService';
import { rankPeople } from '@/lib/utils/relevance';
import { PersonCard } from '@/components/people/PersonCard';
import { Card } from '@/components/ui/common';
import { DayTimeline } from './DayTimeline';
import Link from 'next/link';
export async function MarketInfluence({holdings,watchlist}:{holdings:Holding[];watchlist:string[]}) {
  const [snapshot,entries]=await Promise.all([peopleService.getSnapshot(),newsService.getDayTimeline()]);
  const highlights=rankPeople(snapshot.summaries,holdings,watchlist).slice(0,3);
  return <section className="market-influence" aria-label="誰在影響市場"><div className="section-label"><div><p className="eyebrow">誰在影響市場</p><h2>今日關鍵人物</h2></div><Link className="text-link" href="/people">查看全部人物 →</Link></div><p className="scenario-note">模擬情境日 {snapshot.date} · 資料時間 {snapshot.time}（台北）。人物職位與發言僅供版型示例，不代表真實任職、發言或排程；影響方向為假設，非投資建議。</p><div className="people-grid highlights">{highlights.map(summary=><PersonCard key={summary.person.id} summary={summary} holdings={holdings} watchlist={watchlist} compact/>)}</div><Card title="今日重要事件" eyebrow={`${snapshot.date} · 台北時間 · 模擬事件時間軸`} className="today-events"><DayTimeline entries={entries} people={snapshot.summaries.map(s=>s.person)} holdings={holdings} watchlist={watchlist} time={snapshot.time}/></Card></section>;
}
