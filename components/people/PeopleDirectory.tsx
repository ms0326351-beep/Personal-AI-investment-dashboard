'use client';
import { useState } from 'react';
import type { Holding } from '@/lib/types';
import type { PersonSummary } from '@/lib/types/people';
import { rankPeople,isRelevantToUser } from '@/lib/utils/relevance';
import { PersonCard } from './PersonCard';
const filters=[['all','全部'],['us_politics','美國政治與政府'],['central_bank','Fed'],['taiwan','台灣政治與監理'],['corporate_leader','企業領袖'],['relevant','與我相關']];
export function PeopleDirectory({summaries,holdings,watchlist}:{summaries:PersonSummary[];holdings:Holding[];watchlist:string[]}) {
  const [filter,setFilter]=useState('all');
  const [sort,setSort]=useState('relevant');
  const visible=rankPeople(summaries.filter(({person:p})=>filter==='all'||(filter==='relevant'?isRelevantToUser(p.relatedSymbols,holdings,watchlist):filter==='taiwan'?['tw_politics','regulator'].includes(p.category):p.category===filter)),holdings,watchlist,sort==='latest');
  return <><div className="people-toolbar"><div className="people-filters" role="group" aria-label="人物分類">{filters.map(([value,label])=><button key={value} aria-pressed={filter===value} onClick={()=>setFilter(value)}>{label}</button>)}</div><label className="people-sort">排序<select value={sort} onChange={e=>setSort(e.target.value)}><option value="relevant">與我相關、影響程度</option><option value="latest">最新更新</option></select></label></div><p className="people-count" role="status">共 {visible.length} 位人物／機構</p><div className="people-grid">{visible.map(summary=><PersonCard key={summary.person.id} summary={summary} holdings={holdings} watchlist={watchlist}/>)}</div>{!visible.length&&<div className="card empty"><h2>目前沒有符合的人物</h2><p>請切換其他分類查看。</p><button onClick={()=>setFilter('all')}>顯示全部</button></div>}</>;
}
