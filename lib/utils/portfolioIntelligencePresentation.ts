import type { ExposureDataset, Confidence, DataStatus } from '../types/exposure';
import type { PortfolioExposureSummary } from '../types/portfolioExposure';
import type { NewsPortfolioIntelligence, TransmissionStep } from '../types/newsExposure';
import type { IntelligencePath, PortfolioIntelligenceView } from '../types/portfolioIntelligence';

export interface PositionLabel { name: string; symbol: string; estimatedWeight: number | null }
export const exposurePercent=(n:number|null|undefined)=>n==null || !Number.isFinite(n)?'未知':`${(n*100).toFixed(2)}%`;
const confidence=(c:Confidence)=>({high:'高',medium:'中',low:'低',unknown:'未知'})[c];
const direction={positive:'偏多（條件式推論）',negative:'偏空（條件式推論）',mixed:'多空混合',uncertain:'不確定'};
const relationships:Record<string,string>={news_mention:'新聞點名',issuer_identity:'發行公司對應',ETF_holding:'ETF 成分持有',portfolio_holding:'本機持股',company_to_company:'公司關聯',company_to_industry:'公司與產業',supplier_to_customer:'供應商 → 客戶',customer_to_supplier:'客戶 → 供應商',technology_dependency:'技術依賴',infrastructure_dependency:'基礎設施依賴',commodity_dependency:'原物料依賴',geographic_dependency:'地理依賴',regulatory_dependency:'政策／監管',demand_driver:'需求驅動',substitution:'替代關係',competition:'競爭關係',complementary:'互補關係'};
export function safeEvidenceUrl(raw:string):string {
  try {const u=new URL(raw); return ['https:','http:'].includes(u.protocol) && !u.username && !u.password?u.href:'';} catch {return '';}
}
export function presentPortfolioIntelligence(summary:PortfolioExposureSummary,foundation:ExposureDataset,labels:Record<string,PositionLabel>,news?:NewsPortfolioIntelligence,newsTitle=''):PortfolioIntelligenceView {
  const names=new Map(foundation.entities.map(e=>[e.id,e.name]));
  const name=(id:string)=>id.startsWith('news:')?newsTitle:id.startsWith('position:')?`我的持股 · ${labels[id.slice(9)]?.name ?? id.slice(9)}`:names.get(id) ?? id;
  const lt=news?.portfolioExposure ?? summary.lookThrough;
  const step=(s:TransmissionStep)=>({from:name(s.source),to:name(s.target),relationship:relationships[s.relationshipType] ?? s.relationshipType,
    basis:s.basis==='reported'?'來源記載／持有關係；不代表影響已證實':s.basis==='inferred'?'推論／情境，非已確認事實':'未知／證據不足',confidence:confidence(s.confidence),date:s.asOf,
    evidence:[...s.evidence.map(e=>`${e.excerpt}（觀察：${e.observedAt}）`),...(s.portfolioEvidence?[`本機持股快照 ${s.portfolioEvidence.asOf}`]:[]),...(s.relationship?[`有效期間：${s.relationship.validFrom ?? '未提供'} ～ ${s.relationship.validTo ?? '未提供'}`]:[])],
    sources:s.evidenceSource.map(s=>({title:s.title,url:safeEvidenceUrl(s.url),date:`發布：${s.publishedAt ?? '未提供'}；取得：${s.retrievedAt}`})),conditions:s.invalidationConditions});
  const pathView=(path:NonNullable<typeof news>['paths'][number],extra:TransmissionStep[]=[],conf:Confidence=path.confidence,coverage=path.evidenceCoverage):IntelligencePath=>({id:path.id,order:path.order==='first_order'?'一階':path.order==='second_order'?'二階':'三階以上',confidence:confidence(conf),coverage:`${coverage.supportedEdges}/${coverage.totalEdges} 跳有來源支持`,scenario:path.scenarios.map(s=>s.condition),steps:[...path.steps,...extra].map(step)});
  const groups:PortfolioIntelligenceView['groups']=[];
  if(lt) {
    groups.push({title:'ETF 穿透後曝險',status:lt.status,note:'僅按可驗證成分快照計算；未知部分不會補足或重新正規化。',metrics:[{label:'已知底層持有比例',value:exposurePercent(lt.coveredPortfolioWeight)},{label:'未知部分',value:exposurePercent(lt.unknownPortfolioWeight)}]});
    groups[0].metrics.push(...lt.positions.map(p=>({label:labels[p.positionId]?.name ?? p.positionId,value:`${p.status} · 該部位已知成分 ${exposurePercent(p.coveredFraction)}／未知 ${exposurePercent(p.unknownFraction)}`})));
    groups.push({title:'公司曝險',status:lt.companyConcentration.status,note:'直接持有與各 ETF 有效持有路徑合併；這是資產比例，不是事件損益或機率。',metrics:lt.companyConcentration.buckets.map(b=>({label:name(b.companyEntityId),value:`直接 ${exposurePercent(b.direct)} ＋ ETF 間接 ${exposurePercent(b.indirect)} ＝ 合計 ${exposurePercent(b.combined)}`}))});
    for(const [dimension,title] of [['industry','產業曝險'],['theme','主題曝險']] as const) {
      const d=lt.exposure.dimensions[dimension];
      groups.push({title,status:d.concentration?.status ?? d.coverage.status,note:`覆蓋 ${d.coverage.coveredPositions}/${d.coverage.totalPositions} 個底層部位。${dimension==='theme'?'主題可重疊，不可相加視為 100% 資產配置。':'缺少分類資料，不代表沒有產業風險。'}`,metrics:d.concentration?.buckets.map(b=>({label:name(b.entityId),value:exposurePercent(b.portfolioWeight)})) ?? []});
    }
    groups.push({title:'重複曝險',status:lt.status,note:'ETF 交集率是兩檔基金成分的交集，不是投組額外曝險；不可再加到持股比例。',metrics:[...lt.companyConcentration.buckets.filter(b=>b.direct>0 && b.indirect>0).map(b=>({label:name(b.companyEntityId),value:`直接 ＋ ETF 間接合計 ${exposurePercent(b.combined)}`})),...lt.overlaps.map(o=>({label:`${name(o.leftEtfAssetId)} / ${name(o.rightEtfAssetId)}`,value:`${o.status} · 已知交集 ${exposurePercent(o.knownOverlap)}`}))]});
  }
  return {version:1,newsId:news?.newsId ?? null,status:news?.status ?? lt?.status ?? 'UNKNOWN',asOf:summary.asOf,
    notes:['曝險表示條件式關聯，不代表因果已證實、價格預測或買賣建議。','持股來源目前為模擬投組；持股比例估算沿用行情與模擬匯率，與已確認曝險分開。',...(news?.truncated?['路徑已達上限，結果僅為部分。']:[]),...(news?.gaps.some(g=>g.reason==='stale_relationship')?['部分關聯已過期並排除，不能視為完整結果。']:[]),...(news?.gaps.some(g=>g.reason==='conflicting_evidence')?['關聯含衝突證據，方向仍不確定。']:[]),...(!foundation.relationships.length?['尚未提供經審核的公司／產業／供應鏈關聯與 ETF 成分快照；目前僅能比對新聞點名的資產。']:[])],
    holdings:news?.holdings.map(h=>{
      const matches=news.connections.filter(c=>c.ownership.positionId===h.positionId);
      const unique=[...new Map(matches.filter(c=>c.confidence!=='unknown').map(c=>[c.ownership.id,c.ownership])).values()];
      const weight=(nature:'DIRECT'|'INDIRECT')=>!unique.length || unique.some(s=>s.portfolioWeight===null)?null:unique.filter(s=>s.nature===nature).reduce((n,s)=>n+s.portfolioWeight!,0);
      return {id:h.positionId,title:labels[h.positionId]?.name ?? h.positionId,symbol:labels[h.positionId]?.symbol ?? '',status:h.status,
        badges:[...(h.direct?['直接關聯']:[]),...(h.indirect?['間接關聯']:[]),...(matches.some(c=>c.ownership.nature==='INDIRECT')?['ETF 穿透']:[]),...(matches.some(c=>(news.paths.find(p=>p.id===c.pathId)?.depth ?? 0)>1)?['多跳關聯']:[])],
        metrics:[{label:'持股權重（估算）',value:exposurePercent(labels[h.positionId]?.estimatedWeight)},{label:'直接持有曝險',value:exposurePercent(weight('DIRECT'))},{label:'ETF 間接曝險',value:exposurePercent(weight('INDIRECT'))},{label:'合計已知關聯曝險',value:exposurePercent(h.connectedPortfolioWeight)},{label:'影響方向',value:direction[h.direction]},{label:'影響程度',value:'引擎未提供，不以曝險權重推定'},{label:'可信度',value:confidence(h.confidence)},{label:'新聞路徑數',value:String(h.pathIds.length)}],
        paths:matches.flatMap((c,i)=>{const p=news.paths.find(p=>p.id===c.pathId);return p?[{...pathView(p,c.ownershipSteps,c.confidence,c.evidenceCoverage),id:`${p.id}-${i}`}]:[]})};
    }) ?? [],higherOrder:news?.paths.filter(p=>p.depth>=2).map(p=>pathView(p)) ?? [],groups};
}

