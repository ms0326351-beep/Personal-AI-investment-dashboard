import 'server-only';
import { createHash } from 'node:crypto';
import type { FilingDocument, FilingForm, FilingTimelineEntry, IdentityBinding, NormalizedFiling, PublicFilingProvider } from '../types/publicFilings';
import { normalizePublicFiling } from './publicFilingNormalization';
import { parseFilingDocument, validFilingDate } from '../utils/publicFilingValidation';

/** Supply a server-side parser/transport. No default network calls, credentials or scheduled ingestion. */
export function createFilingProvider(id: string, forms: readonly FilingForm[], load: (reference: string) => Promise<unknown>): PublicFilingProvider {
  return {id,forms,load};
}
export const createForm4Provider = (load: PublicFilingProvider['load']) => createFilingProvider('sec-form4',['FORM4'],load);
export const create13FProvider = (load: PublicFilingProvider['load']) => createFilingProvider('sec-13f',['13F'],load);

export interface FilingStore {
  /** Atomic insert-if-absent; persistent adapters must retain this uniqueness guarantee. */
  insert(id: string, record: { hash: string; filing: NormalizedFiling }): Promise<'inserted' | 'duplicate' | 'conflict'>;
  list(): Promise<NormalizedFiling[]>;
}
export function createMemoryFilingStore(): FilingStore {
  const records = new Map<string,{hash:string;filing:NormalizedFiling}>();
  return {
    async insert(id, record) {
      const prior = records.get(id);
      if (prior) return prior.hash === record.hash ? 'duplicate' : 'conflict';
      // Check inside atomic insertion, including previously orphaned amendments.
      const all = new Map(records); all.set(id,record);
      for (const [start] of all) {
        const seen = new Set<string>(); let cursor: string | null = start;
        while (cursor && all.has(cursor)) {
          if (seen.has(cursor)) return 'conflict'; seen.add(cursor);
          const filing: NormalizedFiling = all.get(cursor)!.filing;
          const previousId: string | null = filing.source.amendment.previousFilingId;
          const parentId: string | null = previousId ? `${filing.source.provider}:${previousId}` : null;
          const parent: NormalizedFiling | undefined = parentId ? all.get(parentId)?.filing : undefined;
          if (parent && (parent.source.form !== filing.source.form || Date.parse(parent.source.dates.filedAt ?? parent.knownAt) > Date.parse(filing.source.dates.filedAt ?? filing.knownAt))) return 'conflict';
          cursor = parentId;
        }
      }
      records.set(id,structuredClone(record)); return 'inserted';
    },
    async list() { return structuredClone([...records.values()].map(r=>r.filing)); },
  };
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  return JSON.stringify(value);
}
function fingerprint(document: FilingDocument) {
  // A later retrieval is an observation, not a different filing or an earlier knownAt.
  const copy = structuredClone(document);
  copy.dates.retrievedAt = '';
  return createHash('sha256').update(canonical(copy)).digest('hex');
}
export function createFilingIngestion(store: FilingStore, options: { now: () => string; maxAgeDays: number; bindings?: readonly IdentityBinding[] }) {
  return {
    async ingest(provider: PublicFilingProvider, reference: string) {
      let input: unknown;
      try { input = await provider.load(reference); }
      catch { return {status:'unavailable' as const,reason:'provider_unavailable'}; }
      let filing: NormalizedFiling;
      try {
        const d = parseFilingDocument(input);
        if (d.provider !== provider.id || !provider.forms.includes(d.form)) throw new Error('Provider mismatch');
        filing = normalizePublicFiling(d,{...options,now:options.now()});
      } catch { return {status:'rejected' as const,reason:'invalid_or_unsupported_filing'}; }
      try {
        const status = await store.insert(filing.id,{hash:fingerprint(filing.source),filing});
        return {status,filingId:filing.id};
      } catch { return {status:'unavailable' as const,reason:'storage_unavailable'}; }
    },
  };
}

/** Raw historical events remain immutable; amendments are additional events, never backdated overwrites. */
export async function filingTimeline(store: FilingStore, asKnownAt: string, entityId?: string): Promise<FilingTimelineEntry[]> {
  if (!validFilingDate(asKnownAt)) throw new Error('Invalid timeline cutoff');
  const cutoff = Date.parse(asKnownAt);
  const result: FilingTimelineEntry[] = [];
  for (const filing of await store.list()) {
    if (Date.parse(filing.knownAt) > cutoff) continue;
    if (entityId && !filing.participants.some(p=>p.entityId===entityId)) continue;
    for (const [type,date] of Object.entries({...filing.source.dates,knownAt:filing.knownAt})) {
      if (date) result.push({filingId:filing.id,activityId:null,type:type as keyof FilingDocument['dates'],date,basis:type === 'knownAt' || type === 'retrievedAt' ? 'system_observed' : 'reported',previousFilingId:null});
    }
    const activities = filing.dataset.activities.filter(a => !entityId || a.participants.some(p=>p.entityId===entityId));
    for (const a of activities) {
      for (const [type,date] of Object.entries(a.filing.dates)) {
        if (date) result.push({filingId:filing.id,activityId:a.id,type:type as keyof typeof a.filing.dates,date,basis:type === 'knownAt' || type === 'retrievedAt' ? 'system_observed' : 'reported',previousFilingId:null});
      }
    }
    if (filing.source.amendment.kind !== 'original') result.push({filingId:filing.id,activityId:null,type:'amendment',date:filing.knownAt,basis:'system_observed',previousFilingId:filing.source.amendment.previousFilingId});
  }
  return result.sort((a,b)=>Date.parse(a.date)-Date.parse(b.date) || a.filingId.localeCompare(b.filingId) || a.type.localeCompare(b.type));
}
