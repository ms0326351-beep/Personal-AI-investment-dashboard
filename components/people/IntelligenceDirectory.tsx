'use client';
import Link from 'next/link';
import {useState} from 'react';
import type {PublicIntelligenceDataset} from '@/lib/types/publicIntelligence';
import {FollowButton,FollowingNotice,useFollowing} from './Following';
import {PublicActivityCard} from './PublicIntelligence';
export function IntelligenceDirectory({data}:{data:PublicIntelligenceDataset}) {
  const [filter,setFilter]=useState('all');const {state,ready}=useFollowing();
  const followed=new Set(state.snapshot.records.map(r=>r.entityId));
  const visible=data.entities.filter(e=>filter==='following'?followed.has(e.id):filter==='person'?e.entityType!=='institution':filter==='institution'?e.entityType==='institution':true);
  const activity=data.activities.filter(a=>a.participants.some(p=>followed.has(p.entityId)));
  return <section className="intelligence-directory" aria-label="我的情報追蹤名單"><h2>我的情報追蹤名單</h2><FollowingNotice/>
    <div className="people-filters" role="group" aria-label="情報目錄篩選">{[['all','全部目錄'],['person','人物／待核對'],['institution','機構'],['following','我的追蹤 Following']].map(([value,label])=><button key={value} disabled={value==='following'&&!ready} aria-pressed={filter===value} onClick={()=>setFilter(value)}>{label}</button>)}</div>
    <p role="status">{ready?`本機追蹤 ${state.snapshot.records.length} 項；目前顯示 ${visible.length} 項`:'正在讀取本機追蹤清單…'}</p>
    <div className="people-grid">{visible.map(e=><article className="card intelligence-card" key={e.id}><p className="eyebrow">{e.entityType==='institution'?'機構':e.entityType==='person'?'人物':'身分待核對'} · UNKNOWN</p><h3><Link href={`/people/${encodeURIComponent(e.id)}`}>{e.name}</Link></h3><p>{e.roleLabel}</p><p className="muted">目錄身分待驗證；不代表公開持倉。</p><div className="intelligence-actions"><FollowButton id={e.id} name={e.name}/><Link href={`/people/${encodeURIComponent(e.id)}`}>查看情報詳情 →</Link></div></article>)}</div>
    {!visible.length&&<p className="scenario-note">尚無符合項目。追蹤人物或機構後，會出現在這裡。</p>}
    <section className="card intelligence-card"><h3>追蹤對象近期公開活動</h3>{activity.length?activity.map(a=><PublicActivityCard key={a.id} activity={a} entities={data.entities}/>):<p>UNKNOWN · {followed.size?'尚未接入追蹤對象的公開揭露資料；不代表沒有交易或活動。':'尚未追蹤對象。'}本階段不抓取真實交易、不產生 Cluster 或新增 AI 分析。</p>}</section>
  </section>;
}
