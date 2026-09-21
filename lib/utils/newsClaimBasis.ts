import type { NewsItem } from '../types';
import type { ImpactChainNode } from '../types/newsAnalysis';

// A literal match is evidence of wording, not proof of an investment conclusion.
// No attributed-opinion exception: the current schema has no verified speaker/quote.
const judgment = /利多|利空|有利|不利|受[惠益]|推升|推高|帶動|提振|承壓|看[多空好壞]|預[期測估]|展望|估值|目標價|可能|將|有望|因此|導致|促使|有助|因而|意味|反映|預示|可望|\b(?:bullish|bearish|benefit\w*|boost\w*|driv\w*|lead\w*\s+to|positive|negative|favourable|favorable|outlook|forecast\w*|expect\w*|could|may|might|will|should|would|potential\w*|because|therefore|suggest\w*|impli\w*)\b/i;
const normalize = (text:string) => text.normalize('NFKC').replace(/\s+/g,' ').trim().toLowerCase();

/** Fail closed for paraphrases/translations we cannot verify without another model call. */
export function constrainClaimBasis(node:ImpactChainNode,item:Pick<NewsItem,'title'|'summary'>):ImpactChainNode {
  const source=[normalize(item.title),normalize(item.summary)];
  const supported=[node.label,node.explanation].every(text=>{
    const claim=normalize(text);
    return claim.length>0 && !judgment.test(claim) && source.some(s=>s.includes(claim));
  });
  return {...node,basis:node.basis==='reported' && supported?'reported':'inferred'};
}
