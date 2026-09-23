import type { FilingIdentity, IdentityBinding, ResolvedFilingIdentity } from '../types/publicFilings';

export function identifierKey(identity: Pick<FilingIdentity, 'identifier'>): string | null {
  const identifier = identity.identifier;
  if (!identifier) return null;
  const value = identifier.value.trim().toUpperCase();
  switch (identifier.namespace) {
    case 'cik': return /^\d{1,10}$/.test(value) ? `cik:${value.padStart(10, '0')}` : null;
    case 'cusip': return /^[A-Z0-9*@#]{9}$/.test(value) ? `cusip:${value}` : null;
    case 'lei': return /^[A-Z0-9]{20}$/.test(value) ? `lei:${value}` : null;
    case 'isin': return /^[A-Z]{2}[A-Z0-9]{9}\d$/.test(value) ? `isin:${value}` : null;
    default: return null;
  }
}

export function resolveFilingIdentity(identity: FilingIdentity, scope: string, bindings: readonly IdentityBinding[] = []): ResolvedFilingIdentity {
  const key = identifierKey(identity);
  const candidates = bindings.filter(b => key && identifierKey(b) === key && b.kind === identity.kind);
  const confirmed = [...new Set(candidates.filter(b => b.verified && b.evidence.length && b.id).map(b => b.id))];
  const resolved = !!key && identity.verified && identity.evidence.some(e => e.trim()) && identity.kind !== 'unknown' && confirmed.length <= 1;
  return {
    id: resolved ? confirmed[0] ?? `filing-entity:${identity.kind}:${key}` : `unresolved:${scope}`,
    identity: structuredClone(identity), status: resolved ? 'resolved' : 'unknown', candidateIds: candidates.map(b => b.id),
  };
}
