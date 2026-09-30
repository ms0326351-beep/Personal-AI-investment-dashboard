import 'server-only';
import { SaxesParser } from 'saxes';
import { SecTransportError, type SecForm4Metadata, type SecResolvedXmlEnvelope } from '../types/secTransport';
import { secAccessionDirectoryUrl, secDocumentUrl, secFilingKey, validateSecMetadata } from '../utils/secEndpoints';

type ReadDocument = (url: string, kind: 'json' | 'ownershipCandidate') => Promise<string>;
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Validate the index before fetching any listed file. Never use response-provided URLs. */
function candidates(body: string, directoryUrl: string): string[] {
  let value: unknown;
  try { value = JSON.parse(body); } catch { throw new SecTransportError('INVALID_RESPONSE'); }
  if (!record(value) || !record(value.directory) || !Array.isArray(value.directory.item) || value.directory.item.length > 1000) {
    throw new SecTransportError('INVALID_RESPONSE');
  }
  const d = value.directory;
  if (d.name !== undefined && d.name !== new URL(directoryUrl).pathname.replace(/\/$/, '')) {
    throw new SecTransportError('INVALID_RESPONSE');
  }
  const names = new Set<string>();
  for (const item of value.directory.item) {
    if (!record(item) || typeof item.name !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,239}$/.test(item.name) || item.name.includes('..')) {
      throw new SecTransportError('INVALID_DOCUMENT');
    }
    if (item.name.endsWith('.xml') && !/^(?:index|filings|directory)\.xml$/i.test(item.name)) names.add(item.name);
  }
  return [...names].sort();
}

/** Well-formed XML only; no DTD/entity expansion or HTML, bounded depth/node count. */
function isOwnershipXml(xml: string): boolean {
  const parser = new SaxesParser({ xmlns: true });
  let root: string | null = null, depth = 0, nodes = 0, invalid = false;
  parser.on('doctype', () => { throw new Error('DTD forbidden'); });
  parser.on('error', () => { invalid = true; });
  parser.on('opentag', tag => {
    if (++nodes > 100000 || ++depth > 128) throw new Error('XML limits');
    if (root === null) root = tag.local;
  });
  parser.on('closetag', () => { depth--; });
  try { parser.write(xml).close(); } catch { return false; }
  return !invalid && root === 'ownershipDocument' && depth === 0;
}

/** Internal transport seam: read must enforce the existing timeout/rate/body/host policy. */
export async function resolveOwnershipXmlDocument(input: SecForm4Metadata, read: ReadDocument,
  now: () => number): Promise<SecResolvedXmlEnvelope> {
  const metadata = validateSecMetadata(input);
  if (Date.parse(metadata.filingDate) > now()) throw new SecTransportError('INVALID_DOCUMENT');
  const directoryUrl = secAccessionDirectoryUrl(metadata.cik, metadata.accessionNumber);
  const indexUrl = `${directoryUrl}index.json`;
  const names = candidates(await read(indexUrl, 'json'), directoryUrl);
  const hint = metadata.primaryDocument.split('/').at(-1)!;
  const inspect = async (name: string): Promise<SecResolvedXmlEnvelope | null> => {
    // Failed/oversized retrieval cannot establish uniqueness among other candidates.
    const rawXml = await read(`${directoryUrl}${name}`, 'ownershipCandidate');
    if (!isOwnershipXml(rawXml)) return null;
    return { ...metadata, source: 'SEC', filingKey: secFilingKey(metadata.accessionNumber),
      presentationUrl: secDocumentUrl(metadata), sourceUrl: `${directoryUrl}${name}`, indexUrl,
      resolvedDocument: name, resolutionMethod: name === hint ? 'index_primary_basename' : 'index_unique_ownership',
      rawXml, retrievedAt: new Date(now()).toISOString() };
  };
  if (names.includes(hint)) {
    const preferred = await inspect(hint);
    if (preferred) return preferred;
  }
  const others = names.filter(name => name !== hint);
  // Bound discovery; never claim uniqueness after inspecting only a truncated list.
  if (others.length > 5) throw new SecTransportError('RESOLUTION_LIMIT_EXCEEDED');
  let found: SecResolvedXmlEnvelope | null = null;
  for (const name of others) {
    const result = await inspect(name);
    if (!result) continue;
    if (found) throw new SecTransportError('AMBIGUOUS_OWNERSHIP_DOCUMENT');
    found = result;
  }
  if (!found) throw new SecTransportError('OWNERSHIP_DOCUMENT_NOT_FOUND');
  return found;
}
