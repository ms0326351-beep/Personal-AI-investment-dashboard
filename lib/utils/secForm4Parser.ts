import { SaxesParser } from 'saxes';
import type { FilingIdentity } from '../types/publicFilings';
import type { Form4Source, Form4Transaction } from '../types/secForm4';
import type { Form4XmlContext, Form4XmlResult } from '../types/secForm4Parser';
import { validFilingDate } from './publicFilingValidation';
import { validateForm4Source } from './secForm4';

interface XmlNode { name: string; path: string; text: string; attributes: Record<string, string>; children: XmlNode[] }
const MAX_XML_LENGTH = 2_000_000;
const PARSER_VERSION = 'form4-xml-v1';

/** Strict well-formed XML only; no DTDs, external entities, network or error recovery. */
function readXml(xml: string): XmlNode {
  if (typeof xml !== 'string' || !xml.trim() || xml.length > MAX_XML_LENGTH) throw new Error('invalid_xml_size');
  const parser = new SaxesParser({ xmlns: true });
  const stack: XmlNode[] = [];
  let root: XmlNode | undefined;
  let count = 0;
  parser.on('error', () => { throw new Error('malformed_xml'); });
  parser.on('doctype', () => { throw new Error('doctype_not_supported'); });
  parser.on('opentag', tag => {
    if (++count > 50_000 || stack.length >= 32) throw new Error('xml_complexity_limit');
    // SEC ownership XML is unnamespaced. Do not conflate foreign namespace fields.
    if (tag.uri) throw new Error('unsupported_xml_namespace');
    const parent = stack.at(-1);
    const ordinal = (parent?.children.filter(n => n.name === tag.local).length ?? 0) + 1;
    const node: XmlNode = { name: tag.local, path: `${parent?.path ?? ''}/${tag.local}[${ordinal}]`, text: '', attributes: {}, children: [] };
    for (const attribute of Object.values(tag.attributes)) {
      if (attribute.uri && attribute.prefix !== 'xmlns') throw new Error('unsupported_attribute_namespace');
      node.attributes[attribute.name] = attribute.value;
    }
    if (parent) parent.children.push(node); else root = node;
    stack.push(node);
  });
  const text = (value: string) => { const node = stack.at(-1); if (node) node.text += value; };
  parser.on('text', text);
  parser.on('cdata', text);
  parser.on('closetag', () => { stack.pop(); });
  parser.write(xml).close();
  if (!root || root.name !== 'ownershipDocument') throw new Error('unsupported_root');
  return root;
}

