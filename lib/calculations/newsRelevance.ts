import type { Holding } from '../types';
import type { MarketImpactAnalysis, PortfolioImpactAnalysis } from '../types/newsAnalysis';
import { isRelevantToUser, symbolRelation } from '../utils/relevance';
import { newsSecurityContext } from '../data/newsSecurityContext';

type ImpactInput = Pick<MarketImpactAnalysis, 'explicitlyMentionedSymbols' | 'inferredSymbols' | 'impactDirection' | 'impactLevel' | 'securityImpacts'>;

export function computeNewsPortfolioImpact(market: ImpactInput, holdings: Holding[], watchlist: string[]): PortfolioImpactAnalysis {
  if(market.securityImpacts) {
    // Evidence was constrained at the provider/cache boundary; only actual positions are selected here.
    const relevant=market.securityImpacts.filter(s=>s.confidence!=='low');
    const holdingImpacts=relevant.filter(s=>holdings.some(h=>h.symbol===s.symbol))
      .map(s=>({...s,name:newsSecurityContext[s.symbol]?.name ?? s.symbol}));
    const affectedHoldings=holdings.filter(h=>holdingImpacts.some(s=>s.symbol===h.symbol));
    const watched=relevant.filter(s=>watchlist.includes(s.symbol));
    const portfolioRelevance=holdingImpacts.some(s=>s.relationship==='direct')?'direct':holdingImpacts.length || watched.length?'indirect':'none';
    const portfolioConclusion=holdingImpacts.length
      ? `本事件與 ${holdingImpacts.map(s=>s.symbol).join('、')} 有具體傳導關聯；以下為可能的事件影響，非價格預測。`
      : watched.length ? `與觀察清單 ${watched.map(s=>s.symbol).join('、')} 有關，目前持股未有足夠關聯依據。`
      : '目前沒有足夠依據連結到你的持股／觀察清單；不代表確定沒有影響。';
    return {portfolioRelevance,affectedHoldings,portfolioConclusion,holdingImpacts};
  }
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
