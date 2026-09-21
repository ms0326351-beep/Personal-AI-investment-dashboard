import type { DeepMarketImpact, SecurityImpact } from '../types/newsAnalysis';
/** Deterministic test data; never imported by production code. */
export const deepFixture:DeepMarketImpact={
  eventSummary:'NVIDIA 討論運算需求。',eventImportance:'medium',eventHorizon:'short-term',
  impactChain:[{stage:'event',label:'運算需求訊號',explanation:'新聞討論需求。',basis:'reported'},{stage:'industry',label:'晶片供應鏈',explanation:'需求可能傳導到製造環節。',basis:'inferred'}],
  securityImpacts:[],watchFactors:[{name:'公司需求指引',type:'company',reason:'需確認需求是否實現。'}],
  baseCase:'若需求持續，供應鏈可能逐步受影響。',bullCase:'若採購落實，影響可能擴大。',bearCase:'若需求未落實，影響可能有限。',
  whatWouldChangeTheView:'需觀察實際訂單訊號。',uncertainties:['摘要未提供採購規模。'],
};
export const directFixture:SecurityImpact={symbol:'NVDA',relationship:'direct',impactDirection:'uncertain',impactLevel:'medium',timeHorizon:'short-term',
  reason:'新聞提及 NVIDIA 需求。需求可能影響營運，但仍需確認。',transmissionPath:['需求訊號','NVIDIA 營運'],confidence:'medium',watchFactors:deepFixture.watchFactors,
  evidenceQuote:'NVIDIA discusses AI',anchorSymbol:'NVDA',linkage:'company'};
export const indirectFixture:SecurityImpact={...directFixture,symbol:'2330',relationship:'indirect',linkage:'supply-chain',
  reason:'新聞提及 NVIDIA 需求。透過晶片製造需求可能間接影響台積電，仍須確認採購。',transmissionPath:['NVIDIA 需求','晶片製造需求','台積電營運']};
