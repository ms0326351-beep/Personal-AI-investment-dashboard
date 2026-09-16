import { NEWS_TOPICS } from '../data/newsTopics';
import type { MarketImpactAnalysis, NewsAIAnalysis } from '../types/newsAnalysis';

export const NEWS_EVENT_TYPES = ['earnings','monetary-policy','trade-policy','geopolitics','product','supply-chain','dividend','management-change','other'] as const;
export const IMPACT_DIRECTIONS = ['bullish','bearish','neutral','uncertain'] as const;
export const IMPACT_LEVELS = ['high','medium','low'] as const;
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every(s => typeof s === 'string');
const object = (v: unknown): v is Record<string,unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const member = (values: readonly string[], v: unknown) => typeof v === 'string' && values.includes(v);
const text = (v: unknown, max: number) => typeof v === 'string' && v.trim().length > 0 && [...v].length <= max;

export function isMarketImpact(v: unknown): v is MarketImpactAnalysis {
  return object(v) && strings(v.explicitlyMentionedSymbols) && strings(v.inferredSymbols) && strings(v.relatedPersonIds)
    && strings(v.relatedTopics) && v.relatedTopics.length<=3 && v.relatedTopics.every(t=>NEWS_TOPICS.includes(t as typeof NEWS_TOPICS[number]))
    && member(NEWS_EVENT_TYPES,v.eventType) && member(IMPACT_DIRECTIONS,v.impactDirection) && member(IMPACT_LEVELS,v.impactLevel)
    && text(v.conclusion,60) && text(v.reasoning,150);
}

/** Validate before rendering; malformed network responses must never crash a news card. */
export function isNewsAIResponse(v: unknown): v is NewsAIAnalysis {
  if (!object(v) || !['newsId','schemaVersion','modelVersion','disclaimer','analyzedAt'].every(k=>typeof v[k]==='string')) return false;
  if (v.status==='unavailable') return v.market===null && v.portfolio===null && typeof v.unavailableReason==='string';
  if (v.status!=='ok' || !isMarketImpact(v.market) || !object(v.portfolio)) return false;
  const p=v.portfolio;
  return member(['direct','indirect','none'],p.portfolioRelevance) && typeof p.portfolioConclusion==='string'
    && Array.isArray(p.affectedHoldings) && p.affectedHoldings.every(h=>object(h) && typeof h.symbol==='string' && typeof h.id==='string');
}
