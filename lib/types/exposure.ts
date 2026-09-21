/** Independent of news/AI schemas. Fractions are 0..1, never implied probabilities. */
export const ENTITY_KINDS = ['Asset','Company','Sector','Industry','SubIndustry','Theme','Technology','Commodity','Country','Currency','MacroFactor','Policy','FutureDemand','EmergingTechnology','WeakSignal','Bottleneck','CapacityConstraint','DemandDriver'] as const;
export type EntityKind = typeof ENTITY_KINDS[number];
export const RELATIONSHIP_TYPES = ['SUPPLIES','CUSTOMER_OF','DEPENDS_ON','COMPETES_WITH','EXPOSED_TO','BENEFITS_FROM','HURT_BY','ENABLED_BY','CONSTRAINED_BY','PART_OF','ISSUED_BY'] as const;
export type RelationshipType = typeof RELATIONSHIP_TYPES[number];
export const EXPOSURE_DIMENSIONS = ['sector','industry','geographic','currency','commodity','interestRate','policy','technology','theme'] as const;
export type ExposureDimension = typeof EXPOSURE_DIMENSIONS[number];
export type ClaimKind = 'FACT' | 'REPORTED' | 'INFERRED' | 'HYPOTHESIS' | 'SPECULATIVE';
export type Confidence = 'low' | 'medium' | 'high' | 'unknown';
export type ExposureNature = 'DIRECT' | 'INDIRECT';
export type DataStatus = 'KNOWN' | 'PARTIAL' | 'UNKNOWN';
export type ExposureKnowledge = 'KNOWN_QUANTITATIVE' | 'ESTIMATED' | 'QUALITATIVE' | 'UNKNOWN';
export interface ExposureEntity {
  id: string;
  kind: EntityKind;
  name: string;
}
export interface EvidenceSource {
  id: string;
  title: string;
  url: string;
  retrievedAt: string;
  publishedAt?: string;
}
export interface ExposureEvidence {
  id: string;
  sourceId: string;
  excerpt: string;
  observedAt: string;
}
export interface ExposureRelationship {
  id: string;
  sourceEntityId: string;
  targetEntityId: string;
  type: RelationshipType;
  nature: ExposureNature;
  dimension?: ExposureDimension;
  strength: 'low' | 'medium' | 'high' | 'unknown';
  confidence: Confidence;
  claim: ClaimKind;
  rationale: string;
  evidenceIds: string[];
  sourceIds: string[];
  counterEvidenceIds: string[];
  invalidationConditions: string[];
  updatedAt: string;
  validFrom?: string;
  validTo?: string;
  /** Revenue share is never substituted for allocation, strength or confidence. */
  measurement?: {
    basis: 'positionAllocation' | 'revenueShare';
    quality: 'known' | 'estimated';
    fraction: number;
    asOf: string;
  };
}
export interface ExposureDataset {
  version: string;
  entities: ExposureEntity[];
  relationships: ExposureRelationship[];
  evidence: ExposureEvidence[];
  sources: EvidenceSource[];
}
export interface ExposurePath {
  positionId: string;
  targetEntityId: string;
  dimension: ExposureDimension;
  entityIds: string[];
  relationshipIds: string[];
  /** Ordered snapshots preserve each edge's provenance without reconstructing from flattened IDs. */
  steps: { relationship: ExposureRelationship; evidenceSupported: boolean }[];
  depth: number;
  nature: ExposureNature;
  /** Multi-hop/indirect paths can never be promoted to FACT/REPORTED. */
  claim: ClaimKind;
  strength: ExposureRelationship['strength'];
  confidence: Confidence;
  knowledge: ExposureKnowledge;
  evidenceIds: string[];
  sourceIds: string[];
  counterEvidenceIds: string[];
  invalidationConditions: string[];
  evidenceCoverage: { supportedEdges: number; totalEdges: number; fraction: number };
  /** All measurements retain their original basis; never multiplied along paths. */
  measurements: { relationshipId: string; measurement: NonNullable<ExposureRelationship['measurement']> }[];
}
export interface ExposureCoverage {
  /** KNOWN means every position has a supported matching path, NOT a complete risk census. */
  status: DataStatus;
  coveredPositions: number;
  totalPositions: number;
  /** Coverage of known position values, NOT exposure intensity. Null without a full denominator. */
  portfolioWeight: number | null;
  unknownPositionIds: string[];
}
export interface ExposureConcentration {
  status: DataStatus;
  /** Only evidenced, direct positionAllocation measurements qualify. */
  buckets: { entityId: string; portfolioWeight: number }[];
  coveredPortfolioWeight: number | null;
  coverageBasis: 'EXACT_ALLOCATION' | 'LOWER_BOUND_UNION';
  /** Themes may overlap and are not an additive asset allocation. */
  overlapping: boolean;
}
