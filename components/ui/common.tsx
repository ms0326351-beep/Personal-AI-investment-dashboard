import { MarketStatus } from '@/components/ui/MarketStatus';
import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { number, percent } from '@/lib/utils/formatters';
import type { Security, NewsItem } from '@/lib/types';
import { peopleRegistry } from '@/lib/data/peopleRegistry';
import { NewsAIAnalysisPanel } from '@/components/dashboard/NewsAIAnalysisPanel';
export function Change({value}:{value:number}){return <span className={value>0?'up':value<0?'down':'muted'}>{percent(value)}</span>}
export function Card({title,eyebrow,children,href,linkLabel='查看全部',className=''}:{title:string;eyebrow?:string;children:React.ReactNode;href?:string;linkLabel?:string;className?:string}){return <section className={`card ${className}`}><div className="card-heading"><div>{eyebrow&&<p className="eyebrow">{eyebrow}</p>}<h2>{title}</h2></div>{href&&<Link className="text-link" href={href}>{linkLabel}<ArrowUpRight size={15}/></Link>}</div>{children}</section>}
export function SecurityList({securities}:{securities:Security[]}){return <div>{securities.map(s=><Link href={`/stock/${s.symbol}`} key={s.symbol} className="security-row"><span className={`ticker-icon ${s.market==='US'?'us':''}`}>{s.symbol.slice(0,2)}</span><span className="security-name"><strong>{s.symbol}</strong><small>{s.name}</small></span><span className="quote"><strong>{number(s.price)}</strong><small>{s.currency} · <Change value={s.changePercent}/> · {s.change>=0?"+":""}{number(s.change)}</small><MarketStatus data={s}/></span><ArrowUpRight size={15} className="muted"/></Link>)}</div>}
export function NewsList({items}:{items:NewsItem[]}) {
  const formatter=new Intl.DateTimeFormat('zh-TW', {timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});
  return <div className="news-list">{items.map(n=>{
    const timestamp=Date.parse(n.publishedAt);
    const people=[...new Set(n.relatedPersonIds ?? [])].flatMap(id=>{
      const person=peopleRegistry.find(p=>p.id===id);
      return person ? [person] : [];
    });
    // Only web URLs can be opened as external source links.
    const url=n.url && /^https?:\/\//i.test(n.url) ? n.url : undefined;
    return <article key={n.id}>
      <small className="muted">{n.source} · {Number.isFinite(timestamp)?<time dateTime={n.publishedAt}>{formatter.format(timestamp)}（台北）</time>:'發布時間不明'}</small>
      <small className="muted" style={{display:'block'}}>{n.origin==='rss'?'真實來源 · RSS':'模擬資料'}</small>
      {n.fallbackReason&&<small className="muted" role="status" style={{display:'block'}}>{n.fallbackReason}</small>}
      <h3>{url?<a href={url} target="_blank" rel="noopener noreferrer">{n.title}</a>:n.title}</h3>
      <p>{n.summary}</p>
      {(n.relatedSymbols.length>0||people.length>0)&&<div className="tags" style={{flexWrap:'wrap'}}>
        {n.relatedSymbols.map(s=><Link href={`/stock/${encodeURIComponent(s)}`} key={s}>{s}</Link>)}
        {people.map(p=><Link href={`/people#${p.id}`} key={`person-${p.id}`}>人物：{p.name}</Link>)}
      </div>}
      <NewsAIAnalysisPanel newsId={n.id}/>
    </article>;
  })}</div>;
}
