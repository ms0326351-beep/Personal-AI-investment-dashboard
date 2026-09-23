import Link from 'next/link';
import {notFound} from 'next/navigation';
import {publicIntelligenceRepository} from '@/lib/services/publicIntelligenceRepository';
import {FollowingProvider,FollowingNotice,FollowButton} from '@/components/people/Following';
import {EntityConnections,PublicActivityCard} from '@/components/people/PublicIntelligence';

export default async function PersonDetail({params}:{params:Promise<{id:string}>}) {
  const {id}=await params;const data=await publicIntelligenceRepository.getSnapshot();
  const entity=data.entities.find(e=>e.id===id);if(!entity)notFound();
  const activities=await publicIntelligenceRepository.getActivities(id);
  const disclosures=activities.filter(a=>!['public_mention','research_opinion'].includes(a.kind));
  const mentions=activities.filter(a=>['public_mention','research_opinion'].includes(a.kind));
  return <FollowingProvider><Link className="text-link" href="/people">← 返回關鍵人物與機構</Link><div className="page-heading"><div><p className="eyebrow">公開投資情報 · {entity.entityType==='institution'?'機構':entity.entityType==='person'?'人物':'身分待核對'}</p><h1>{entity.name}</h1></div><FollowButton id={entity.id} name={entity.name}/></div><FollowingNotice/>
    <div className="intelligence-detail"><EntityConnections entity={entity} entities={data.entities} relationships={data.relationships}/>
    <section className="card intelligence-card"><h2>公開活動／研究觀點</h2><p>公開提及不代表實際買入；觀點不等於已確認事實。</p>{mentions.length?mentions.map(a=><PublicActivityCard key={a.id} activity={a} entities={data.entities}/>):<p>UNKNOWN · 尚未取得可歸因的公開活動。</p>}</section>
    <section className="card intelligence-card"><h2>公開持股／交易資料</h2><p>未接入 SEC Form 4、13F 或其他申報；未披露不等於持股為零。機構持股不視為個人持股。</p>{disclosures.length?disclosures.map(a=><PublicActivityCard key={a.id} activity={a} entities={data.entities}/>):<p>UNKNOWN · 尚無可核對的公開持倉／交易資料。</p>}</section>
    <section className="card intelligence-card"><h2>新聞</h2><p>UNKNOWN · 本階段未接入經人物歸因驗證的新聞；公司名稱命中不能證明本人發言。</p><Link href="/dashboard#all-market-news">前往既有市場新聞 →</Link></section>
    </div><p className="disclaimer">公開情報僅供研究，非投資建議；本階段沒有自動跟單、Cluster Signal 或新增 AI 分析。</p></FollowingProvider>;
}
