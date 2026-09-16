import type { Holding } from './index';

export type ImpactDirection = 'bullish' | 'bearish' | 'neutral' | 'uncertain';
export type ImpactLevel = 'high' | 'medium' | 'low';
export type NewsEventType = 'earnings' | 'monetary-policy' | 'trade-policy' | 'geopolitics' | 'product' | 'supply-chain' | 'dividend' | 'management-change' | 'other';
export type PortfolioRelevance = 'direct' | 'indirect' | 'none';
export type NewsAnalysisStatus = 'ok' | 'unavailable';

export interface MarketImpactAnalysis {
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
}

/** Shared cache never contains a user's holdings or portfolio conclusion. */
export type CachedNewsAnalysis = Omit<NewsAIAnalysis, 'portfolio'>;
