import type { NewsItem } from '../types';
import type { MarketImpactAnalysis, SecurityImpact } from '../types/newsAnalysis';
import { symbolAliases } from '../data/symbolAliases';
import { newsSecurityContext, supplyChainLinks } from '../data/newsSecurityContext';
import { matchAliasesInText } from './textMatch';
const matchesAnyAlias=(text:string,aliases:string[])=>matchAliasesInText(text,{match:aliases}).length>0;

export function supportedSecurityImpacts(market:MarketImpactAnalysis,item:NewsItem,tracked:string[]):SecurityImpact[] {
  const source=`${item.title.slice(0,500)}\n${item.summary.slice(0,400)}`;
  return (market.securityImpacts ?? []).filter(impact=>{
    if(!tracked.includes(impact.symbol) || !newsSecurityContext[impact.symbol] || impact.confidence==='low' || !source.includes(impact.evidenceQuote)) return false;
    if(impact.relationship==='direct') return impact.linkage==='company' && impact.anchorSymbol===impact.symbol
      && market.explicitlyMentionedSymbols.includes(impact.symbol)
      && matchesAnyAlias(impact.evidenceQuote,symbolAliases[impact.symbol] ?? [impact.symbol]);
    if(!market.inferredSymbols.includes(impact.symbol) || impact.transmissionPath.length<3) return false;
    if(impact.linkage==='supply-chain') return market.explicitlyMentionedSymbols.includes(impact.anchorSymbol)
      && matchesAnyAlias(impact.evidenceQuote,symbolAliases[impact.anchorSymbol] ?? [impact.anchorSymbol])
      && !!supplyChainLinks[impact.anchorSymbol]?.includes(impact.symbol)
      && /需求|訂單|採購|出貨|產能|製造|供應|demand|orders|procurement|shipment|capacity|manufactur|supply/i.test(source);
    // Only policy/rate channels can use broad market exposure; generic industry words cannot.
    if(impact.linkage==='macro' && impact.anchorSymbol==='') return (
      market.eventType==='monetary-policy' && /升息|降息|利率|殖利率|interest rate|rate cut|rate hike|yield/i.test(impact.evidenceQuote)
      && /聯準會|美國聯儲|日本央行|歐洲央行|\bFed\b|Federal Reserve|Bank of Japan|\bBOJ\b|\bECB\b/i.test(source)
    ) || (market.eventType==='trade-policy' && /關稅|出口管制|tariff|export control/i.test(impact.evidenceQuote)
      && /美國|台灣|臺灣|中國|United States|\bUS\b|U\.S\.|Taiwan|China/i.test(source));
    // No verified current constituent dataset: never infer an ETF link from an invented holding.
    return false;
  });
}
