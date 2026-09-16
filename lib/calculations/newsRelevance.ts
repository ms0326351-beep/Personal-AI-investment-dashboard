import type { Holding } from '../types';
import type { MarketImpactAnalysis, PortfolioImpactAnalysis } from '../types/newsAnalysis';
import { isRelevantToUser, symbolRelation } from '../utils/relevance';

type ImpactInput = Pick<MarketImpactAnalysis, 'explicitlyMentionedSymbols' | 'inferredSymbols' | 'impactDirection' | 'impactLevel'>;

export function computeNewsPortfolioImpact(market: ImpactInput, holdings: Holding[], watchlist: string[]): PortfolioImpactAnalysis {
  const symbols = [...new Set([...market.explicitlyMentionedSymbols, ...market.inferredSymbols])];
  const affectedHoldings = holdings.filter(h => symbols.includes(h.symbol));
  const portfolioRelevance = affectedHoldings.length ? 'direct' : isRelevantToUser(symbols, holdings, watchlist) ? 'indirect' : 'none';
  const direction = {bullish:'偏多', bearish:'偏空', neutral:'中性', uncertain:'方向不確定'}[market.impactDirection];
  const level = {high:'高', medium:'中', low:'低'}[market.impactLevel];
  const matched = [...new Set(affectedHoldings.map(h => h.symbol))].join('、');
  const watched = symbols.filter(s => symbolRelation(s, holdings, watchlist) === '你關注').join('、');
  const portfolioConclusion = portfolioRelevance === 'direct'
    ? `你持有 ${matched}，與本則分析直接相關；AI 推論為${direction}、${level}程度的可能影響，仍需觀察。`
    : portfolioRelevance === 'indirect'
      ? `本則分析涉及你關注的 ${watched}，與觀察清單間接相關，未命中持股；AI 推論為${direction}、${level}程度的可能影響。`
      : '與你目前的持股／觀察清單無直接關聯。';
  return {portfolioRelevance, affectedHoldings, portfolioConclusion};
}
