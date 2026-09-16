import 'server-only';
import { cache } from 'react';
import { connection } from 'next/server';
import type { NewsItem, MarketEvent } from '@/lib/types';
import { news, events } from '@/lib/mock/data';
import { dayTimeline } from '@/lib/mock/people';
import type { DayTimelineEntry } from '@/lib/types/people';
import { fetchRealNews, type SourceFetchResult } from './news/realNewsProvider';
import { selectNewsPool } from './news/selectNewsPool';

export interface NewsService {
  getNews(symbol?: string): Promise<NewsItem[]>;
  getEvents(): Promise<MarketEvent[]>;
  getDayTimeline(): Promise<DayTimelineEntry[]>;
  /** Per-source fetch success/failure from the last real-news fetch — for diagnostics, not shown in the main UI. */
  getNewsDiagnostics(): Promise<SourceFetchResult[]>;
}

const fallbackReason = '即時新聞來源暫時無法使用，顯示模擬備援';
const mockNewsWithOrigin: NewsItem[] = news.map(n => ({ ...n, origin: 'mock', fallbackReason }));

export const mockNewsService: NewsService = {
  async getNews(symbol) { return symbol ? mockNewsWithOrigin.filter(n => n.relatedSymbols.includes(symbol)) : mockNewsWithOrigin; },
  async getEvents() { return events; },
  async getDayTimeline() { return [...dayTimeline].sort((a, b) => a.time.localeCompare(b.time)); },
  async getNewsDiagnostics() { return []; },
};

const realNews = cache(() => fetchRealNews());

export const newsService: NewsService = {
  async getNews(symbol) {
    await connection();
    const { items } = await realNews();
    const pool = selectNewsPool(items, mockNewsWithOrigin);
    return symbol ? pool.filter(n => n.relatedSymbols.includes(symbol)) : pool;
  },
  async getEvents() { return events; },
  async getDayTimeline() { return [...dayTimeline].sort((a, b) => a.time.localeCompare(b.time)); },
  async getNewsDiagnostics() {
    await connection();
    return (await realNews()).diagnostics;
  },
};
