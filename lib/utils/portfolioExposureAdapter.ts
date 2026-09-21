import type { Holding } from '../types';
import type { ExposurePortfolioSnapshot, LegacyExposureMapping } from '../types/portfolioExposure';

/** Does not change shares, costs, P/L or the existing portfolio calculator. */
export function adaptLegacyPortfolio(
  holdings: Holding[],
  snapshot: Omit<ExposurePortfolioSnapshot, 'positions'>,
  mappings: LegacyExposureMapping,
): ExposurePortfolioSnapshot {
  return {...snapshot, positions: holdings.map(holding => {
    const mapping = mappings[holding.id];
    if (!mapping) throw new Error(`Missing exposure mapping for holding ${holding.id}`);
    return {id: holding.id, ...mapping};
  })};
}
