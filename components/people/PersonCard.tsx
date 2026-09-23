import Link from 'next/link';
import type { Holding } from '@/lib/types';
import type { PersonSummary } from '@/lib/types/people';
import { isRelevantToUser, symbolRelation } from '@/lib/utils/relevance';

export const impactLabels = {high:'高',medium:'中',low:'低'};
const directions = {bullish:['up','▲ 利多'],bearish:['down','▼ 利空'],neutral:['muted','— 中性']};
export function SymbolLinks({symbols,holdings,watchlist}:{symbols:string[];holdings:Holding[];watchlist:string[]}) {
  return <div className="impact-symbols">{symbols.length ? symbols.map(symbol=>{
    const relation=symbolRelation(symbol,holdings,watchlist);
    return <Link key={symbol} href={`/stock/${symbol}`} className={relation?'related-symbol':''}>{symbol}{relation&&<small>{relation}</small>}<span aria-hidden="true">↗</span></Link>;
  }):<span className="muted text-sm">尚無對應模擬標的</span>}</div>;
}
export function PersonCard({summary,holdings,watchlist,compact=false}:{summary:PersonSummary;holdings:Holding[];watchlist:string[];compact?:boolean}) {
  const {person,latestEvent:event}=summary;
  const relevant=isRelevantToUser(person.relatedSymbols,holdings,watchlist);
  return <article id={compact?undefined:person.id} className="card person-card">
    <div className="person-identity"><span className="person-avatar" aria-hidden="true">{person.name.slice(0,2)}</span><div><h3>{person.name}</h3><p>{person.title} · {person.organization}</p></div></div>
    <div className="person-badges">{relevant&&<span className="relevance-badge">與我相關</span>}<span>● 影響程度：{impactLabels[person.currentImpactLevel]}</span></div>
    {event?<><h4 className="person-headline">{event.headline}</h4><time className="person-time" dateTime={event.occurredAt}>{event.occurredAt.slice(0,10)} {event.occurredAt.slice(11,16)}（台北）· 模擬資料</time><div className="person-direction"><span className={directions[event.impactDirection][0]}>{directions[event.impactDirection][1]}</span><span>{event.affectedMarkets.join(' / ')}</span></div><p className="eyebrow">事件 → 可能影響標的</p><SymbolLinks symbols={event.affectedSymbols} holdings={holdings} watchlist={watchlist}/></>:<p className="muted">暫無人物事件</p>}
    {compact?<Link className="text-link person-more" href={`/people#${person.id}`}>前往關鍵人物 →</Link>:<Link className="text-link person-more" href={`/people/${encodeURIComponent(person.id)}`}>人物情報詳情 →</Link>}
  </article>;
}
