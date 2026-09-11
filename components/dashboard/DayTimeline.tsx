import Link from 'next/link';
import { BellRing, ChartNoAxesCombined, Landmark, Mic, CalendarDays } from 'lucide-react';
import type { Holding } from '@/lib/types';
import type { DayTimelineEntry, KeyPerson } from '@/lib/types/people';
import { isRelevantToUser } from '@/lib/utils/relevance';
import { impactLabels, SymbolLinks } from '@/components/people/PersonCard';
const icons={market_open:ChartNoAxesCombined,economic_data:ChartNoAxesCombined,fed_speech:Mic,earnings:BellRing,policy:Landmark};
export function DayTimeline({entries,people,holdings,watchlist,time}:{entries:DayTimelineEntry[];people:KeyPerson[];holdings:Holding[];watchlist:string[];time:string}) {
  const sorted=[...entries].sort((a,b)=>a.time.localeCompare(b.time));
  const nowIndex=sorted.findIndex(e=>e.time>=time);
  const marker=<li className="timeline-now"><span>{time}</span><strong>模擬現在時間</strong></li>;
  return <ol className="day-timeline">{sorted.flatMap((e,i)=>{
    const Icon=icons[e.category] ?? CalendarDays;
    const row=<li key={e.id} className={`day-entry ${e.time<time?'past':''}`}><time>{e.time}</time><div className="day-content"><div className="day-title"><Icon size={17}/><h3>{e.label}</h3><span className="event-badge">{impactLabels[e.importance]}關注</span></div><div className="person-badges"><span>{e.time<time?'已過模擬時間':'模擬待發生'}</span>{isRelevantToUser(e.relatedSymbols,holdings,watchlist)&&<span className="relevance-badge">與你相關</span>}{e.relatedPersonIds.map(id=>{const p=people.find(p=>p.id===id);return p?<Link href={`/people#${id}`} key={id} className="text-link">{p.name} ↗</Link>:null})}</div><p className="impact-reason">{e.impactReason}</p><p className="eyebrow">事件 → 可能影響標的</p><SymbolLinks symbols={e.relatedSymbols} holdings={holdings} watchlist={watchlist}/></div></li>;
    return i===nowIndex?[<li key="now" className="timeline-now"><span>{time}</span><strong>模擬現在時間</strong></li>,row]:[row];
  })}{nowIndex===-1&&marker}</ol>;
}
