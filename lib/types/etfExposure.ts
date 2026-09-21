import type { Confidence, DataStatus, ExposureDataset, ExposureKnowledge, ExposureNature, ExposureRelationship } from './exposure';
import type { PortfolioExposureSummary } from './portfolioExposure';

export interface EtfProvenance {
  sourceIds: string[];
  evidenceIds: string[];
  sourceDate: string;
  lastVerifiedAt: string;
  confidence: Confidence;
  evidenceType: 'reported' | 'calculated' | 'estimated' | 'inferred' | 'unknown';
  dataQuality: 'verified' | 'estimated' | 'unknown';
}
export interface EtfHolding extends EtfProvenance {
  id: string;
  underlyingAssetId: string | null;
  ticker: string | null;
  name: string;
  assetType: 'stock' | 'etf' | 'cash' | 'other' | 'unknown';
  weight: number | null;
  weightUnit: 'fraction' | 'percent';
  weightBasis: 'netAssets' | 'equitySleeve' | 'unknown';
  /** Required to accept a calculated input as known, in the same currency/date. */
  calculation?: { holdingMarketValue: number; fundNetAssetValue: number; currency: string; asOfDate: string };
}
export interface EtfHoldingsSnapshot extends EtfProvenance {
  id: string;
  etfAssetId: string;
  asOfDate: string;
  completeness: 'complete' | 'partial' | 'unknown';
  holdings: EtfHolding[];
}
export interface EtfDataset {
  version: string;
  snapshots: EtfHoldingsSnapshot[];
}
export interface EtfLookThroughOptions {
  dataset: EtfDataset;
  /** Defaults to portfolio.asOf: prevents publication/revision look-ahead. */
  knownAt?: string;
  maxAgeDays?: number;
  maxDepth?: number;
  maxNodesPerPosition?: number;
}
export interface EtfOwnershipStep {
  snapshotId: string;
  etfAssetId: string;
  asOfDate: string;
  provenance: EtfProvenance;
  holding: EtfHolding;
  normalizedWeight: number;
  /** Applied ownership fraction after a disclosed complete-snapshot rounding correction. */
  appliedWeight: number;
}
export interface UnderlyingExposure {
  id: string;
  positionId: string;
  assetEntityId: string;
  assetType: 'stock' | 'cash' | 'other';
  companyEntityId: string | null;
  issuerRelationship: ExposureRelationship | null;
  nature: ExposureNature;
  fractionOfPosition: number;
  portfolioWeight: number | null;
  confidence: Confidence;
  evidenceType: 'reported' | 'calculated';
  ownershipPath: EtfOwnershipStep[];
}
export interface EtfUnresolvedExposure {
  positionId: string;
  etfAssetId: string;
  snapshotId?: string;
  holdingId?: string;
  reason: 'missingSnapshot' | 'stale' | 'missingWeight' | 'unverified' | 'unsupportedBasis' | 'unknownAsset' | 'overweight' | 'remainder' | 'cycle' | 'limit';
  knowledge: ExposureKnowledge;
  /** Null when that individual holding's fraction cannot be known. */
  fractionOfPosition: number | null;
  ownershipPath: EtfOwnershipStep[];
}
export interface EtfLookThroughSummary {
  datasetVersion: string;
  asOfDate: string;
  knownAt: string;
  status: DataStatus;
  /** Null when portfolio valuation denominator is incomplete. */
  coveredPortfolioWeight: number | null;
  unknownPortfolioWeight: number | null;
  positions: { positionId: string; status: DataStatus; coveredFraction: number; unknownFraction: number }[];
  underlying: UnderlyingExposure[];
  unresolved: EtfUnresolvedExposure[];
  /** Snapshot copies retain provenance even for excluded/unknown weights. */
  selectedSnapshots: EtfHoldingsSnapshot[];
  roundingAdjustments: { snapshotId: string; reportedTotal: number; factor: number; tolerance: number; evidenceType: 'calculated' }[];
  companyConcentration: {
    status: DataStatus;
    coveredPortfolioWeight: number | null;
    buckets: { companyEntityId: string; direct: number; indirect: number; combined: number }[];
  };
  overlaps: {
    leftEtfAssetId: string;
    rightEtfAssetId: string;
    status: DataStatus;
    identityBasis: 'verifiedIssuerOrAsset';
    /** Sum(min(left underlying fraction, right underlying fraction)); lower bound if partial. */
    knownOverlap: number | null;
  }[];
  /** Existing Foundation engine applied to underlying positions, with unknown residuals preserved.
   * Join each path.positionId to underlying.id for the ordered Portfolio -> ETF -> asset steps.
   * Its nature describes the asset's economic relationship; underlying.nature describes ownership.
   */
  exposure: PortfolioExposureSummary;
  foundationVersion: ExposureDataset['version'];
}
