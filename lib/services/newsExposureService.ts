import type { NewsItem } from '../types';
import type { MarketImpactAnalysis } from '../types/newsAnalysis';
import type { ExposurePortfolioSnapshot } from '../types/portfolioExposure';
import type { NewsExposureCatalog, NewsExposureEvent } from '../types/newsExposure';
import type { ExposureRepository } from './exposureRepository';
import { calculateNewsPortfolioIntelligence, unavailableNewsPortfolioIntelligence } from '../calculations/newsExposure';
import { selectNewsAnalysisInput } from '../utils/newsAnalysisInput';
import { matchAliasesInText } from '../utils/textMatch';
import { isSecurityImpact } from '../utils/deepNewsAnalysis';
import { validateNewsExposureCatalog } from '../utils/newsExposureValidation';

/** Existing Phase 3A results are optional direction hints, always inferred.
 * Only literal news mentions in a reviewed binding catalog become graph anchors.
 * Inferred symbols, generated paths, and model text never become Foundation edges.
 */
export function createNewsExposureEvent(news:NewsItem,catalog:NewsExposureCatalog,observedAt:string,market?:MarketImpactAnalysis):NewsExposureEvent {
  const input=selectNewsAnalysisInput(news), text=input?`${input.item.title}\n${input.item.summary}`:'';
  const anchors=catalog.bindings.flatMap(binding=>{
    const mention=binding.aliases.find(alias=>matchAliasesInText(text,{entity:[alias]}).length>0);
    if(!mention) return [];
    const assessment=binding.symbol?market?.securityImpacts?.find(s=>isSecurityImpact(s) && s.symbol===binding.symbol):undefined;
    return [{entityId:binding.entityId,mention,direction:assessment?.impactDirection ?? 'uncertain' as const,confidence:assessment?.confidence ?? 'medium' as const}];
  });
  return {news:structuredClone(news),observedAt,anchors};
}

/** Opt-in local service using the existing repository and exposure engines.
 * No network, model calls, shared portfolio cache, RSS changes or private-data transmission.
 */
export function createNewsExposureService(repository:ExposureRepository,catalog:NewsExposureCatalog) {
  const reviewed=structuredClone(catalog);
  return {
    async analyze(news:NewsItem,portfolio:ExposurePortfolioSnapshot,options:NonNullable<Parameters<typeof calculateNewsPortfolioIntelligence>[4]> & {newsObservedAt:string},market?:MarketImpactAnalysis) {
      try {
      const foundation=await repository.getSnapshot();
      validateNewsExposureCatalog(reviewed,foundation);
      return calculateNewsPortfolioIntelligence(createNewsExposureEvent(news,reviewed,options.newsObservedAt,market),portfolio,foundation,reviewed,options);
      } catch {return unavailableNewsPortfolioIntelligence('invalid_input_or_repository_unavailable');}
    },
  };
}