/** Maps XML into the Stage 1 contract without promoting parsed identity to verified identity. */
export function parseForm4Xml(xml: string, context: Form4XmlContext): Form4XmlResult {
  const result: Form4XmlResult = {
    status: 'unavailable', source: null, issues: [], rawFields: {}, transactionSemantics: {}, periodOfReport: null,
    dateOfOriginalSubmission: null, unsupported: { derivativeTransactions: 0, derivativeHoldings: 0, nonDerivativeHoldings: 0 },
  };
  const issue = (path: string, code: string) => { result.issues.push({ path, code }); };
  try {
    const root = readXml(xml);
    const child = (node: XmlNode | undefined, name: string): XmlNode | undefined => {
      const matches = node?.children.filter(c => c.name === name) ?? [];
      if (matches.length > 1) throw new Error(`duplicate_singleton:${node!.path}/${name}`);
      return matches[0];
    };
    const at = (node: XmlNode | undefined, path: string): XmlNode | undefined => path.split('/').reduce<XmlNode | undefined>((n, key) => child(n, key), node);
    const read = (node: XmlNode | undefined, path: string): string | null => {
      const n = at(node, path);
      const location = `${node?.path ?? '/missing'}/${path}`;
      if (n?.children.some(c => c.name !== 'footnoteId')) { issue(location, 'non_scalar_field'); return null; }
      const value = n?.text.trim() || null;
      result.rawFields[location] = value;
      if (value && value.length > 10000) { issue(location, 'field_too_long'); return null; }
      return value;
    };
    const date = (value: string | null, path: string): string | null => {
      if (value === null) return null;
      if (!validFilingDate(value) || Date.parse(value) > Date.parse(context.retrievedAt)) { issue(path, 'invalid_date'); return null; }
      return value;
    };
    const number = (node: XmlNode, path: string): number | null => {
      const raw = read(node, path);
      if (raw === null) { issue(`${node.path}/${path}`, 'missing_number'); return null; }
      if (!/^\d+(?:\.\d+)?$/.test(raw) || raw.replace('.', '').length > 15 || !Number.isFinite(Number(raw)) || Number(raw) > Number.MAX_SAFE_INTEGER) {
        issue(`${node.path}/${path}`, 'invalid_or_unsafe_number'); return null;
      }
      return Number(raw);
    };
    const boolean = (node: XmlNode | undefined, name: string): boolean | null => {
      const raw = read(node, name);
      if (raw === '1' || raw === 'true') return true;
      if (raw === '0' || raw === 'false') return false;
      issue(`${node?.path ?? '/missing'}/${name}`, raw === null ? 'missing_boolean' : 'invalid_boolean');
      return null;
    };
    const evidence = (node: XmlNode | undefined) => node ? [{ id: `${context.sourceIdentifier}:${node.path}`, locator: node.path,
      excerpt: JSON.stringify(Object.fromEntries(Object.entries(result.rawFields).filter(([path]) => path.startsWith(`${node.path}/`)))).slice(0,10000) }] : [];
    const identity = (node: XmlNode | undefined, nameField: string, cikField: string, kind: FilingIdentity['kind']): FilingIdentity => {
      const name = read(node, nameField);
      // Stage 1 requires identity.name: fail closed instead of inventing a person's name.
      if (!name) throw new Error(`missing_identity_name:${nameField}`);
      const cik = read(node, cikField);
      const valid = cik !== null && /^\d{1,10}$/.test(cik) && /[1-9]/.test(cik);
      if (!valid) issue(node?.path ?? '/', 'missing_or_invalid_cik');
      return { name, kind, identifier: valid ? { namespace: 'cik', value: cik } : null, verified: false, evidence: [] };
    };
    const filingType = read(root, 'documentType');
    if (filingType !== '4' && filingType !== '4/A') throw new Error('unsupported_document_type');
    if (!validFilingDate(context.retrievedAt) || !context.retrievedAt.includes('T')) throw new Error('invalid_retrieved_at');
    result.periodOfReport = date(read(root, 'periodOfReport'), '/periodOfReport');
    if (!result.periodOfReport) issue('/periodOfReport', 'missing_period_of_report');
    result.dateOfOriginalSubmission = date(read(root, 'dateOfOriginalSubmission'), '/dateOfOriginalSubmission');
    const filedAt = date(context.filedAt ?? null, '/envelope/filedAt');
    const publishedAt = date(context.publishedAt ?? null, '/envelope/publishedAt');
    if (!filedAt) issue('/envelope/filedAt', 'missing_filing_date');
    const issuerNode = child(root, 'issuer');
    const issuer = identity(issuerNode, 'issuerName', 'issuerCik', 'company');
    const owners = root.children.filter(n => n.name === 'reportingOwner').map((node, index) => {
      const relationship = child(node, 'reportingOwnerRelationship');
      return {
        reference: `owner-${index + 1}`,
        identity: identity(child(node, 'reportingOwnerId'), 'rptOwnerName', 'rptOwnerCik', 'unknown'),
        relationship: {
          director: boolean(relationship, 'isDirector'), officer: boolean(relationship, 'isOfficer'),
          tenPercentOwner: boolean(relationship, 'isTenPercentOwner'), other: boolean(relationship, 'isOther'),
          officerTitle: read(relationship, 'officerTitle'), otherText: read(relationship, 'otherText'), evidence: evidence(relationship),
        },
      };
    });
    if (!owners.length) issue('/reportingOwner', 'missing_reporting_owner');
    const notesNode = child(root, 'footnotes');
    const footnotes = (notesNode?.children.filter(n => n.name === 'footnote') ?? []).map(n => {
      if (!n.attributes.id || n.children.length || !n.text.trim()) throw new Error('invalid_footnote');
      return { id: n.attributes.id, text: n.text.trim() };
    });
    const table = child(root, 'nonDerivativeTable');
    const derivativeTable = child(root, 'derivativeTable');
    // TODO Stage 2 follow-up: Table II pricing/underlying terms and holding-only rows.
    // Explicit counts prevent a mixed filing from being presented as complete.
    result.unsupported = {
      derivativeTransactions: derivativeTable?.children.filter(n => n.name === 'derivativeTransaction').length ?? 0,
      derivativeHoldings: derivativeTable?.children.filter(n => n.name === 'derivativeHolding').length ?? 0,
      nonDerivativeHoldings: table?.children.filter(n => n.name === 'nonDerivativeHolding').length ?? 0,
    };
    for (const [key, count] of Object.entries(result.unsupported)) if (count) issue(`/${key}`, 'unsupported_rows');
    const transactions: Form4Transaction[] = (table?.children.filter(n => n.name === 'nonDerivativeTransaction') ?? []).map((node, index) => {
      const title = read(node, 'securityTitle/value');
      const code = read(node, 'transactionCoding/transactionCode');
      const equitySwapInvolved = boolean(child(node, 'transactionCoding'), 'equitySwapInvolved');
      const disposition = read(node, 'transactionAmounts/transactionAcquiredDisposedCode/value');
      const ownership = read(node, 'ownershipNature/directOrIndirectOwnership/value');
      let transactionDate = date(read(node, 'transactionDate/value'), `${node.path}/transactionDate`);
      if (transactionDate && filedAt && transactionDate.slice(0,10) > filedAt.slice(0,10)) {
        issue(node.path, 'transaction_after_filing'); transactionDate = null;
      }
      const footnoteReferences: Form4Transaction['footnoteReferences'] = [];
      let hasFootnote = false;
      const collect = (n: XmlNode) => {
        for (const c of n.children) {
          if (c.name === 'footnoteId') {
            hasFootnote = true;
            result.rawFields[`${c.path}/@id`] = c.attributes.id ?? null;
            if (!c.attributes.id) issue(c.path, 'missing_footnote_id');
            else { footnoteReferences.push({ field: n.path, ids: [c.attributes.id] }); if (!footnotes.some(f => f.id === c.attributes.id)) issue(c.path, 'unresolved_footnote'); }
          } else collect(c);
        }
      };
      collect(node);
      result.transactionSemantics[`non-derivative-${index + 1}`] = { equitySwapInvolved, hasFootnote };
      if (!title || !code || !transactionDate || !['A','D'].includes(disposition ?? '') || !['D','I'].includes(ownership ?? '')) issue(node.path, 'incomplete_transaction');
      if ((code === 'P' && disposition === 'D') || (code === 'S' && disposition === 'A')) issue(node.path, 'conflicting_code_direction');
      if (code && !['P','S','V','A','D','F','I','M','C','E','H','O','X','G','L','W','Z','J','K','U'].includes(code)) issue(node.path, 'unsupported_transaction_code');
      return {
        rawSourceId: `non-derivative-${index + 1}`, security: {
          title, category: 'non_derivative',
          identity: { name: title ?? 'UNKNOWN', kind: 'security', identifier: null, verified: false, evidence: [] },
        },
        transactionDate, transactionCode: code,
        shares: number(node, 'transactionAmounts/transactionShares/value'),
        price: number(node, 'transactionAmounts/transactionPricePerShare/value'), currency: null,
        ownershipAfter: number(node, 'postTransactionAmounts/sharesOwnedFollowingTransaction/value'),
        acquisitionDisposition: disposition === 'A' || disposition === 'D' ? disposition : 'unknown',
        ownershipType: ownership === 'D' ? 'direct' : ownership === 'I' ? 'indirect' : 'unknown',
        ownershipNature: read(node, 'ownershipNature/natureOfOwnership/value'),
        // Filing participation is not row-level ownership attribution, even in a single-owner filing.
        ownerAttribution: { references: [], status: 'unknown', evidence: [] },
        footnoteReferences, evidence: evidence(node),
      };
    });
    if (!transactions.length) issue('/nonDerivativeTable', 'no_supported_transactions');
    const source: Form4Source = {
      schemaVersion: 'form4-source-v1', form: 'FORM4', filingType, filingId: context.filingId,
      accessionNumber: context.accessionNumber ?? null,
      dates: { retrievedAt: context.retrievedAt, filedAt, publishedAt, periodEnd: null, asOfDate: null },
      issuer, issuerTicker: read(issuerNode, 'issuerTradingSymbol'), filers: [], reportingOwners: owners, transactions, footnotes,
      amendment: { kind: filingType === '4' ? 'original' : 'unknown', previousFilingId: null },
      provenance: { sourceAuthority: 'SEC', sourceIdentifier: context.sourceIdentifier, sourceUrl: context.sourceUrl ?? null,
        filingUrl: context.filingUrl ?? null, origin: context.origin, parserVersion: PARSER_VERSION, evidence: evidence(root) },
      parseStatus: result.issues.length ? 'PARTIAL' : 'KNOWN', normalizationStatus: 'UNKNOWN',
    };
    validateForm4Source(source);
    result.source = source;
    result.status = result.issues.length ? 'partial' : 'parsed';
  } catch (error) {
    issue('/', error instanceof Error ? error.message : 'unavailable');
  }
  return result;
}
