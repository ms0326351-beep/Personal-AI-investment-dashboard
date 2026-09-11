import { watchlist } from '@/lib/mock/data';
export interface WatchlistRepository { getSymbols(): Promise<string[]> }
export const mockWatchlistRepository: WatchlistRepository = { async getSymbols(){ return watchlist } };
export const watchlistRepository: WatchlistRepository = mockWatchlistRepository;
