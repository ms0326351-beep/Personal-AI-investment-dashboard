import type { FilingDocument, FilingIdentity } from '../types/publicFilings';
import { safePublicUrl } from './publicIntelligenceValidation';
import { identifierKey } from './filingIdentity';

function requireField(condition: unknown, field: string): asserts condition {
  if (!condition) throw new Error(`Invalid filing: ${field}`);
}
export function validFilingDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2}))?$/.test(value)) return false;
  if (!Number.isFinite(Date.parse(value))) return false;
  const day = value.slice(0, 10);
  return new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) === day;
}
/** Date-only publication is conservatively available AFTER that UTC day, never at its start. */
export function availabilityTime(value: string): number {
  if (!validFilingDate(value)) throw new Error('Invalid filing date');
  return Date.parse(value) + (value.length === 10 ? 86_400_000 : 0);
}
function identity(value: FilingIdentity) {
  requireField(value && typeof value.name === 'string' && value.name.trim(), 'identity.name');
  requireField(['person','institution','company','security','unknown'].includes(value.kind), 'identity.kind');
  requireField(typeof value.verified === 'boolean' && Array.isArray(value.evidence) && value.evidence.every(e => typeof e === 'string' && e.trim()), 'identity.evidence');
  requireField(value.identifier === null || (value.identifier && typeof value.identifier.value === 'string' && identifierKey(value)), 'identity.identifier');
  if (value.identifier) requireField(value.kind === 'security' ? ['cusip','isin'].includes(value.identifier.namespace) : ['cik','lei'].includes(value.identifier.namespace), 'identifier namespace/kind');
}
export function parseFilingDocument(input: unknown): FilingDocument {
  requireField(input && typeof input === 'object', 'document');
  const d = input as FilingDocument;
  for (const key of ['provider','filingId','rawSourceId','sourceReference'] as const) requireField(typeof d[key] === 'string' && /^[\w.:/-]{1,80}$/.test(d[key]), key);
  requireField(['FORM4','13F','13D','13G','POLITICIAN','INSTITUTIONAL','OTHER'].includes(d.form), 'form');
  requireField(typeof d.sourceUrl === 'string' && safePublicUrl(d.sourceUrl), 'sourceUrl');
  requireField(['public','mock'].includes(d.origin) && typeof d.verified === 'boolean', 'origin');
  if (d.origin === 'public' && ['FORM4','13F'].includes(d.form)) {
    const url = new URL(d.sourceUrl);
    requireField(url.protocol === 'https:' && url.hostname === 'www.sec.gov' && url.pathname.startsWith('/Archives/edgar/data/'), 'SEC source URL');
  }
  requireField(['KNOWN','PARTIAL','UNKNOWN'].includes(d.coverage) && typeof d.publicTableComplete === 'boolean' && [true,false,null].includes(d.confidentialOmissions), 'coverage');
  requireField(d.dates && validFilingDate(d.dates.retrievedAt) && d.dates.retrievedAt.includes('T'), 'retrievedAt');
  for (const key of ['periodEnd','filedAt','publishedAt','asOfDate'] as const) {
    requireField(d.dates[key] === null || validFilingDate(d.dates[key]), key);
    if (d.dates[key]) requireField(Date.parse(d.dates[key]!) <= Date.parse(d.dates.retrievedAt), `${key} after retrieval`);
  }
  requireField(d.amendment && ['original','restatement','additional','correction','unknown'].includes(d.amendment.kind), 'amendment');
  requireField(d.amendment.previousFilingId === null || (typeof d.amendment.previousFilingId === 'string' && d.amendment.previousFilingId !== d.filingId && d.amendment.previousFilingId.length <= 80), 'amendment reference');
  requireField(d.amendment.kind !== 'original' || d.amendment.previousFilingId === null, 'original revision');
  requireField(Array.isArray(d.participants) && d.participants.length > 0 && d.participants.length <= 100, 'participants');
  for (const p of d.participants) {
    requireField(p && ['subject','filer','reporting_owner','manager','beneficial_owner','speaker','author'].includes(p.role), 'participant role'); identity(p.identity);
    requireField(p.identity.kind !== 'security', 'security cannot be a filing participant');
  }
  requireField(Array.isArray(d.rows) && d.rows.length <= 100_000, 'rows');
  const ids = new Set<string>();
  for (const row of d.rows) {
    requireField(row && typeof row.rawSourceId === 'string' && /^[\w.:-]{1,64}$/.test(row.rawSourceId) && !ids.has(row.rawSourceId), 'duplicate row ID'); ids.add(row.rawSourceId);
    requireField(row.security, 'security'); identity(row.security.identity); identity(row.security.issuer);
    requireField(['security','unknown'].includes(row.security.identity.kind) && ['company','unknown'].includes(row.security.issuer.kind), 'security/issuer kind');
    for (const value of [row.security.ticker,row.security.shareClass,row.transactionCode,row.currency,row.ownershipNature,row.investmentDiscretion]) requireField(value === null || (typeof value === 'string' && value.length <= 1000), 'row text');
    requireField([null,'PUT','CALL'].includes(row.security.putCall), 'putCall');
    for (const key of ['eventDate','transactionDate'] as const) {
      requireField(row[key] === null || validFilingDate(row[key]), key);
      if (row[key]) requireField(Date.parse(row[key]!) <= Date.parse(d.dates.retrievedAt), 'future event');
    }
    if (d.form === '13F') requireField(row.transactionDate === null && row.transactionCode === null, '13F is not a transaction');
    if (row.transactionDate && d.dates.filedAt) requireField(row.transactionDate.slice(0,10) <= d.dates.filedAt.slice(0,10), 'transaction after filing');
    for (const key of ['shares','price','reportedValue','ownershipAfter'] as const) requireField(row[key] === null || (typeof row[key] === 'number' && Number.isFinite(row[key]) && row[key]! >= 0 && row[key]! <= Number.MAX_SAFE_INTEGER), key);
    requireField(['shares','principal','unknown'].includes(row.shareUnit) && ['units','thousands','unknown'].includes(row.valueScale), 'units');
    requireField(['direct','indirect','unknown'].includes(row.ownershipType) && ['reported','calculated','estimated','inferred','unknown'].includes(row.quality), 'row quality');
    requireField(Array.isArray(row.otherManagers) && row.otherManagers.every(m => typeof m === 'string'), 'other managers');
    requireField(Array.isArray(row.evidence) && row.evidence.every(e => e && typeof e.id === 'string' && e.id && typeof e.excerpt === 'string' && e.excerpt.trim() && (e.locator === null || typeof e.locator === 'string')), 'row evidence');
  }
  return structuredClone(d);
}
