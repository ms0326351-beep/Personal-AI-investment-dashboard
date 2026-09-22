import type { Confidence, ExposureDataset } from '../types/exposure';
import type { ExposurePortfolioSnapshot } from '../types/portfolioExposure';
import type { EtfLookThroughOptions } from '../types/etfExposure';
import type { NewsExposureCatalog, NewsExposureEvent, NewsExposurePath, NewsPortfolioIntelligence, TransmissionDirection, TransmissionStep } from '../types/newsExposure';
import { calculatePortfolioExposure } from './portfolioExposure';
import { relationshipSignature } from '../utils/exposureValidation';
import { validateNewsExposureCatalog, validateNewsExposureEvent } from '../utils/newsExposureValidation';
import { selectNewsAnalysisInput } from '../utils/newsAnalysisInput';
import { matchAliasesInText } from '../utils/textMatch';
import { validDate } from '../utils/exposureValidation';

const levels:Confidence[]=['unknown','low','medium','high'];
const weakest=(...values:Confidence[]):Confidence=>levels[Math.min(...values.map(v=>levels.indexOf(v)))];
const decay=(value:Confidence):Confidence=>value==='high'?'medium':value==='medium'?'low':value;
const futureKinds=new Set(['FutureDemand','EmergingTechnology','WeakSignal','Bottleneck','CapacityConstraint','DemandDriver']);
const combineDirection=(values:TransmissionDirection[]):TransmissionDirection=>{
  if(!values.length || values.includes('uncertain')) return 'uncertain';
  return new Set(values).size>1 || values.includes('mixed')?'mixed':values[0];
};
const propagate=(direction:TransmissionDirection,sensitivity:string):TransmissionDirection=>{
  if(direction==='uncertain' || sensitivity==='unknown') return 'uncertain';
  if(direction==='mixed' || sensitivity==='mixed') return 'mixed';
  return sensitivity==='opposite'?(direction==='positive'?'negative':'positive'):direction;
};
const coverage=(steps:TransmissionStep[])=>({supportedEdges:steps.filter(s=>s.evidenceSupported).length,totalEdges:steps.length,fraction:steps.length?steps.filter(s=>s.evidenceSupported).length/steps.length:0});

/** No source text or exception message escapes the failure boundary. */
export function unavailableNewsPortfolioIntelligence(reason='invalid_input'):NewsPortfolioIntelligence {
  return {newsId:'',asOf:'',foundationVersion:'',catalogVersion:'',status:'UNKNOWN',paths:[],connections:[],holdings:[],hiddenConcentrations:[],portfolioExposure:null,
    gaps:[{reason}],truncated:false,disclaimer:'資料不足，無法確認曝險；非投資建議。'};
}
export function calculateNewsPortfolioIntelligence(...args:Parameters<typeof calculateValidatedNewsPortfolioIntelligence>):NewsPortfolioIntelligence {
  try {return calculateValidatedNewsPortfolioIntelligence(...args);}
  catch {return unavailableNewsPortfolioIntelligence();}
}

/** Local only. News mentions seed a reviewed Foundation graph; AI strings never create edges.
 * Output is conditional reachability, not a prediction or a complete inventory of economic risks.
 */
