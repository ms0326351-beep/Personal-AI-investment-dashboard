import Link from 'next/link';
import type { Provenance, PublicActivity, TrackedEntity, PublicRelationship } from '@/lib/types/publicIntelligence';
import {effectiveCoverage,safePublicUrl} from '@/lib/utils/publicIntelligenceValidation';
export const activityLabels:Record<PublicActivity['kind'],string>={disclosed_transaction:'已揭露交易',disclosed_holding:'已揭露持倉',insider_transaction:'內部人申報交易',institutional_holding:'機構揭露持倉',public_mention:'公開提及（不是交易）',research_opinion:'研究觀點（不是交易）',planned_transaction:'預定交易／轉讓（不是已成交）'};
const participantLabels={subject:'活動主體',filer:'申報人 Filer',reporting_owner:'申報所有人 Reporting Owner',manager:'管理人 Manager',beneficial_owner:'受益所有人 Beneficial Owner',speaker:'發言者',author:'作者'};
const actionLabels={purchase:'申報買入',sale:'申報賣出',grant:'授予',exercise:'行權',gift:'贈與',other:'其他',unknown:'未知',held:'持倉快照（非交易）',mentioned:'僅提及',opinion:'觀點',planned:'計畫／事前申報'};
const coverageLabels={KNOWN:'已知 · KNOWN',PARTIAL:'部分資料 · PARTIAL',UNKNOWN:'資料不足 · UNKNOWN'};
const confidenceLabels={high:'高',medium:'中',low:'低',unknown:'未知'};
export function ProvenanceDetails({data}:{data:Provenance}) {
  const url=safePublicUrl(data.sourceUrl);
  return <div className="intelligence-provenance"><span className="exposure-badge">{coverageLabels[effectiveCoverage(data)]}</span> <span>可信度：{confidenceLabels[effectiveCoverage(data)==='UNKNOWN'?'unknown':data.confidence]}</span>
    <p>{data.origin==='mock'?'模擬資料 · 不是真實交易或持倉':data.origin==='legacy'?'既有目錄 · 尚未獨立驗證':'公開來源資料'} · {data.freshness==='stale'?'資料過期':data.freshness==='current'?'來源標示為近期資料':'時效未知'}</p>
    <details><summary>來源與資料日期</summary><p>來源：{data.source} · {data.sourceType}</p>{url?<a href={url} target="_blank" rel="noopener noreferrer">查看來源原文 ↗</a>:<p>來源網址：未知／尚未提供</p>}<p>申報參考：{data.filingReference ?? '未知／不適用'}</p>
      <dl>{([['公開／報導時間',data.reportedAt],['申報時間',data.filedAt],['資料基準日',data.asOfDate],['本系統取得時間',data.knownAt],['最後核對時間',data.lastVerifiedAt]] as const).map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value ?? '未知／未提供'}</dd></div>)}</dl>
      <p>公開或申報日期不等於交易日；資料基準日不代表目前仍持有。</p>{data.evidence.length?data.evidence.map(e=><blockquote key={e.id}>{e.excerpt}<small>依據 {e.id} · {e.locator ?? '未提供文件位置'}</small></blockquote>):<p>尚無可核對的原文證據。</p>}
    </details></div>;
}
export function PublicActivityCard({activity,entities}:{activity:PublicActivity;entities:TrackedEntity[]}) {
  const q=activity.quantity;
  return <article className="card intelligence-card"><p className="eyebrow">{activityLabels[activity.kind]}</p><h3>{activity.title}</h3><p>{activity.security.ticker ?? '股票代號未知'} · {activity.security.company}</p><p>{actionLabels[activity.action]} · 資料陳述分類：{activity.claim}</p>
    {activity.participants.map((p,i)=><p key={`${p.entityId}:${p.role}:${i}`}>{participantLabels[p.role]}：{entities.find(e=>e.id===p.entityId)?.name ?? '未核對主體'}</p>)}
    <p>交易日期：{activity.transactionDate ?? '未提供／此類資料不是已執行交易'}</p>
    {q&&<p>數量／金額：{q.value ?? '未知'} · {q.unit} {q.currency} · {q.quality}{q.denominator?` · 分母：${q.denominator}`:''}</p>}
    {activity.supersedesId&&<p>修訂前筆資料：{activity.supersedesId}（不可當成新增交易）</p>}
    <ProvenanceDetails data={activity.provenance}/>
  </article>;
}
export function EntityConnections({entity,entities,relationships}:{entity:TrackedEntity;entities:TrackedEntity[];relationships:PublicRelationship[]}) {
  const affiliations=relationships.filter(r=>r.type==='affiliation' && (r.sourceId===entity.id || (r.target.kind==='entity' && r.target.id===entity.id)));
  const securities=relationships.filter(r=>r.sourceId===entity.id && r.target.kind==='security');
  return <><section className="card intelligence-card"><h2>身分／角色與所屬機構</h2><p>{entity.roleLabel}</p><p>{entity.description}</p><p>最後更新：{entity.lastUpdated ?? '未知'}</p>
    <p>Filer、Reporting Owner、Manager、Beneficial Owner 需逐筆申報證據確認；此目錄未確認上述身分。</p>
    {affiliations.length?affiliations.map(r=>{const targetId=r.sourceId===entity.id?r.target.id:r.sourceId;return <div key={r.id}><p>所屬／成員目錄關聯：<Link href={`/people/${encodeURIComponent(targetId)}`}>{entities.find(e=>e.id===targetId)?.name ?? targetId}</Link>（未核對，不代表持有關係）</p><ProvenanceDetails data={r.provenance}/></div>}):<p>所屬機構或成員資料：UNKNOWN</p>}
    <ProvenanceDetails data={entity.provenance}/></section>
    <section className="card intelligence-card"><h2>關聯公司／標的</h2><p>既有目錄關聯僅供研究入口，不是本人持股、交易或發言證據；也不繼承機構持倉。</p>{securities.length?securities.map(r=><div key={r.id}><p>{r.target.kind==='security'?r.target.ticker:''} · 公司／市場映射待核對</p><ProvenanceDetails data={r.provenance}/></div>):<p>UNKNOWN · 尚無已核對的關联公司資料。</p>}</section></>;
}
