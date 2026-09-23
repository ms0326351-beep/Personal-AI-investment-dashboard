import type { PublicActivity, PublicIntelligenceDataset, ParticipantRole, Provenance } from './publicIntelligence';

export type FilingForm = 'FORM4' | '13F' | '13D' | '13G' | 'POLITICIAN' | 'INSTITUTIONAL' | 'OTHER';
export type FilingQuality = 'reported' | 'calculated' | 'estimated' | 'inferred' | 'unknown';
export type FilingFreshness = 'fresh' | 'stale' | 'partial' | 'unknown';
export interface FilingDates {
  eventDate: string | null;
  transactionDate: string | null;
  periodEnd: string | null;
  filedAt: string | null;
  publishedAt: string | null;
  knownAt: string;
  asOfDate: string | null;
  retrievedAt: string;
}
/** A verified identifier is evidence of identity, not evidence of ownership. */
export interface FilingIdentity {
  name: string;
  kind: 'person' | 'institution' | 'company' | 'security' | 'unknown';
  identifier: { namespace: 'cik' | 'cusip' | 'lei' | 'isin'; value: string } | null;
  verified: boolean;
  evidence: string[];
}
export interface FilingParticipant { identity: FilingIdentity; role: ParticipantRole }
export interface FilingSecurity {
  identity: FilingIdentity;
  issuer: FilingIdentity;
  ticker: string | null;
  shareClass: string | null;
  putCall: 'PUT' | 'CALL' | null;
}
export interface FilingRow {
  rawSourceId: string;
  security: FilingSecurity;
  eventDate: string | null;
  transactionDate: string | null;
  transactionCode: string | null;
  shares: number | null;
  shareUnit: 'shares' | 'principal' | 'unknown';
  price: number | null;
  currency: string | null;
  reportedValue: number | null;
  valueScale: 'units' | 'thousands' | 'unknown';
  ownershipAfter: number | null;
  ownershipType: 'direct' | 'indirect' | 'unknown';
  ownershipNature: string | null;
  investmentDiscretion: string | null;
  otherManagers: string[];
  evidence: Provenance['evidence'];
  quality: FilingQuality;
}
/** Parsed source contract; provider-specific XML/JSON extraction must preserve row IDs/footnotes. */
export interface FilingDocument {
  provider: string;
  form: FilingForm;
  filingId: string;
  rawSourceId: string;
  sourceUrl: string;
  sourceReference: string;
  origin: 'public' | 'mock';
  verified: boolean;
  dates: Omit<FilingDates, 'eventDate' | 'transactionDate' | 'knownAt'>;
  coverage: 'KNOWN' | 'PARTIAL' | 'UNKNOWN';
  /** Complete public table does NOT mean complete portfolio: confidential holdings may be absent. */
  publicTableComplete: boolean;
  confidentialOmissions: boolean | null;
  participants: FilingParticipant[];
  amendment: { kind: 'original' | 'restatement' | 'additional' | 'correction' | 'unknown'; previousFilingId: string | null };
  rows: FilingRow[];
}
export interface ResolvedFilingIdentity {
  id: string;
  identity: FilingIdentity;
  status: 'resolved' | 'unknown';
  candidateIds: string[];
}
export interface IdentityBinding {
  id: string;
  kind: FilingIdentity['kind'];
  identifier: NonNullable<FilingIdentity['identifier']>;
  verified: boolean;
  evidence: string[];
}
/** Extends, rather than replaces, the existing activity contract. */
export type FilingActivity = PublicActivity & {
  filing: {
    provider: string; form: FilingForm; filingId: string; rawSourceId: string;
    sourceReference: string; companyId: string; securityId: string;
    dates: FilingDates; price: number | null; currency: string | null;
    reportedValue: number | null; valueScale: FilingRow['valueScale']; value: number | null;
    ownershipAfter: number | null; ownershipType: FilingRow['ownershipType']; ownershipNature: string | null;
    shareUnit: FilingRow['shareUnit']; investmentDiscretion: string | null; otherManagers: string[];
    quality: FilingQuality; freshness: FilingFreshness;
    amendment: FilingDocument['amendment'];
  };
};
export interface NormalizedFiling {
  id: string;
  source: FilingDocument;
  identities: ResolvedFilingIdentity[];
  participants: {entityId: string; role: ParticipantRole}[];
  dataset: Omit<PublicIntelligenceDataset, 'activities'> & { activities: FilingActivity[] };
  freshness: FilingFreshness;
  freshnessPolicy: { evaluatedAt: string; maxAgeDays: number };
  coverage: 'KNOWN' | 'PARTIAL' | 'UNKNOWN';
  knownAt: string;
  issues: string[];
}
export interface PublicFilingProvider {
  id: string;
  forms: readonly FilingForm[];
  load(reference: string): Promise<unknown>;
}
export interface FilingTimelineEntry {
  filingId: string; activityId: string | null;
  type: keyof FilingDates | 'amendment'; date: string;
  basis: 'reported' | 'system_observed';
  previousFilingId: string | null;
}