function calculateValidatedNewsPortfolioIntelligence(
  event:NewsExposureEvent,portfolio:ExposurePortfolioSnapshot,foundation:ExposureDataset,catalog:NewsExposureCatalog,
  options:{etf?:EtfLookThroughOptions;maxDepth?:number;maxPaths?:number;maxRelationshipAgeDays?:number}={},
):NewsPortfolioIntelligence {
  validateNewsExposureCatalog(catalog,foundation); validateNewsExposureEvent(event);
  const maxDepth=options.maxDepth ?? 6,maxPaths=options.maxPaths ?? 500,maxAge=options.maxRelationshipAgeDays ?? 365;
  if(!Number.isInteger(maxDepth) || maxDepth<1 || maxDepth>12 || !Number.isInteger(maxPaths) || maxPaths<1 || maxPaths>5000 || !Number.isFinite(maxAge) || maxAge<0) throw new Error('Invalid news exposure traversal limits');
  const at=Date.parse(portfolio.asOf);
  if(options.etf?.knownAt && (!validDate(options.etf.knownAt) || Date.parse(options.etf.knownAt)>at)) throw new Error('Future ownership knowledge');
  const ownership=calculatePortfolioExposure(portfolio,foundation,{etf:options.etf ?? {dataset:{version:'no-etf-data',snapshots:[]}}}).lookThrough!;
  const gaps:NewsPortfolioIntelligence['gaps']=[];
  const entities=new Map(foundation.entities.map(e=>[e.id,e]));
  const edges=new Map(foundation.relationships.map(e=>[e.id,e]));
  const sources=new Map(foundation.sources.map(s=>[s.id,s])), evidence=new Map(foundation.evidence.map(e=>[e.id,e]));
  const supported=(ids:string[])=>ids.some(id=>{
    const e=evidence.get(id)!,s=sources.get(e.sourceId)!;
    return Date.parse(e.observedAt)<=at && Date.parse(s.retrievedAt)<=at && (!s.publishedAt || Date.parse(s.publishedAt)<=at);
  });
  const evidenceCopies=(ids:string[])=>[...new Set(ids)].map(id=>structuredClone(evidence.get(id)!));
  const sourceCopies=(ids:string[])=>[...new Set(ids)].map(id=>structuredClone(sources.get(id)!));
  const seenRules=new Set<string>();
  const rules=catalog.rules.filter(r=>{
    const e=edges.get(r.relationshipId)!;
    const signature=JSON.stringify([relationshipSignature(e),r.traversal,r.relationshipType,r.sensitivity,r.rationale,[...r.evidenceIds].sort(),[...r.sourceIds].sort(),r.confidence,r.asOf,[...r.invalidationConditions].sort(),r.scenario]);
    if(seenRules.has(signature)) return false; seenRules.add(signature);
    if(Date.parse(e.updatedAt)>at || Date.parse(r.asOf)>at || (e.validFrom && Date.parse(e.validFrom)>at) || (e.validTo && Date.parse(e.validTo)<=at)) {
      gaps.push({relationshipId:e.id,reason:'relationship_not_valid_at_query_time'});return false;
    }
    if(at-Date.parse(e.updatedAt)>maxAge*86400000 || at-Date.parse(r.asOf)>maxAge*86400000) {
      gaps.push({relationshipId:e.id,reason:'stale_relationship'});return false;
    }
    // Ownership identity/ETF traversal is handled once by 3B.2, never an impact channel.
    if(e.type==='ISSUED_BY' || entities.get(e.targetEntityId)?.kind==='Asset') {
      gaps.push({relationshipId:e.id,reason:'ownership_not_transmission'});return false;
    }
    return true;
  }).sort((a,b)=>a.relationshipId.localeCompare(b.relationshipId) || a.traversal.localeCompare(b.traversal));
  const paths:NewsExposurePath[]=[], keys=new Set<string>(); let truncated=false;
  function save(nodes:string[],steps:TransmissionStep[],scenarios:NewsExposurePath['scenarios']):NewsExposurePath|null {
    const key=JSON.stringify([nodes,steps.map(s=>[s.relationship?.id,s.rule,s.direction,s.confidence]),scenarios]);
    if(keys.has(key)) return null;
    if(paths.length>=maxPaths) {truncated=true;return null;}
    keys.add(key);
    const last=steps[steps.length-1], full=steps.every(s=>s.evidenceSupported) && last.confidence!=='unknown';
    const path:NewsExposurePath={id:`path-${paths.length+1}`,entityIds:[...nodes],steps:structuredClone(steps),targetEntityId:nodes[nodes.length-1],direction:full?last.direction:'uncertain',
      basis:!full?'unknown':steps.length>1 || scenarios.length?'inferred':'reported',impactBasis:full?'inferred':'unknown',confidence:full?last.confidence:'unknown',depth:steps.length,
      order:steps.length===1?'first_order':steps.length===2?'second_order':'third_order_or_more',nature:steps.length===1 && !scenarios.length?'direct':'indirect',scenarios:structuredClone(scenarios),evidenceCoverage:coverage(steps)};
    paths.push(path); return path;
  }
  function walk(path:NewsExposurePath) {
    const outgoing=rules.filter(r=>{const e=edges.get(r.relationshipId)!;return (r.traversal==='forward'?e.sourceEntityId:e.targetEntityId)===path.targetEntityId;});
    for(const rule of outgoing) {
      const edge=edges.get(rule.relationshipId)!,target=rule.traversal==='forward'?edge.targetEntityId:edge.sourceEntityId;
      if(path.entityIds.includes(target)) {gaps.push({relationshipId:edge.id,reason:'cycle_stopped'});continue;}
      if(path.depth>=maxDepth || paths.length>=maxPaths) {truncated=true;break;}
      const ok=supported(edge.evidenceIds) && supported(rule.evidenceIds);
      const hypothetical=['HYPOTHESIS','SPECULATIVE'].includes(edge.claim);
      const confidence=ok?decay(weakest(path.confidence,edge.confidence,rule.confidence,...(edge.counterEvidenceIds.length || hypothetical?['low' as const]:[]))):'unknown';
      const direction=confidence==='unknown' || edge.counterEvidenceIds.length>0?'uncertain':propagate(path.direction,rule.sensitivity);
      if(!ok) gaps.push({relationshipId:edge.id,reason:'missing_or_future_evidence'});
      if(edge.counterEvidenceIds.length) gaps.push({relationshipId:edge.id,reason:'conflicting_evidence'});
      const scenarios=[...path.scenarios];
      if(rule.scenario) scenarios.push(rule.scenario);
      if(hypothetical && !rule.scenario) scenarios.push({condition:`僅在此假設成立時：${edge.rationale}`,demandKind:'emerging'});
      if(futureKinds.has(entities.get(target)!.kind) && !rule.scenario) scenarios.push({condition:'此未來需求情境成立時（尚非已發生事實）',demandKind:'emerging'});
      const step:TransmissionStep={source:path.targetEntityId,target,relationshipType:rule.relationshipType,direction,
        basis:!ok || edge.confidence==='unknown'?'unknown':!scenarios.length && edge.nature==='DIRECT' && ['FACT','REPORTED'].includes(edge.claim)?'reported':'inferred',impactBasis:confidence==='unknown'?'unknown':'inferred',confidence,depth:path.depth+1,asOf:rule.asOf,
        evidence:evidenceCopies([...edge.evidenceIds,...edge.counterEvidenceIds,...rule.evidenceIds]),evidenceSource:sourceCopies([...edge.sourceIds,...edge.counterEvidenceIds.map(id=>evidence.get(id)!.sourceId),...rule.sourceIds]),evidenceSupported:ok,
        invalidationConditions:[...new Set([...edge.invalidationConditions,...rule.invalidationConditions])],relationship:structuredClone(edge),rule:structuredClone(rule)};
      const next=save([...path.entityIds,target],[...path.steps,step],scenarios); if(next) walk(next);
    }
  }
  const input=selectNewsAnalysisInput(event.news);
  const text=input?`${input.item.title}\n${input.item.summary}`:'';
  let source:URL|null=null; try {source=new URL(event.news.url ?? '');} catch { /* absent source is unknown */ }
  const newsUsable=event.news.origin==='rss' && source && ['https:','http:'].includes(source.protocol) && !source.username && !source.password && Date.parse(event.news.publishedAt)<=at && Date.parse(event.observedAt)<=at;
  if(!newsUsable) gaps.push({reason:'unavailable_news_source_or_future_news'});
  for(const anchor of event.anchors) {
    const binding=catalog.bindings.find(b=>b.entityId===anchor.entityId);
    const matched=binding && binding.aliases.includes(anchor.mention) && matchAliasesInText(text,{entity:[anchor.mention]}).length>0;
    if(!matched || !newsUsable) {gaps.push({entityId:anchor.entityId,reason:'unsupported_news_anchor'});continue;}
    const scenarios=event.scenario?[event.scenario]:futureKinds.has(entities.get(anchor.entityId)!.kind)?[{condition:'此未來需求情境成立時（尚非已發生事實）',demandKind:'emerging' as const}]:[];
    const confidence=scenarios.length?weakest(anchor.confidence,'low'):anchor.confidence;
    const step:TransmissionStep={source:`news:${event.news.id}`,target:anchor.entityId,relationshipType:'news_mention',direction:confidence==='unknown'?'uncertain':anchor.direction,
      basis:scenarios.length?'inferred':'reported',impactBasis:confidence==='unknown'?'unknown':'inferred',confidence,depth:1,asOf:event.news.publishedAt,
      evidence:[{id:`news:${event.news.id}:${anchor.entityId}`,sourceId:`news:${event.news.id}`,excerpt:anchor.mention,observedAt:event.observedAt}],
      evidenceSource:[{id:`news:${event.news.id}`,title:event.news.title,url:source!.href,publishedAt:event.news.publishedAt,retrievedAt:event.observedAt}],evidenceSupported:true,
      invalidationConditions:['新聞更正、來源撤回或情境條件不成立']};
    const path=save([anchor.entityId],[step],scenarios);if(path) walk(path);
  }
  if(!event.anchors.length) gaps.push({reason:'no_verified_entity_mentions'});
  if(truncated) gaps.push({reason:'traversal_limit'});
  const connections:NewsPortfolioIntelligence['connections']=[];
  for(const path of paths) for(const slice of ownership.underlying) {
    if(path.targetEntityId!==slice.assetEntityId && path.targetEntityId!==slice.companyEntityId) continue;
    let confidence=weakest(path.confidence,slice.confidence);
    const ownershipSteps:TransmissionStep[]=[];
    let from=path.targetEntityId;
    const add=(target:string,type:TransmissionStep['relationshipType'],asOf:string,ids:string[],sourceIds:string[],basis:TransmissionStep['basis'],relationship?:TransmissionStep['relationship'])=>{
      ownershipSteps.push({source:from,target,relationshipType:type,direction:confidence==='unknown'?'uncertain':path.direction,basis,impactBasis:confidence==='unknown'?'unknown':'inferred',confidence,depth:path.depth+ownershipSteps.length+1,asOf,
        evidence:evidenceCopies(ids),evidenceSource:sourceCopies(sourceIds),evidenceSupported:type==='portfolio_holding' || supported(ids),invalidationConditions:relationship?.invalidationConditions ?? ['持股或成分快照變更'],relationship,
        ...(type==='portfolio_holding'?{portfolioEvidence:{portfolioId:portfolio.portfolioId,version:portfolio.version,positionId:slice.positionId,assetEntityId:portfolio.positions.find(p=>p.id===slice.positionId)!.assetEntityId,asOf:portfolio.asOf}}:{})});from=target;
    };
    if(from===slice.companyEntityId && slice.issuerRelationship) add(slice.assetEntityId,'issuer_identity',slice.issuerRelationship.updatedAt,slice.issuerRelationship.evidenceIds,slice.issuerRelationship.sourceIds,'reported',structuredClone(slice.issuerRelationship));
    for(const step of [...slice.ownershipPath].reverse()) add(step.etfAssetId,'ETF_holding',step.asOfDate,[...step.holding.evidenceIds,...step.provenance.evidenceIds],[...step.holding.sourceIds,...step.provenance.sourceIds],step.holding.evidenceType==='reported'?'reported':'inferred');
    add(`position:${slice.positionId}`,'portfolio_holding',portfolio.asOf,[],[],'reported');
    const allNodes=[...path.entityIds,...ownershipSteps.map(s=>s.target)];
    if(new Set(allNodes).size!==allNodes.length) {gaps.push({entityId:path.targetEntityId,reason:'ownership_cycle_stopped'});continue;}
    if(ownershipSteps.some(s=>!s.evidenceSupported)) {
      confidence='unknown';gaps.push({entityId:path.targetEntityId,reason:'unsupported_ownership_evidence'});
      for(const step of ownershipSteps) {step.confidence='unknown';step.direction='uncertain';step.impactBasis='unknown';}
    }
    connections.push({pathId:path.id,ownership:structuredClone(slice),ownershipSteps,hopCount:path.depth+ownershipSteps.length,nature:path.nature==='direct' && slice.nature==='DIRECT'?'direct':'indirect',hidden:path.depth>1,
      direction:confidence==='unknown'?'uncertain':path.direction,confidence,impactBasis:confidence==='unknown'?'unknown':'inferred',evidenceCoverage:coverage([...path.steps,...ownershipSteps])});
  }
  const holdings=portfolio.positions.map(p=>{
    const matches=connections.filter(c=>c.ownership.positionId===p.id),valid=matches.filter(c=>c.confidence!=='unknown');
    const slices=[...new Map(valid.map(c=>[c.ownership.id,c.ownership])).values()];
    return {positionId:p.id,status:(!valid.length?'UNKNOWN':truncated || gaps.length>0 || slices.some(s=>s.portfolioWeight===null) || matches.length!==valid.length || ownership.positions.find(x=>x.positionId===p.id)?.status!=='KNOWN'?'PARTIAL':'KNOWN') as NewsPortfolioIntelligence['status'],
      direction:combineDirection(matches.map(c=>c.direction)),confidence:matches.length?weakest(...matches.map(c=>c.confidence)):'unknown' as Confidence,
      direct:valid.some(c=>c.nature==='direct'),indirect:valid.some(c=>c.nature==='indirect'),hidden:valid.some(c=>c.hidden),pathIds:[...new Set(matches.map(c=>c.pathId))],
      connectedPortfolioWeight:!valid.length || slices.some(s=>s.portfolioWeight===null)?null:slices.reduce((sum,s)=>sum+s.portfolioWeight!,0)};
  });
  for(const h of holdings) if(!h.pathIds.length) gaps.push({entityId:portfolio.positions.find(p=>p.id===h.positionId)!.assetEntityId,reason:'no_supported_path_not_proof_of_no_exposure'});
  if(ownership.status!=='KNOWN') gaps.push({reason:'incomplete_ownership_or_valuation'});
  const hiddenConcentrations:NewsPortfolioIntelligence['hiddenConcentrations']=[];
  for(const anchorEntityId of [...new Set(paths.map(p=>p.entityIds[0]))]) {
    const related=connections.filter(c=>c.hidden && paths.find(p=>p.id===c.pathId)!.entityIds[0]===anchorEntityId);
    if(!related.length) continue;
    const known=related.filter(c=>c.confidence!=='unknown');
    const slices=[...new Map(known.map(c=>[c.ownership.id,c.ownership])).values()];
    hiddenConcentrations.push({anchorEntityId,positionIds:[...new Set(related.map(c=>c.ownership.positionId))],pathIds:[...new Set(related.map(c=>c.pathId))],
      status:!known.length?'UNKNOWN':truncated || gaps.length>0 || known.length!==related.length || ownership.status!=='KNOWN'?'PARTIAL':'KNOWN',
      connectedPortfolioWeight:!known.length || slices.some(s=>s.portfolioWeight===null)?null:slices.reduce((sum,s)=>sum+s.portfolioWeight!,0),overlapping:true});
  }
  const valid=connections.some(c=>c.confidence!=='unknown');
  return {newsId:event.news.id,asOf:portfolio.asOf,foundationVersion:foundation.version,catalogVersion:catalog.version,status:!valid?'UNKNOWN':gaps.length || holdings.some(h=>h.status!=='KNOWN')?'PARTIAL':'KNOWN',
    paths,connections,holdings,hiddenConcentrations,portfolioExposure:ownership,gaps,truncated,disclaimer:'條件式曝險關聯，非價格預測或投資建議；KNOWN 僅代表所提供路徑可驗證，不代表完整風險盤點。'};
}
