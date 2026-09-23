import type { NormalizedFiling } from '../types/publicFilings';
import { validFilingDate } from '../utils/publicFilingValidation';
import { filingFreshness } from '../services/publicFilingNormalization';

export interface DisclosedPositionChange {
  securityId: string;
  positionKey: string;
  change: 'new' | 'increased' | 'reduced' | 'exited' | 'unchanged' | 'unknown';
  before: number | null;
  after: number | null;
  delta: number | null;
  evidenceFilingIds: string[];
  basis: 'disclosed_snapshot_difference';
}
/** Changes in disclosed share counts, NOT inferred executions, trade dates or investment signals. */
export function compareDisclosedHoldings(before: NormalizedFiling, after: NormalizedFiling, asKnownAt: string): {coverage:'KNOWN'|'PARTIAL'|'UNKNOWN';changes:DisclosedPositionChange[];reason:string|null} {
  const unknown = (reason:string) => ({coverage:'UNKNOWN' as const,changes:[],reason});
  if (!validFilingDate(asKnownAt)) return unknown('Invalid knowledge cutoff');
  if ([before,after].some(f=>f.source.form !== '13F' || Date.parse(f.knownAt)>Date.parse(asKnownAt))) return unknown('Unsupported or not yet known');
  const manager = (f:NormalizedFiling) => [...new Set(f.participants.filter(p=>p.role==='manager').map(p=>p.entityId))].sort().join('|');
  const managersBefore = manager(before), managersAfter = manager(after);
  if (!managersBefore || managersBefore !== managersAfter || [before,after].some(f=>f.identities.some(e=>e.status!=='resolved'))) return unknown('Unresolved or different reporting manager/entities');
  if (!before.source.dates.periodEnd || !after.source.dates.periodEnd || Date.parse(before.source.dates.periodEnd)>=Date.parse(after.source.dates.periodEnd)) return unknown('Periods must advance; amendment is not a new quarter');
  if ([before,after].some(f=>f.source.amendment.kind !== 'original')) return unknown('Amendment reconciliation required before comparison');
  const table = (f:NormalizedFiling) => {
    const map = new Map<string,{securityId:string;shares:number|null}>();
    for (const a of f.dataset.activities) {
      const row = f.source.rows.find(r=>r.rawSourceId===a.filing.rawSourceId)!;
      // Do not conflate options, principal amounts, classes, discretion or other manager allocations.
      const key = JSON.stringify([a.security.id,a.security.shareClass,row.security.putCall,row.shareUnit,row.investmentDiscretion,[...row.otherManagers].sort()]);
      const valid = row.shareUnit==='shares' && row.quality==='reported' && row.shares !== null && row.evidence.length>0 && f.source.verified;
      const prior = map.get(key);
      // Multiple rows may be joint/repeated allocations: fail closed rather than guessing an additive basis.
      map.set(key,{securityId:a.security.id,shares:prior || !valid ? null : row.shares});
    }
    return map;
  };
  const a = table(before), b = table(after);
  const complete = (f:NormalizedFiling) => f.coverage==='KNOWN' && f.source.publicTableComplete && f.source.confidentialOmissions===false && filingFreshness(f.source,asKnownAt,f.freshnessPolicy.maxAgeDays)==='fresh';
  const changes = [...new Set([...a.keys(),...b.keys()])].sort().map(key => {
    const old=a.get(key), current=b.get(key);
    const previous=old ? old.shares : complete(before) ? 0 : null;
    const next=current ? current.shares : complete(after) ? 0 : null;
    const delta=previous===null || next===null ? null : next-previous;
    const change:DisclosedPositionChange['change']=delta===null?'unknown':previous===0&&next!>0?'new':next===0&&previous!>0?'exited':delta>0?'increased':delta<0?'reduced':'unchanged';
    return {securityId:(old ?? current)!.securityId,positionKey:key,change,before:previous,after:next,delta,evidenceFilingIds:[before.id,after.id],basis:'disclosed_snapshot_difference' as const};
  });
  return {coverage:complete(before)&&complete(after)&&changes.every(c=>c.change!=='unknown')?'KNOWN':'PARTIAL',changes,reason:'Share-count differences are not trades; corporate actions, reporting scope and confidential omissions can change disclosures.'};
}
