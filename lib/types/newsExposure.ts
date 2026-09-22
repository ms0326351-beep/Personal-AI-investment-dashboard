import type { NewsItem } from './index';
import type { Confidence, DataStatus, ExposureDataset, ExposureEvidence, EvidenceSource, ExposureRelationship } from './exposure';
import type { EtfLookThroughSummary, UnderlyingExposure } from './etfExposure';

export type TransmissionDirection = 'positive' | 'negative' | 'mixed' | 'uncertain';
export type TransmissionBasis = 'reported' | 'inferred' | 'unknown';
export const NEWS_RELATION_TYPES = ['company_to_company','company_to_industry','supplier_to_customer','customer_to_supplier',
  'technology_dependency','infrastructure_dependency','commodity_dependency','geographic_dependency','regulatory_dependency',
  'demand_driver','substitution','competition','complementary','ETF_holding','portfolio_holding'] as const;
export type NewsRelationType = typeof NEWS_RELATION_TYPES[number];
export const DEMAND_KINDS = ['emerging','future-infrastructure','enabling-technology','bottleneck-technology','replacement-cycle',
  'regulatory','demographic','energy','compute','automation','security'] as const;
export type DemandKind = typeof DEMAND_KINDS[number];
/** Reviewed catalog only; never populated from model-generated entity IDs or relations. */
export interface NewsEntityBinding { entityId: string; aliases: string[]; symbol?: string }
export interface NewsEventAnchor {
  entityId: string;
  /** Verbatim entity name/alias in the selected news excerpt, NOT a causal investment assertion. */
  mention: string;
  direction: TransmissionDirection;
  confidence: Confidence;
}
export interface NewsExposureEvent {
  news: NewsItem;
  /** Actual source observation time supplied by the caller, never backdated to publication. */
  observedAt: string;
  anchors: NewsEventAnchor[];
  scenario?: { condition: string; demandKind: DemandKind };
}
/** Enriches an existing Foundation edge. No parallel entity/relationship store.
 * Direction is an explicitly reviewed conditional sensitivity, never implied by an edge name.
 */
export interface TransmissionRule {
  relationshipId: string;
  traversal: 'forward' | 'reverse';
  relationshipType: NewsRelationType;
  sensitivity: 'same' | 'opposite' | 'mixed' | 'unknown';
  rationale: string;
  evidenceIds: string[];
  sourceIds: string[];
  confidence: Confidence;
  asOf: string;
  invalidationConditions: string[];
  scenario?: { condition: string; demandKind: DemandKind };
}
export interface NewsExposureCatalog {
  version: string;
  bindings: NewsEntityBinding[];
  rules: TransmissionRule[];
}
export interface TransmissionStep {
  source: string;
  target: string;
  relationshipType: NewsRelationType | 'news_mention' | 'issuer_identity';
  direction: TransmissionDirection;
  /** Relation basis and impact basis are separate: a reported dependency does not prove impact. */
  basis: TransmissionBasis;
  impactBasis: 'inferred' | 'unknown';
  confidence: Confidence;
  depth: number;
  asOf: string;
  evidence: ExposureEvidence[];
  evidenceSource: EvidenceSource[];
  evidenceSupported: boolean;
  invalidationConditions: string[];
  relationship?: ExposureRelationship;
  rule?: TransmissionRule;
  /** Local portfolio snapshot is the evidence for an ownership edge, not an external citation. */
  portfolioEvidence?: { portfolioId: string; version: string; positionId: string; assetEntityId: string; asOf: string };
}
export interface NewsExposurePath {
  id: string;
  entityIds: string[];
  steps: TransmissionStep[];
  targetEntityId: string;
  direction: TransmissionDirection;
  basis: TransmissionBasis;
  impactBasis: 'inferred' | 'unknown';
  confidence: Confidence;
  depth: number;
  order: 'first_order' | 'second_order' | 'third_order_or_more';
  nature: 'direct' | 'indirect';
  scenarios: { condition: string; demandKind: DemandKind }[];
  evidenceCoverage: { supportedEdges: number; totalEdges: number; fraction: number };
}
export interface NewsHoldingConnection {
  pathId: string;
  /** Full existing 3B.2 ownership/issuer evidence. Join with path for News -> ... -> Portfolio. */
  ownership: UnderlyingExposure;
  /** Reverse ownership traversal back to the portfolio; arithmetic provenance stays in ownership. */
  ownershipSteps: TransmissionStep[];
  evidenceCoverage: { supportedEdges: number; totalEdges: number; fraction: number };
  hopCount: number;
  nature: 'direct' | 'indirect';
  hidden: boolean;
  direction: TransmissionDirection;
  confidence: Confidence;
  impactBasis: 'inferred' | 'unknown';
}
export interface NewsPortfolioIntelligence {
  newsId: string;
  asOf: string;
  foundationVersion: ExposureDataset['version'];
  catalogVersion: string;
  status: DataStatus;
  paths: NewsExposurePath[];
  connections: NewsHoldingConnection[];
  holdings: {
    positionId: string;
    status: DataStatus;
    direction: TransmissionDirection;
    confidence: Confidence;
    direct: boolean;
    indirect: boolean;
    hidden: boolean;
    pathIds: string[];
    /** Distinct owned slices, NOT predicted loss, impact magnitude or causal probability. */
    connectedPortfolioWeight: number | null;
  }[];
  hiddenConcentrations: {
    anchorEntityId: string;
    positionIds: string[];
    pathIds: string[];
    status: DataStatus;
    /** Financial value of uniquely connected slices, not thematic intensity or expected loss. */
    connectedPortfolioWeight: number | null;
    overlapping: true;
  }[];
  /** Reused company/industry/theme concentrations and unknown ownership portions, not summed paths. */
  /** Null on invalid input/repository failure: never substitute an invented empty portfolio. */
  portfolioExposure: EtfLookThroughSummary | null;
  gaps: { entityId?: string; relationshipId?: string; reason: string }[];
  truncated: boolean;
  disclaimer: string;
}
