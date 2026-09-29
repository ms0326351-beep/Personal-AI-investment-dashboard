import type { Form4Source, Form4Transaction } from './secForm4';

/** Caller-supplied filing envelope, not inferred from signatures or periodOfReport. */
export interface Form4XmlContext {
  filingId: string;
  sourceIdentifier: string;
  retrievedAt: string;
  origin: 'public' | 'mock';
  accessionNumber?: string | null;
  filedAt?: string | null;
  publishedAt?: string | null;
  sourceUrl?: string | null;
  filingUrl?: string | null;
}
export interface Form4ParseIssue { path: string; code: string }
export interface Form4RowSemantics {
  equitySwapInvolved: boolean | null;
  /** Includes malformed references, which cannot be represented as a valid footnote ID. */
  hasFootnote: boolean;
}
/** Explicit, externally verified row-specific unit evidence. Never inferred from a title.
 * No live resolver is implemented in this stage; absence keeps value unavailable.
 */
export interface Form4ValueBasis {
  filingId: string;
  sourceIdentifier: string;
  rawSourceId: string;
  securityKind: 'share_based_equity' | 'debt' | 'unknown';
  quantityUnit: 'shares' | 'principal' | 'unknown';
  priceUnit: 'per_share' | 'aggregate' | 'unknown';
  verified: boolean;
  evidence: Form4Transaction['evidence'];
}
export interface Form4XmlResult {
  status: 'parsed' | 'partial' | 'unavailable';
  source: Form4Source | null;
  issues: Form4ParseIssue[];
  /** Exact decoded XML scalar values; no footnote text used as a numeric substitute. */
  rawFields: Record<string, string | null>;
  transactionSemantics: Record<string, Form4RowSemantics>;
  /** SEC date of earliest reportable transaction; never a holdings period end. */
  periodOfReport: string | null;
  dateOfOriginalSubmission: string | null;
  unsupported: { derivativeTransactions: number; derivativeHoldings: number; nonDerivativeHoldings: number };
}
export type Form4NormalizedTransactionType =
  | 'PURCHASE' | 'SALE' | 'GRANT_AWARD_OR_ACQUISITION'
  | 'EXERCISE_OR_CONVERSION' | 'EXERCISE' | 'CONVERSION'
  | 'EXERCISE_PRICE_OR_TAX_PAYMENT' | 'GIFT' | 'OTHER' | 'UNKNOWN';
export interface Form4PositionRow {
  rawSourceId: string;
  transactionCode: string | null;
  normalizedType: Form4NormalizedTransactionType;
  action: 'BUY' | 'SELL' | 'OTHER' | 'UNKNOWN';
  /** P/S do not distinguish open-market from private transactions. */
  marketVenue: 'unknown';
  equitySwapInvolved: boolean | null;
  shares: number | null;
  price: number | null;
  transactionDate: string | null;
  holdingsAfter: number | null;
  ownershipType: Form4Transaction['ownershipType'];
  ownershipNature: string | null;
  /** Indicative arithmetic, never asserted to be cash paid, net flow or an exact cost basis. */
  transactionValue: { amount: string; currency: string | null; basis: 'shares_times_reported_price'; quality: 'calculated'; basisEvidence: Form4Transaction['evidence'] } | null;
  ownerAttribution: Form4Transaction['ownerAttribution'];
  evidence: Form4Transaction['evidence'];
  issues: string[];
}
