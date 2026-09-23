import type { FilingActivity, FilingDocument, FilingFreshness, IdentityBinding, NormalizedFiling, ResolvedFilingIdentity } from '../types/publicFilings';
import type { Provenance, TrackedEntity } from '../types/publicIntelligence';
import { resolveFilingIdentity } from '../utils/filingIdentity';
import { availabilityTime, parseFilingDocument, validFilingDate } from '../utils/publicFilingValidation';
import { validatePublicDataset } from '../utils/publicIntelligenceValidation';

export function filingKnownAt(d: FilingDocument): string {
  return new Date(Math.max(Date.parse(d.dates.retrievedAt), ...[d.dates.filedAt,d.dates.publishedAt].filter((v):v is string => !!v).map(availabilityTime))).toISOString();
}
export function filingFreshness(d: FilingDocument, now: string, maxAgeDays: number): FilingFreshness {
  if (!validFilingDate(now) || !Number.isFinite(maxAgeDays) || maxAgeDays < 0) throw new Error('Invalid freshness policy');
  const basis = d.dates.asOfDate ?? d.dates.periodEnd;
  if (!basis || d.coverage === 'UNKNOWN' || Date.parse(now) < Date.parse(basis)) return 'unknown';
  if ((Date.parse(now) - Date.parse(basis)) / 86_400_000 > maxAgeDays) return 'stale';
  if (d.coverage !== 'KNOWN' || !d.publicTableComplete) return 'partial';
  return 'fresh';
}
export function normalizePublicFiling(input: unknown, options: { now: string; maxAgeDays: number; bindings?: readonly IdentityBinding[] }): NormalizedFiling {
  const d = parseFilingDocument(input);
  if (!validFilingDate(options.now) || Date.parse(d.dates.retrievedAt) > Date.parse(options.now)) throw new Error('Retrieval after evaluation');
  if (d.form !== 'FORM4' && d.form !== '13F') throw new Error('Unsupported filing form: adapter required');
  const id = `${d.provider}:${d.filingId}`;
  const identities: ResolvedFilingIdentity[] = [];
  const resolve = (identity: Parameters<typeof resolveFilingIdentity>[0], scope: string) => {
    const resolved = resolveFilingIdentity(identity, `${id}:${scope}`, options.bindings);
    if (!identities.some(e => e.id === resolved.id)) identities.push(resolved);
    return resolved;
  };
  const participants = d.participants.map((p,i) => ({entityId:resolve(p.identity, `participant:${i}`).id,role:p.role}));
  const knownAt = filingKnownAt(d);
  const freshness = filingFreshness(d, options.now, options.maxAgeDays);
  const issues: string[] = [];
  if (!d.dates.publishedAt) issues.push('Public availability time unknown; filing date is not publication time.');
  if (!d.dates.filedAt) issues.push('Filing date missing.');
  if (d.amendment.kind !== 'original') issues.push('Amendment retained separately; do not sum as a new trade/position.');
  const sourceType = d.form === 'FORM4' ? 'sec_form4' : 'sec_13f';
  const provenance = (coverage: Provenance['coverage'], evidence: Provenance['evidence']): Provenance => ({
    source:d.provider, sourceType:d.origin === 'mock' ? 'fixture' : sourceType, sourceUrl:d.sourceUrl, filingReference:d.sourceReference,
    reportedAt:d.dates.publishedAt, filedAt:d.dates.filedAt, asOfDate:d.dates.asOfDate ?? d.dates.periodEnd, knownAt,
    lastVerifiedAt:d.verified ? d.dates.retrievedAt : null, evidence, confidence:coverage === 'UNKNOWN' ? 'unknown' : 'medium', coverage,
    verification:d.verified ? 'verified' : 'unverified', freshness:freshness === 'fresh' ? 'current' : freshness === 'stale' ? 'stale' : 'unknown', origin:d.origin,
  });
  const activities: FilingActivity[] = d.rows.map(row => {
    const security = resolve(row.security.identity, `security:${row.rawSourceId}`);
    const company = resolve(row.security.issuer, `issuer:${row.rawSourceId}`);
    const requiredRole = d.form === 'FORM4' ? 'reporting_owner' : 'manager';
    const identityKnown = participants.every(p => identities.find(e => e.id === p.entityId)?.status === 'resolved') && security.status === 'resolved' && company.status === 'resolved';
    let coverage: Provenance['coverage'] = d.coverage;
    if (!d.verified || !identityKnown || !row.evidence.length || row.quality === 'unknown' || !participants.some(p => p.role === requiredRole)) coverage = 'UNKNOWN';
    else if (coverage === 'KNOWN' && (!d.dates.filedAt || !d.dates.publishedAt || !d.publicTableComplete || freshness !== 'fresh' || row.shares === null || row.shareUnit !== 'shares' || row.quality !== 'reported' || (d.form === 'FORM4' ? row.price === null || !row.currency || !row.transactionDate || row.ownershipType === 'unknown' : !d.dates.periodEnd || row.reportedValue === null || !row.currency || row.valueScale === 'unknown'))) coverage = 'PARTIAL';
    const value = row.reportedValue !== null && row.valueScale !== 'unknown' ? row.reportedValue * (row.valueScale === 'thousands' ? 1000 : 1) : null;
    const codeActions = {P:'purchase',S:'sale',A:'grant',M:'exercise',G:'gift'} as const;
    const action = row.transactionCode ? codeActions[row.transactionCode as keyof typeof codeActions] ?? 'other' : 'unknown';
    const common = {
      id:`filing:${id}:${row.rawSourceId}`, title:`${d.form} · ${row.security.issuer.name}`, participants,
      security:{id:security.id,ticker:row.security.ticker,company:row.security.issuer.name,market:null,shareClass:row.security.shareClass},
      transactionDate:d.form === 'FORM4' ? row.transactionDate : null,
      provenance:provenance(coverage,row.evidence), supersedesId:null,
      claim:row.quality === 'inferred' || row.quality === 'estimated' ? 'INFERENCE' as const : row.quality === 'unknown' ? 'UNKNOWN' as const : 'REPORTED' as const,
      quantity:row.shareUnit === 'shares' ? {value:row.quality === 'unknown' ? null : row.shares,quality:row.shares === null || row.quality === 'unknown' ? 'unknown' as const : row.quality === 'inferred' ? 'estimated' as const : row.quality,unit:'shares' as const,currency:null,denominator:null} : null,
      filing:{provider:d.provider,form:d.form,filingId:d.filingId,rawSourceId:row.rawSourceId,sourceReference:d.sourceReference,companyId:company.id,securityId:security.id,
        dates:{...d.dates,eventDate:row.eventDate,transactionDate:row.transactionDate,knownAt},price:row.price,currency:row.currency,reportedValue:row.reportedValue,valueScale:row.valueScale,
        value:row.currency && value !== null && value <= Number.MAX_SAFE_INTEGER ? value : null,ownershipAfter:row.ownershipAfter,ownershipType:row.ownershipType,ownershipNature:row.ownershipNature,
        shareUnit:row.shareUnit,investmentDiscretion:row.investmentDiscretion,otherManagers:row.otherManagers,quality:row.quality,freshness,amendment:d.amendment},
    };
    return d.form === 'FORM4' ? {...common,kind:'insider_transaction',action,transactionCode:row.transactionCode} : {...common,kind:'institutional_holding',action:'held'};
  });
  const entities: TrackedEntity[] = identities.filter(e => participants.some(p => p.entityId === e.id)).map(e => ({
    id:e.id,name:e.identity.name,entityType:e.identity.kind === 'person' ? 'person' : e.identity.kind === 'institution' || e.identity.kind === 'company' ? 'institution' : 'unresolved',
    roles:[],avatar:null,description:'申報中列名的主體；角色僅限各筆申報，不推定其他持有關係。',roleLabel:'公開申報主體',organizationLabel:null,
    externalIds:e.identity.identifier?.namespace === 'cik' ? [{namespace:'cik',value:e.identity.identifier.value}] : [],lastUpdated:d.dates.retrievedAt,
    provenance:provenance(e.status === 'resolved' ? 'PARTIAL' : 'UNKNOWN',e.identity.evidence.map((excerpt,i)=>({id:`identity-${i}`,excerpt,locator:null}))),
  }));
  const dataset = {version:1 as const,entities,relationships:[],activities};
  validatePublicDataset(dataset);
  const roleKnown = participants.some(p => p.role === (d.form === 'FORM4' ? 'reporting_owner' : 'manager'));
  const coverage = identities.some(e => e.status === 'unknown') || d.coverage === 'UNKNOWN' || !d.verified || !roleKnown || activities.some(a=>a.provenance.coverage==='UNKNOWN') ? 'UNKNOWN' :
    d.coverage === 'PARTIAL' || d.amendment.kind !== 'original' || !d.publicTableComplete || !d.dates.filedAt || !d.dates.publishedAt || freshness !== 'fresh' || (d.form === '13F' && !d.dates.periodEnd) || activities.some(a => a.provenance.coverage !== 'KNOWN') ? 'PARTIAL' : 'KNOWN';
  return {id,source:d,identities,participants,dataset,freshness,freshnessPolicy:{evaluatedAt:options.now,maxAgeDays:options.maxAgeDays},coverage,knownAt,issues};
}