/** Reject malformed transport data before rendering; only presentation primitives cross the boundary. */
export function isPortfolioIntelligenceView(value:unknown):value is PortfolioIntelligenceView {
  const obj=(v:unknown):v is Record<string,unknown>=>!!v && typeof v==='object';
  const str=(v:unknown)=>typeof v==='string';
  const arr=(v:unknown,check:(v:unknown)=>boolean)=>Array.isArray(v) && v.every(check);
  const strings=(v:unknown)=>arr(v,str);
  const status=(v:unknown)=>['KNOWN','PARTIAL','UNKNOWN'].includes(v as DataStatus);
  const metric=(v:unknown)=>obj(v) && str(v.label) && str(v.value);
  const step=(v:unknown)=>obj(v) && ['from','to','relationship','basis','confidence','date'].every(k=>str(v[k])) && strings(v.evidence) && strings(v.conditions) && arr(v.sources,s=>obj(s) && str(s.title) && str(s.url) && str(s.date));
  const path=(v:unknown)=>obj(v) && ['id','order','confidence','coverage'].every(k=>str(v[k])) && strings(v.scenario) && arr(v.steps,step);
  return obj(value) && value.version===1 && (value.newsId===null || str(value.newsId)) && status(value.status) && str(value.asOf) && strings(value.notes)
    && arr(value.holdings,h=>obj(h) && ['id','title','symbol'].every(k=>str(h[k])) && status(h.status) && strings(h.badges) && arr(h.metrics,metric) && arr(h.paths,path))
    && arr(value.higherOrder,path) && arr(value.groups,g=>obj(g) && str(g.title) && status(g.status) && str(g.note) && arr(g.metrics,metric));
}
