import type { Confidence, DataStatus } from './exposure';

export const ACTIVITY_TYPES = ['disclosed_transaction','disclosed_holding','insider_transaction','institutional_holding','public_mention','research_opinion','planned_transaction'] as const;
export type ActivityType = typeof ACTIVITY_TYPES[number];
export type PublicRole = 'investor' | 'fund_manager' | 'executive' | 'insider' | 'analyst' | 'public_commentator' | 'policy_official';
export type ParticipantRole = 'subject' | 'filer' | 'reporting_owner' | 'manager' | 'beneficial_owner' | 'speaker' | 'author';
export interface Provenance {
  source: string;
  sourceType: 'legacy_registry' | 'fixture' | 'sec_form4' | 'sec_13f' | 'politician_disclosure' | 'institution_report' | 'news' | 'public_statement';
  sourceUrl: string | null;
  filingReference: string | null;
  reportedAt: string | null;
  filedAt: string | null;
  asOfDate: string | null;
  knownAt: string | null;
  lastVerifiedAt: string | null;
  evidence: { id: string; excerpt: string; locator: string | null }[];
  confidence: Confidence;
  coverage: DataStatus;
  verification: 'verified' | 'unverified';
  freshness: 'current' | 'stale' | 'unknown';
  origin: 'public' | 'legacy' | 'mock';
}
export interface TrackedEntity {
  id: string;
  name: string;
  entityType: 'person' | 'institution' | 'unresolved';
  roles: PublicRole[];
  avatar: string | null;
  description: string;
  roleLabel: string;
  organizationLabel: string | null;
  externalIds: { namespace: 'cik' | 'lei' | 'other'; value: string }[];
  lastUpdated: string | null;
  provenance: Provenance;
}
/** Membership/employment never implies personal ownership of an institution's assets. */
export interface PublicRelationship {
  id: string;
  sourceId: string;
  target: { kind: 'entity'; id: string } | { kind: 'security'; id: string; ticker: string; market: string | null };
  type: 'affiliation' | 'manager_of' | 'reported_holding' | 'mentions' | 'research_subject' | 'legacy_association';
  validFrom: string | null;
  validTo: string | null;
  provenance: Provenance;
}
export interface PublicQuantity {
  value: number | null;
  quality: 'reported' | 'calculated' | 'estimated' | 'unknown';
  unit: 'shares' | 'currency' | 'fraction';
  currency: string | null;
  /** Required for fraction: disclosed securities != all fund assets. */
  denominator: string | null;
}
interface ActivityBase {
  id: string;
  title: string;
  participants: { entityId: string; role: ParticipantRole }[];
  security: { id: string; ticker: string | null; company: string; market: string | null; shareClass: string | null };
  transactionDate: string | null;
  provenance: Provenance;
  /** Revision points to a prior activity; never counted as a second trade. */
  supersedesId: string | null;
  claim: 'FACT' | 'REPORTED' | 'INFERENCE' | 'OPINION' | 'UNKNOWN';
}
export type PublicActivity = ActivityBase & (
  | { kind: 'disclosed_transaction' | 'insider_transaction'; action: 'purchase' | 'sale' | 'grant' | 'exercise' | 'gift' | 'other' | 'unknown'; quantity: PublicQuantity | null; transactionCode: string | null }
  | { kind: 'disclosed_holding' | 'institutional_holding'; action: 'held'; quantity: PublicQuantity | null }
  | { kind: 'public_mention'; action: 'mentioned'; quantity: null }
  | { kind: 'research_opinion'; action: 'opinion'; quantity: null }
  | { kind: 'planned_transaction'; action: 'planned'; quantity: PublicQuantity | null }
);
export interface PublicIntelligenceDataset { version: 1; entities: TrackedEntity[]; relationships: PublicRelationship[]; activities: PublicActivity[] }
export interface FollowRecord { entityId: string; followedAt: string }
export interface FollowSnapshot { version: 1; records: FollowRecord[] }
