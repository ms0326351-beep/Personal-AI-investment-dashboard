import type { Holding } from './index';
import type { DataStatus, ExposureConcentration, ExposureCoverage, ExposureDimension, ExposurePath } from './exposure';

export interface ExposurePosition {
  id: string;
  assetEntityId: string;
  assetType: 'stock' | 'etf' | 'cash' | 'other';
  /** Already converted into snapshot.baseCurrency by the caller; null means unpriced. */
  marketValue: number | null;
  valuationQuality: 'known' | 'estimated' | 'unknown';
}
export interface ExposurePortfolioSnapshot {
  portfolioId: string;
  version: string;
  baseCurrency: string;
  asOf: string;
  positions: ExposurePosition[];
}
export interface PortfolioExposureSummary {
  portfolioId: string;
  portfolioVersion: string;
  datasetVersion: string;
  asOf: string;
  baseCurrency: string;
  valuationStatus: DataStatus;
  totalMarketValue: number | null;
  positionWeights: { positionId: string; weight: number | null }[];
  dimensions: Record<ExposureDimension, {
    paths: ExposurePath[];
    coverage: ExposureCoverage;
    concentration?: ExposureConcentration;
  }>;
  truncated: boolean;
}
/** Explicit mapping avoids assuming a ticker is globally unique or inventing quotes/FX. */
export type LegacyExposureMapping = Record<Holding['id'], Omit<ExposurePosition, 'id'>>;
