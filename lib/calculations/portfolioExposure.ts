import { EXPOSURE_DIMENSIONS } from '../types/exposure';
import type { ClaimKind, Confidence, ExposureConcentration, ExposureDataset, ExposureDimension, ExposurePath, ExposureRelationship } from '../types/exposure';
import type { ExposurePortfolioSnapshot, PortfolioExposureSummary } from '../types/portfolioExposure';
import { relationshipSignature, validateExposureDataset, validateExposurePortfolio } from '../utils/exposureValidation';
import type { EtfLookThroughOptions } from '../types/etfExposure';
import { calculateEtfLookThrough } from './etfLookThrough';

const levels: Record<Confidence,number>={unknown:0,low:1,medium:2,high:3};
const weakest=(values:Confidence[]):Confidence=>values.reduce((a,b)=>levels[a]<=levels[b]?a:b,'high');
const unique=(values:string[])=>[...new Set(values)];
const causal=new Set(['SUPPLIES','CUSTOMER_OF','DEPENDS_ON','BENEFITS_FROM','HURT_BY','ENABLED_BY','CONSTRAINED_BY']);
// COMPETES_WITH is preserved in the foundation but not traversed as an exposure channel.
const traversable=(e:ExposureRelationship)=>e.type!=='COMPETES_WITH';
const active=(e:ExposureRelationship,at:number)=>Date.parse(e.updatedAt)<=at && (!e.validFrom || Date.parse(e.validFrom)<=at) && (!e.validTo || at<Date.parse(e.validTo));

/** Local qualitative reachability + explicit allocation arithmetic; never predicts price impact.
 * Limits are per position. No reverse/invented edges or news inference.
 * ETF ownership uses the opt-in snapshot extension, never arbitrary Asset-to-Asset edges.
 */
