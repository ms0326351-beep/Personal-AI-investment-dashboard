export type MarketCode = 'TW' | 'US';
export type Currency = 'TWD' | 'USD';
export interface MarketIndex { code: string; name: string; market: MarketCode; value: number; change: number; changePercent: number; updatedAt: string }
export interface Security { symbol: string; name: string; market: MarketCode; type: 'stock' | 'etf'; currency: Currency; price: number; change: number; changePercent: number; sector: string; dividendYield: number; updatedAt: string }
export interface Holding { id: string; symbol: string; shares: number; avgCost: number; buyDate: string }
export interface NewsItem { id: string; title: string; summary: string; source: string; publishedAt: string; relatedSymbols: string[] }
export interface MarketCommentary { date: string; headline: string; reasons: string[]; disclaimer: string }
export interface AIAnalysis { symbol: string; summary: string; bullFactors: string[]; bearFactors: string[]; riskAlerts: string[]; disclaimer: string }
export interface MarketEvent { date: string; title: string; market: string; importance: string }
export interface PricePoint { label: string; price: number }
