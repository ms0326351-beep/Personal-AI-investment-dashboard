import { ACTIVITY_TYPES, type Provenance, type PublicIntelligenceDataset } from '../types/publicIntelligence';

export const safePublicUrl = (value: string | null): string | null => {
  try { if (!value) return null; const url=new URL(value); return ['https:','http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null; } catch { return null; }
};
const date=(value:unknown)=>value===null || (typeof value==='string' && /^\d{4}-\d{2}-\d{2}(T.*)?$/.test(value) && Number.isFinite(Date.parse(value)));
const requireValid=(value:unknown,field:string)=>{if(!value) throw new Error(`Invalid public intelligence: ${field}`);};
export function effectiveCoverage(p:Provenance):'KNOWN'|'PARTIAL'|'UNKNOWN' {
  if(p.origin!=='public' || p.sourceType==='fixture' || p.sourceType==='legacy_registry' || p.verification!=='verified' || p.confidence==='unknown' || !p.evidence.length || (!safePublicUrl(p.sourceUrl) && !p.filingReference) || !p.knownAt) return 'UNKNOWN';
  if(p.freshness!=='current') return p.coverage==='UNKNOWN'?'UNKNOWN':'PARTIAL';
  return p.coverage;
}
export function validateProvenance(p:Provenance) {
  requireValid(p && typeof p.source==='string' && p.source.trim(),'source');
  requireValid(['legacy_registry','fixture','sec_form4','sec_13f','politician_disclosure','institution_report','news','public_statement'].includes(p.sourceType),'sourceType');
  requireValid(p.sourceUrl===null || safePublicUrl(p.sourceUrl),'sourceUrl');
  requireValid(p.filingReference===null || (typeof p.filingReference==='string' && p.filingReference.trim()),'filingReference');
  for(const key of ['reportedAt','filedAt','asOfDate','knownAt','lastVerifiedAt'] as const) requireValid(date(p[key]),key);
  requireValid(['public','legacy','mock'].includes(p.origin) && ['verified','unverified'].includes(p.verification),'origin');
  if(p.sourceType==='fixture') requireValid(p.origin==='mock','fixture origin');
  if(p.sourceType==='legacy_registry') requireValid(p.origin==='legacy','legacy origin');
  requireValid(['current','stale','unknown'].includes(p.freshness) && ['KNOWN','PARTIAL','UNKNOWN'].includes(p.coverage) && ['high','medium','low','unknown'].includes(p.confidence),'quality');
  requireValid(Array.isArray(p.evidence) && p.evidence.every(e=>e && typeof e.id==='string' && e.id && typeof e.excerpt==='string' && e.excerpt.trim() && (e.locator===null || typeof e.locator==='string')),'evidence');
  if(p.knownAt) for(const key of ['reportedAt','filedAt'] as const) if(p[key]) requireValid(Date.parse(p.knownAt)>=Date.parse(p[key]!), 'knownAt precedes publication');
}
export function validatePublicDataset(data:PublicIntelligenceDataset) {
  requireValid(data.version===1 && Array.isArray(data.entities) && Array.isArray(data.relationships) && Array.isArray(data.activities),'dataset');
  const ids=new Set<string>();
  const id=(value:string)=>{requireValid(typeof value==='string' && value.length>0 && value.length<=200 && !ids.has(value),'duplicate/invalid id');ids.add(value);};
  const entities=new Map(data.entities.map(e=>[e.id,e]));
  for(const e of data.entities) {
    id(e.id); validateProvenance(e.provenance);
    requireValid(['person','institution','unresolved'].includes(e.entityType) && typeof e.name==='string' && e.name.trim(),'identity');
    requireValid(Array.isArray(e.roles) && e.roles.every(r=>['investor','fund_manager','executive','insider','analyst','public_commentator','policy_official'].includes(r)),'roles');
    requireValid(date(e.lastUpdated) && (e.avatar===null || safePublicUrl(e.avatar)),'entity dates/avatar');
  }
  for(const r of data.relationships) {
    id(r.id);validateProvenance(r.provenance);
    requireValid(entities.has(r.sourceId) && r.target && (r.target.kind==='entity'?entities.has(r.target.id):r.target.kind==='security' && r.target.id && r.target.ticker),'relationship target');
    requireValid(['affiliation','manager_of','reported_holding','mentions','research_subject','legacy_association'].includes(r.type),'relationship type');
    requireValid(date(r.validFrom) && date(r.validTo) && (!r.validFrom || !r.validTo || Date.parse(r.validFrom)<=Date.parse(r.validTo)),'relationship dates');
    if(r.type==='reported_holding') requireValid(effectiveCoverage(r.provenance)!=='UNKNOWN','unsupported holding edge');
  }
  const activityIds=new Set(data.activities.map(a=>a.id));
  for(const a of data.activities) {
    id(a.id); validateProvenance(a.provenance);
    requireValid(ACTIVITY_TYPES.includes(a.kind) && ['FACT','REPORTED','INFERENCE','OPINION','UNKNOWN'].includes(a.claim),'activity kind/claim');
    requireValid(typeof a.title==='string' && a.title.trim() && a.security && a.security.id && a.security.company,'activity identity');
    requireValid(Array.isArray(a.participants) && a.participants.length>0 && a.participants.every(p=>entities.has(p.entityId) && ['subject','filer','reporting_owner','manager','beneficial_owner','speaker','author'].includes(p.role)),'participants');
    requireValid(date(a.transactionDate),'transactionDate');
    requireValid(a.supersedesId===null || (a.supersedesId!==a.id && activityIds.has(a.supersedesId)),'revision');
    if(a.kind==='public_mention' || a.kind==='research_opinion') {
      requireValid(a.action===(a.kind==='public_mention'?'mentioned':'opinion') && a.quantity===null && a.transactionDate===null,'mention/opinion is not a trade');
      requireValid(a.claim==='OPINION' || a.claim==='REPORTED' || a.claim==='UNKNOWN','unverified opinion as fact');
    } else if(a.kind==='disclosed_holding' || a.kind==='institutional_holding') {
      requireValid(a.action==='held' && a.transactionDate===null,'snapshot is not a trade');
    } else if(a.kind==='planned_transaction') requireValid(a.action==='planned','planned is not executed');
    else requireValid(['purchase','sale','grant','exercise','gift','other','unknown'].includes(a.action),'transaction action');
    if(a.quantity) {
      const q=a.quantity;
      requireValid(['reported','calculated','estimated','unknown'].includes(q.quality) && ['shares','currency','fraction'].includes(q.unit),'quantity basis');
      requireValid(q.value===null || (Number.isFinite(q.value) && q.value>=0),'quantity');
      requireValid(q.value===null || q.quality!=='unknown','unknown quantity');
      requireValid(q.unit!=='fraction' || (!!q.denominator && (q.value===null || q.value<=1)),'weight denominator');
      requireValid(q.unit!=='currency' || !!q.currency,'currency');
    }
    if(a.claim==='FACT') requireValid(effectiveCoverage(a.provenance)==='KNOWN','unsupported fact');
  }
  for(const a of data.activities) {
    const seen=new Set<string>();let cursor:typeof a|undefined=a;
    while(cursor) {requireValid(!seen.has(cursor.id),'revision cycle');seen.add(cursor.id);cursor=data.activities.find(x=>x.id===cursor?.supersedesId);}
  }
}
