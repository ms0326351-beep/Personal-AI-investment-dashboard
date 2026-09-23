import type { FilingIdentity } from '../types/publicFilings';
import type { DataStatus } from '../types/exposure';
import type { Form4Assessment, Form4Source } from '../types/secForm4';
import { identifierKey, resolveFilingIdentity } from './filingIdentity';
import { validFilingDate } from './publicFilingValidation';

const requireValue = (ok: unknown, field: string): void => { if (!ok) throw new Error(`Invalid Form 4: ${field}`); };
const text = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= 10000;
const nullableText = (v: unknown) => v === null || text(v);
const evidence = (v: unknown): boolean => Array.isArray(v) && v.every(e => e && text(e.id) && text(e.excerpt) && nullableText(e.locator));
const status = (v: unknown) => ['KNOWN','PARTIAL','UNKNOWN'].includes(v as string);
const weakest = (...values: DataStatus[]): DataStatus => values.includes('UNKNOWN') ? 'UNKNOWN' : values.includes('PARTIAL') ? 'PARTIAL' : 'KNOWN';
function validateIdentity(i: FilingIdentity, kinds: string[]) {
  requireValue(i && text(i.name) && kinds.includes(i.kind), 'identity kind/name');
  requireValue(typeof i.verified === 'boolean' && Array.isArray(i.evidence) && i.evidence.every(text), 'identity evidence');
  requireValue(i.identifier === null || (i.identifier && text(i.identifier.value) && identifierKey(i) &&
    (i.kind === 'security' ? ['cusip','isin'] : ['cik']).includes(i.identifier.namespace)), 'identity identifier');
}
/** Existing C2 resolver: same verified CIK/kind resolves despite spelling; names never merge. */
export function resolveForm4Party(identity: FilingIdentity, filingId: string, role: 'issuer' | 'reporting_owner' | 'filer', reference: string) {
  validateIdentity(identity, role === 'issuer' ? ['company','unknown'] : ['person','institution','unknown']);
  requireValue(text(filingId) && text(reference), 'identity scope');
  return resolveFilingIdentity(identity, JSON.stringify([filingId,role,reference]));
}
/** Validates an already structured source object; this does not parse SEC XML. */
export function validateForm4Source(d: Form4Source): void {
  requireValue(d && d.schemaVersion === 'form4-source-v1' && d.form === 'FORM4' && ['4','4/A'].includes(d.filingType), 'form/version');
  requireValue(text(d.filingId) && (d.accessionNumber === null || /^\d{10}-\d{2}-\d{6}$/.test(d.accessionNumber)), 'filing identifier');
  requireValue(status(d.parseStatus) && status(d.normalizationStatus), 'status');
  requireValue(d.dates && validFilingDate(d.dates.retrievedAt) && d.dates.retrievedAt.includes('T'), 'retrievedAt');
  for (const key of ['periodEnd','filedAt','publishedAt','asOfDate'] as const) {
    const v = d.dates[key];
    requireValue(v === null || (validFilingDate(v) && Date.parse(v) <= Date.parse(d.dates.retrievedAt)), key);
  }
  validateIdentity(d.issuer, ['company','unknown']);
  requireValue(nullableText(d.issuerTicker) && Array.isArray(d.filers), 'issuer/filers');
  d.filers.forEach(i => validateIdentity(i, ['person','institution','unknown']));
  requireValue(Array.isArray(d.reportingOwners) && d.reportingOwners.length <= 100, 'owners');
  const owners = new Set<string>();
  for (const o of d.reportingOwners) {
    requireValue(o && text(o.reference) && !owners.has(o.reference), 'duplicate owner reference'); owners.add(o.reference);
    validateIdentity(o.identity, ['person','institution','unknown']);
    requireValue(o.relationship && evidence(o.relationship.evidence), 'owner relationship');
    for (const k of ['director','officer','tenPercentOwner','other'] as const) requireValue([true,false,null].includes(o.relationship[k]), k);
    requireValue(nullableText(o.relationship.officerTitle) && nullableText(o.relationship.otherText), 'owner role text');
  }
  requireValue(d.amendment && ['original','restatement','additional','correction','unknown'].includes(d.amendment.kind), 'amendment');
  requireValue(nullableText(d.amendment.previousFilingId) && d.amendment.previousFilingId !== d.filingId, 'amendment parent');
  requireValue(d.filingType === '4' ? d.amendment.kind === 'original' && d.amendment.previousFilingId === null : d.amendment.kind !== 'original', 'amendment type');
  requireValue(d.provenance && d.provenance.sourceAuthority === 'SEC' && text(d.provenance.sourceIdentifier) && ['public','mock'].includes(d.provenance.origin) && nullableText(d.provenance.parserVersion) && evidence(d.provenance.evidence), 'provenance');
  for (const key of ['sourceUrl','filingUrl'] as const) {
    const v = d.provenance[key];
    if (v !== null) {
      let safe = false;
      try { const u = new URL(v!); safe = u.protocol === 'https:' && u.hostname === 'www.sec.gov' && !u.username && !u.password && u.port === '' && u.pathname.startsWith('/Archives/edgar/data/'); } catch { /* Rejected below. */ }
      requireValue(safe, key);
    }
  }
  requireValue(Array.isArray(d.footnotes), 'footnotes');
  const notes = new Set<string>();
  for (const n of d.footnotes) { requireValue(n && text(n.id) && text(n.text) && !notes.has(n.id), 'footnote'); notes.add(n.id); }
  requireValue(Array.isArray(d.transactions) && d.transactions.length <= 10000, 'transactions');
  const rows = new Set<string>();
  for (const r of d.transactions) {
    requireValue(r && text(r.rawSourceId) && !rows.has(r.rawSourceId), 'duplicate transaction'); rows.add(r.rawSourceId);
    requireValue(r.security && nullableText(r.security.title) && ['derivative','non_derivative','unknown'].includes(r.security.category), 'security');
    validateIdentity(r.security.identity, ['security','unknown']);
    requireValue(nullableText(r.transactionCode) && ['A','D','unknown'].includes(r.acquisitionDisposition) && ['direct','indirect','unknown'].includes(r.ownershipType), 'transaction semantics');
    requireValue(nullableText(r.currency) && nullableText(r.ownershipNature) && evidence(r.evidence), 'transaction evidence');
    requireValue(r.transactionDate === null || (validFilingDate(r.transactionDate) && Date.parse(r.transactionDate) <= Date.parse(d.dates.retrievedAt) && (!d.dates.filedAt || r.transactionDate.slice(0,10) <= d.dates.filedAt.slice(0,10))), 'transaction date');
    for (const k of ['shares','price','ownershipAfter'] as const) requireValue(r[k] === null || (typeof r[k] === 'number' && Number.isFinite(r[k]) && r[k]! >= 0 && r[k]! <= Number.MAX_SAFE_INTEGER), k);
    const a = r.ownerAttribution;
    requireValue(a && ['reported','unknown'].includes(a.status) && Array.isArray(a.references) && new Set(a.references).size === a.references.length && a.references.every(id => owners.has(id)) && evidence(a.evidence), 'owner attribution');
    requireValue(a.status === 'reported' ? a.references.length > 0 && a.evidence.length > 0 : a.references.length === 0, 'unsupported owner attribution');
    requireValue(Array.isArray(r.footnoteReferences) && r.footnoteReferences.every(f => f && text(f.field) && Array.isArray(f.ids) && f.ids.every(text)), 'footnote references');
  }
}
/** Completeness of reported source information, never investment confidence or a trade signal. */
export function assessForm4Source(d: Form4Source): Form4Assessment {
  validateForm4Source(d);
  const issues: string[] = [];
  let coverage = weakest(d.parseStatus,d.normalizationStatus);
  const add = (issue: string, level: DataStatus) => { issues.push(issue); coverage = weakest(coverage,level); };
  const resolved = (i: FilingIdentity) => resolveFilingIdentity(i,'assessment').status === 'resolved';
  if (!resolved(d.issuer) || !d.reportingOwners.length || d.reportingOwners.some(o => !resolved(o.identity))) add('unresolved_identity','UNKNOWN');
  if (!d.filers.length || d.filers.some(i => !resolved(i))) add('unresolved_filer','PARTIAL');
  if (!d.accessionNumber || !d.dates.filedAt || !d.provenance.sourceUrl || !d.provenance.filingUrl) add('incomplete_provenance','PARTIAL');
  if (!d.provenance.evidence.length || d.provenance.origin !== 'public') add('unverified_source','UNKNOWN');
  if (!d.issuerTicker) add('missing_issuer_ticker','PARTIAL');
  if (d.reportingOwners.some(o => !o.relationship.evidence.length || [o.relationship.director,o.relationship.officer,o.relationship.tenPercentOwner,o.relationship.other].includes(null))) add('partial_owner_relationship','PARTIAL');
  if (d.filingType === '4/A' && !d.amendment.previousFilingId) add('unlinked_amendment','PARTIAL');
  if (!d.transactions.length) add('no_transaction_rows','PARTIAL');
  const notes = new Set(d.footnotes.map(n => n.id));
  const rows = d.transactions.map(r => {
    const rowIssues: string[] = []; let rowCoverage: DataStatus = coverage;
    const mark = (issue: string, level: DataStatus) => { rowIssues.push(issue); rowCoverage = weakest(rowCoverage,level); };
    if (!r.evidence.length) mark('missing_row_evidence','UNKNOWN');
    if (!resolved(r.security.identity)) mark('unresolved_security','UNKNOWN');
    if (r.ownerAttribution.status === 'unknown') mark('unresolved_row_owner','UNKNOWN');
    if (r.acquisitionDisposition === 'unknown' || r.ownershipType === 'unknown' || r.security.category === 'unknown') mark('unknown_transaction_semantics','UNKNOWN');
    if (!r.transactionCode || !['P','S','V','A','D','F','I','M','C','E','H','O','X','G','L','W','Z','J','K','U'].includes(r.transactionCode)) mark('unknown_transaction_code','UNKNOWN');
    if ((r.transactionCode === 'P' && r.acquisitionDisposition === 'D') || (r.transactionCode === 'S' && r.acquisitionDisposition === 'A')) mark('conflicting_code_direction','UNKNOWN');
    if (r.price === null || r.shares === null || r.ownershipAfter === null || r.transactionDate === null || r.currency === null || r.security.title === null) mark('missing_transaction_fields','PARTIAL');
    if (r.footnoteReferences.some(f => f.ids.some(id => !notes.has(id)))) mark('missing_footnote','PARTIAL');
    return {rawSourceId:r.rawSourceId,coverage:rowCoverage,issues:rowIssues};
  });
  return {coverage:weakest(coverage,...rows.map(r => r.coverage)),issues,rows};
}
