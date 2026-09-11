import type { PricePoint } from './index';
export interface MarketSource { source?: 'yahoo' | 'mock'; fallbackReason?: string }
export interface PriceHistory extends MarketSource { points: PricePoint[]; updatedAt: string }