export function calculatePortfolioExposure(
  portfolio: ExposurePortfolioSnapshot,
  dataset: ExposureDataset,
  options: {maxDepth?:number; maxPathsPerPosition?:number; etf?:EtfLookThroughOptions}={},
): PortfolioExposureSummary {
  validateExposurePortfolio(portfolio);
  validateExposureDataset(dataset);
  const maxDepth=options.maxDepth ?? 4, maxPaths=options.maxPathsPerPosition ?? 500;
  if (!Number.isInteger(maxDepth) || maxDepth<1 || maxDepth>8 || !Number.isInteger(maxPaths) || maxPaths<1 || maxPaths>5000) throw new Error('Invalid exposure traversal limits');
  const at=Date.parse(portfolio.asOf);
  const evidence=new Map(dataset.evidence.map(e=>[e.id,e]));
  const sources=new Map(dataset.sources.map(s=>[s.id,s]));
  const supported=(e:ExposureRelationship)=>e.evidenceIds.some(id=>{
    const item=evidence.get(id)!;
    const source=sources.get(item.sourceId)!;
    return Date.parse(item.observedAt)<=at && Date.parse(source.retrievedAt)<=at && (!source.publishedAt || Date.parse(source.publishedAt)<=at);
  });
  // Canonicalize equivalent edges regardless of ID; different claims/evidence remain distinct.
  const signatures=new Set<string>();
  const edges=dataset.relationships.filter(e=>{
    const signature=relationshipSignature(e);
    if(signatures.has(signature)) return false;
    signatures.add(signature); return active(e,at) && traversable(e);
  });
  const adjacency=new Map<string,ExposureRelationship[]>();
  for(const edge of edges) adjacency.set(edge.sourceEntityId,[...(adjacency.get(edge.sourceEntityId) ?? []),edge]);
  for(const list of adjacency.values()) list.sort((a,b)=>a.id.localeCompare(b.id));
  const entities=new Map(dataset.entities.map(e=>[e.id,e]));
  const issuerTargets=new Map<string,Set<string>>();
  for(const edge of edges) if(edge.type==='ISSUED_BY' && supported(edge) && edge.confidence!=='unknown' && ['FACT','REPORTED'].includes(edge.claim) && !edge.counterEvidenceIds.length) {
    const targets=issuerTargets.get(edge.sourceEntityId) ?? new Set<string>();
    targets.add(edge.targetEntityId); issuerTargets.set(edge.sourceEntityId,targets);
  }
  for(const p of portfolio.positions) if(entities.has(p.assetEntityId) && entities.get(p.assetEntityId)!.kind!=='Asset') throw new Error('Position must reference an Asset');
  const priced=portfolio.positions.filter(p=>p.valuationQuality==='known' && p.marketValue!==null);
  const fullyPriced=priced.length===portfolio.positions.length;
  const total=fullyPriced ? priced.reduce((sum,p)=>sum+p.marketValue!,0) : null;
  if(total!==null && !Number.isFinite(total)) throw new Error('Portfolio valuation overflow');
  const weights=new Map(portfolio.positions.map(p=>[p.id,total!==null && total>0 ? p.marketValue!/total : null]));
  const allPaths:ExposurePath[]=[];
  let truncated=false;
  for(const position of portfolio.positions) {
    let visitedPaths=0;
    function walk(entityIds:string[], path:ExposureRelationship[]) {
      const outgoing=(adjacency.get(entityIds[entityIds.length-1]) ?? []).filter(e=>!entityIds.includes(e.targetEntityId));
      if(path.length>=maxDepth) {if(outgoing.length) truncated=true; return;}
      for(const edge of outgoing) {
        if(visitedPaths>=maxPaths) {truncated=true; break;}
        visitedPaths++;
        const next=[...path,edge], nodes=[...entityIds,edge.targetEntityId];
        if(edge.dimension) {
          const indirect=next.length>1 || next.some(e=>e.nature==='INDIRECT' || causal.has(e.type));
          const speculative=next.some(e=>e.claim==='SPECULATIVE');
          const hypothetical=next.some(e=>e.claim==='HYPOTHESIS');
          const claim:ClaimKind=speculative?'SPECULATIVE':hypothetical?'HYPOTHESIS':indirect || next.some(e=>e.claim==='INFERRED')?'INFERRED':next.some(e=>e.claim==='REPORTED')?'REPORTED':'FACT';
          const supportedEdges=next.filter(supported).length;
          const fullEvidence=supportedEdges===next.length;
          const measurements=next.flatMap(e=>e.measurement?[{relationshipId:e.id,measurement:{...e.measurement}}]:[]);
          // An issuer identity is an exact alias for classification arithmetic, not an economic multiplier.
          const classificationPath=(next.length===1 || (next.length===2 && next[0].type==='ISSUED_BY' && issuerTargets.get(next[0].sourceEntityId)?.size===1)) && ['PART_OF','EXPOSED_TO'].includes(edge.type);
          const confirmed=classificationPath && fullEvidence && next.every(e=>e.nature==='DIRECT' && e.confidence!=='unknown' && ['FACT','REPORTED'].includes(e.claim) && !e.counterEvidenceIds.length) && edge.measurement && Date.parse(edge.measurement.asOf)<=at;
          allPaths.push({positionId:position.id,targetEntityId:edge.targetEntityId,dimension:edge.dimension,
            entityIds:nodes,relationshipIds:next.map(e=>e.id),depth:next.length,nature:indirect?'INDIRECT':'DIRECT',claim,
            steps:next.map(e=>({relationship:structuredClone(e),evidenceSupported:supported(e)})),
            strength:weakest(next.map(e=>e.strength)),
            confidence:fullEvidence?weakest([...next.map(e=>e.confidence),...(next.some(e=>e.counterEvidenceIds.length>0)?['low' as const]:[])]):'unknown',
            knowledge:!fullEvidence || next.some(e=>e.confidence==='unknown')?'UNKNOWN':confirmed?edge.measurement!.quality==='known'?'KNOWN_QUANTITATIVE':'ESTIMATED':'QUALITATIVE',
            evidenceIds:unique(next.flatMap(e=>e.evidenceIds)),sourceIds:unique(next.flatMap(e=>e.sourceIds)),
            counterEvidenceIds:unique(next.flatMap(e=>e.counterEvidenceIds)),invalidationConditions:unique(next.flatMap(e=>e.invalidationConditions)),
            evidenceCoverage:{supportedEdges,totalEdges:next.length,fraction:supportedEdges/next.length},measurements});
        }
        // Ownership is resolved by dated ETF snapshots, never generic Asset-to-Asset edges.
        if(entities.get(edge.targetEntityId)?.kind!=='Asset') walk(nodes,next);
      }
    }
    walk([position.assetEntityId],[]);
  }
  function concentration(dimension:ExposureDimension,paths:ExposurePath[]):ExposureConcentration {
    const overlapping=dimension==='theme' || dimension==='technology';
    const coverageBasis=overlapping?'LOWER_BOUND_UNION':'EXACT_ALLOCATION';
    if(total===null || total<=0) return {status:'UNKNOWN',buckets:[],coveredPortfolioWeight:null,overlapping,coverageBasis};
    const buckets=new Map<string,number>();
    let covered=0;
    for(const p of portfolio.positions) {
      const eligible=paths.filter(path=>path.positionId===p.id && path.knowledge==='KNOWN_QUANTITATIVE' && path.measurements[0]?.measurement.basis==='positionAllocation');
      const allocations=new Map<string,Set<number>>();
      for(const path of eligible) {
        const values=allocations.get(path.targetEntityId) ?? new Set<number>();
        values.add(path.measurements[0].measurement.fraction); allocations.set(path.targetEntityId,values);
      }
      // Conflicting allocations and impossible exclusive totals are unknown, never normalized.
      if([...allocations.values()].some(v=>v.size!==1)) continue;
      const sum=[...allocations.values()].reduce((a,v)=>a+[...v][0],0);
      if(!overlapping && sum>1+1e-9) continue;
      for(const [target,values] of allocations) buckets.set(target,(buckets.get(target) ?? 0)+weights.get(p.id)!*[...values][0]);
      // Overlapping theme fractions cannot establish union coverage without an overlap dataset.
      const fraction=overlapping?Math.max(0,...[...allocations.values()].map(v=>[...v][0])):Math.min(1,sum);
      covered+=weights.get(p.id)!*fraction;
    }
    return {status:covered===0?'UNKNOWN':!truncated && covered>=1-1e-9?'KNOWN':'PARTIAL',
      buckets:[...buckets].sort(([a],[b])=>a.localeCompare(b)).map(([entityId,portfolioWeight])=>({entityId,portfolioWeight})),
      coveredPortfolioWeight:covered,overlapping,coverageBasis};
  }
  const dimensions=Object.fromEntries(EXPOSURE_DIMENSIONS.map(dimension=>{
    const paths=allPaths.filter(p=>p.dimension===dimension);
    const covered=new Set(paths.filter(p=>p.knowledge!=='UNKNOWN' && !['HYPOTHESIS','SPECULATIVE'].includes(p.claim) && p.confidence!=='unknown').map(p=>p.positionId));
    const unknownPositionIds=portfolio.positions.filter(p=>!covered.has(p.id)).map(p=>p.id);
    return [dimension,{paths,coverage:{status:covered.size===0?'UNKNOWN':!truncated && unknownPositionIds.length===0?'KNOWN':'PARTIAL',
      coveredPositions:covered.size,totalPositions:portfolio.positions.length,
      portfolioWeight:total!==null && total>0?[...covered].reduce((a,id)=>a+weights.get(id)!,0):null,unknownPositionIds},
      ...(['sector','industry','theme','technology','geographic'].includes(dimension)?{concentration:concentration(dimension,paths)}:{})}];
  })) as PortfolioExposureSummary['dimensions'];
  const summary:PortfolioExposureSummary={portfolioId:portfolio.portfolioId,portfolioVersion:portfolio.version,datasetVersion:dataset.version,asOf:portfolio.asOf,baseCurrency:portfolio.baseCurrency,
    valuationStatus:fullyPriced?'KNOWN':priced.length?'PARTIAL':'UNKNOWN',totalMarketValue:total,
    positionWeights:portfolio.positions.map(p=>({positionId:p.id,weight:weights.get(p.id)!})),dimensions,truncated};
  if(options.etf) summary.lookThrough=calculateEtfLookThrough(portfolio,dataset,options.etf,summary,
    expanded=>calculatePortfolioExposure(expanded,dataset,{maxDepth,maxPathsPerPosition:maxPaths}));
  return summary;
}
