import { ENTITY_KINDS, EXPOSURE_DIMENSIONS, RELATIONSHIP_TYPES } from '../types/exposure';
import type { ExposureDataset, ExposureDimension, ExposureEntity } from '../types/exposure';
import type { ExposurePortfolioSnapshot } from '../types/portfolioExposure';

export const dimensionKinds: Record<ExposureDimension, ExposureEntity['kind'][]> = {
  sector:['Sector'], industry:['Industry'], geographic:['Country'], currency:['Currency'],
  commodity:['Commodity'], interestRate:['MacroFactor'], policy:['Policy'],
  technology:['Technology','EmergingTechnology'], theme:['Theme'],
};
function requireValid(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`Invalid exposure data: ${message}`);
}
const nonempty = (s: string) => typeof s === 'string' && s.trim().length > 0;
/** Stable semantics independent of JSON property order and evidence-array order. */
export function relationshipSignature(edge: ExposureDataset['relationships'][number]): string {
  const {id:_,...fields}=edge;
  return JSON.stringify(Object.entries(fields).sort(([a],[b])=>a.localeCompare(b)).map(([key,value])=>[
    key,Array.isArray(value)?[...new Set(value)].sort():value && typeof value==='object'?Object.entries(value).sort(([a],[b])=>a.localeCompare(b)):value,
  ]));
}
export const validDate = (s: string) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(s) && Number.isFinite(Date.parse(s));
function uniqueIds(items: {id:string}[], kind:string) {
  const ids = new Set<string>();
  for (const item of items) {
    requireValid(nonempty(item.id) && !ids.has(item.id), `${kind} ID`);
    ids.add(item.id);
  }
  return ids;
}
/** Typed repository boundary; reject inconsistent datasets instead of inventing relationships. */
export function validateExposureDataset(dataset: ExposureDataset): void {
  requireValid(nonempty(dataset.version), 'dataset version');
  const entities=uniqueIds(dataset.entities,'entity');
  const sources=uniqueIds(dataset.sources,'source');
  const evidence=uniqueIds(dataset.evidence,'evidence');
  for (const entity of dataset.entities) requireValid(ENTITY_KINDS.includes(entity.kind) && nonempty(entity.name),'entity');
  for (const source of dataset.sources) {
    let url: URL;
    try { url=new URL(source.url); } catch { throw new Error('Invalid exposure data: source URL'); }
    requireValid(['https:','http:'].includes(url.protocol) && !url.username && !url.password,'source URL');
    requireValid(nonempty(source.title) && validDate(source.retrievedAt) && (!source.publishedAt || validDate(source.publishedAt)),'source metadata');
  }
  for (const item of dataset.evidence) requireValid(sources.has(item.sourceId) && nonempty(item.excerpt) && validDate(item.observedAt),'evidence');
  const levels=['low','medium','high','unknown'];
  const seen=new Map<string,string>();
  for (const edge of dataset.relationships) {
    const serialized=relationshipSignature(edge);
    requireValid(nonempty(edge.id) && (!seen.has(edge.id) || seen.get(edge.id)===serialized),'conflicting relationship ID');
    seen.set(edge.id,serialized);
    requireValid(entities.has(edge.sourceEntityId) && entities.has(edge.targetEntityId),'relationship endpoint');
    requireValid(RELATIONSHIP_TYPES.includes(edge.type) && ['DIRECT','INDIRECT'].includes(edge.nature),'relationship type/nature');
    requireValid(levels.includes(edge.strength) && levels.includes(edge.confidence),'strength/confidence');
    requireValid(['FACT','REPORTED','INFERRED','HYPOTHESIS','SPECULATIVE'].includes(edge.claim),'claim');
    requireValid(edge.nature!=='INDIRECT' || !['FACT','REPORTED'].includes(edge.claim),'indirect factual claim');
    requireValid(nonempty(edge.rationale) && edge.invalidationConditions.every(nonempty),'rationale/invalidation');
    requireValid(edge.evidenceIds.every(id=>evidence.has(id)) && edge.counterEvidenceIds.every(id=>evidence.has(id)) && edge.sourceIds.every(id=>sources.has(id)),'evidence reference');
    requireValid(edge.evidenceIds.every(id=>edge.sourceIds.includes(dataset.evidence.find(e=>e.id===id)!.sourceId)),'evidence source mismatch');
    requireValid(validDate(edge.updatedAt) && (!edge.validFrom || validDate(edge.validFrom)) && (!edge.validTo || validDate(edge.validTo)),'relationship dates');
    requireValid(!edge.validFrom || !edge.validTo || Date.parse(edge.validFrom)<Date.parse(edge.validTo),'validity interval');
    if (edge.dimension) requireValid(EXPOSURE_DIMENSIONS.includes(edge.dimension) && dimensionKinds[edge.dimension].includes(dataset.entities.find(e=>e.id===edge.targetEntityId)!.kind),'dimension target');
    if (edge.measurement) {
      const m=edge.measurement;
      requireValid(['positionAllocation','revenueShare'].includes(m.basis) && ['known','estimated'].includes(m.quality) && Number.isFinite(m.fraction) && m.fraction>=0 && m.fraction<=1 && validDate(m.asOf),'measurement');
      requireValid(m.basis!=='positionAllocation' || (edge.nature==='DIRECT' && !!edge.dimension && dataset.entities.find(e=>e.id===edge.sourceEntityId)!.kind==='Asset'),'allocation scope');
    }
  }
}
export function validateExposurePortfolio(snapshot: ExposurePortfolioSnapshot): void {
  requireValid(nonempty(snapshot.portfolioId) && nonempty(snapshot.version) && nonempty(snapshot.baseCurrency) && validDate(snapshot.asOf),'portfolio metadata');
  uniqueIds(snapshot.positions,'position');
  for (const p of snapshot.positions) {
    requireValid(nonempty(p.assetEntityId) && ['stock','etf','cash','other'].includes(p.assetType),'position asset');
    requireValid(['known','estimated','unknown'].includes(p.valuationQuality),'valuation quality');
    requireValid(p.marketValue===null || (Number.isFinite(p.marketValue) && p.marketValue>=0),'non-negative valuation');
    requireValid(p.valuationQuality!=='known' || p.marketValue!==null,'known valuation missing');
  }
}
