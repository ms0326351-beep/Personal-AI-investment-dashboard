import type { Holding } from '@/lib/types';
import { holdings } from '@/lib/mock/data';
export interface PortfolioRepository { getHoldings(): Promise<Holding[]> }
export const mockPortfolioRepository: PortfolioRepository = { async getHoldings(){ return holdings } };
export const portfolioRepository: PortfolioRepository = mockPortfolioRepository;
