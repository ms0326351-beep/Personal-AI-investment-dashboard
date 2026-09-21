import type { Holding } from './index';
import type { NewsInputBasis } from '../utils/newsAnalysisInput';

export type ImpactDirection = 'bullish' | 'bearish' | 'neutral' | 'uncertain';
export type ImpactLevel = 'high' | 'medium' | 'low';
export type NewsEventType = 'earnings' | 'monetary-policy' | 'trade-policy' | 'geopolitics' | 'product' | 'supply-chain' | 'dividend' | 'management-change' | 'other';
export type PortfolioRelevance = 'direct' | 'indirect' | 'none';
export type NewsAnalysisStatus = 'ok' | 'unavailable';
export type TimeHorizon = 'immediate' | 'short-term' | 'medium-term' | 'long-term';
export interface WatchFactor {
  name: string;
  type: 'market' | 'macro' | 'company' | 'industry' | 'policy' | 'commodity' | 'currency' | 'rate';
  reason: string;
}
export interface ImpactChainNode {
  stage: 'event' | 'macro' | 'industry' | 'security';
  label: string;
  explanation: string;
  basis: 'reported' | 'inferred';
}
/** General security analysis only. Account positions never enter the shared cache. */
export interface SecurityImpact {
  symbol: string;
  relationship: 'direct' | 'indirect';
  impactDirection: 'positive' | 'negative' | 'mixed' | 'uncertain';
  impactLevel: ImpactLevel;
  timeHorizon: TimeHorizon;
  reason: string;
  transmissionPath: string[];
  confidence: ImpactLevel;
  watchFactors: WatchFactor[];
  evidenceQuote: string;
  anchorSymbol: string;
  linkage: 'company' | 'supply-chain' | 'index-exposure' | 'macro';
}
export interface HoldingImpact extends SecurityImpact { name: string }
export interface DeepMarketImpact {
  eventSummary: string;
  eventImportance: ImpactLevel;
  eventHorizon: TimeHorizon;
  impactChain: ImpactChainNode[];
  securityImpacts: SecurityImpact[];
  watchFactors: WatchFactor[];
  baseCase: string;
  bullCase: string;
  bearCase: string;
  whatWouldChangeTheView: string;
  uncertainties: string[];
}

export interface MarketImpactAnalysis extends Partial<DeepMarketImpact> {
  explicitlyMentionedSymbols: string[];
  inferredSymbols: string[];
  relatedPersonIds: string[];
  relatedTopics: string[];
  eventType: NewsEventType;
  impactDirection: ImpactDirection;
  impactLevel: ImpactLevel;
  conclusion: string;
  reasoning: string;
}

export interface PortfolioImpactAnalysis {
  portfolioRelevance: PortfolioRelevance;
  affectedHoldings: Holding[];
  portfolioConclusion: string;
  holdingImpacts?: HoldingImpact[];
}

export interface NewsAIAnalysis {
  newsId: string;
  status: NewsAnalysisStatus;
  schemaVersion: string;
  modelVersion: string;
  market: MarketImpactAnalysis | null;
  portfolio: PortfolioImpactAnalysis | null;
  disclaimer: string;
  analyzedAt: string;
  unavailableReason?: string;
  errorCode?: string;
  retryAt?: string;
  inputBasis?: NewsInputBasis;
}

/** Shared cache never contains a user's holdings or portfolio conclusion. */
export type CachedNewsAnalysis = Omit<NewsAIAnalysis, 'portfolio'>;
