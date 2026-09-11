import type { NewsItem, MarketEvent } from '@/lib/types';
import { news, events } from '@/lib/mock/data';
import { dayTimeline } from '@/lib/mock/people';
import type { DayTimelineEntry } from '@/lib/types/people';
export interface NewsService { getNews(symbol?: string): Promise<NewsItem[]>; getEvents(): Promise<MarketEvent[]>; getDayTimeline(): Promise<DayTimelineEntry[]> }
export const mockNewsService: NewsService = {async getNews(symbol){return symbol ? news.filter(n=>n.relatedSymbols.includes(symbol)):news},async getEvents(){return events},async getDayTimeline(){return [...dayTimeline].sort((a,b)=>a.time.localeCompare(b.time))}};
export const newsService: NewsService = mockNewsService;
