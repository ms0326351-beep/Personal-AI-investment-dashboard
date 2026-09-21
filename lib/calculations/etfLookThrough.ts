import type { ExposureDataset, Confidence, DataStatus, ExposureKnowledge } from '../types/exposure';
import type { ExposurePortfolioSnapshot, ExposurePosition, PortfolioExposureSummary } from '../types/portfolioExposure';
import type { EtfLookThroughOptions, EtfLookThroughSummary, EtfOwnershipStep, EtfProvenance, EtfUnresolvedExposure, UnderlyingExposure } from '../types/etfExposure';
import { holdingFraction, selectEtfSnapshot, validateEtfDataset } from '../services/etfHoldingsRepository';
import { validDate } from '../utils/exposureValidation';

const level:Record<Confidence,number>={unknown:0,low:1,medium:2,high:3};
const weakest=(a:Confidence,b:Confidence)=>level[a]<=level[b]?a:b;
const EPS=1e-12;
// 0.01 percentage point, only for explicitly complete, verifiable NAV-weight snapshots.
const ROUNDING_TOLERANCE=.0001;
const status=(covered:number,complete:boolean):DataStatus=>covered<=0?'UNKNOWN':complete && covered>=1-EPS?'KNOWN':'PARTIAL';
const provenance=(p:EtfProvenance):EtfProvenance=>({sourceIds:[...p.sourceIds],evidenceIds:[...p.evidenceIds],sourceDate:p.sourceDate,lastVerifiedAt:p.lastVerifiedAt,confidence:p.confidence,evidenceType:p.evidenceType,dataQuality:p.dataQuality});

/** ETF ownership multiplication only. Company classification stays in the existing exposure engine.
 * No AI, quotes, HTTP, UI, default fund data, weight completion or inferred economic allocation.
 */
export function calculateEtfLookThrough(
  portfolio:ExposurePortfolioSnapshot,foundation:ExposureDataset,options:EtfLookThroughOptions,
  base:PortfolioExposureSummary,calculateExpanded:(portfolio:ExposurePortfolioSnapshot)=>PortfolioExposureSummary,
):EtfLookThroughSummary {
  validateEtfDataset(options.dataset,foundation);
  const knownAt=options.knownAt ?? portfolio.asOf, maxAgeDays=options.maxAgeDays ?? 30;
  const maxDepth=options.maxDepth ?? 4,maxNodes=options.maxNodesPerPosition ?? 1000;
  if(!validDate(knownAt) || !Number.isFinite(maxAgeDays) || maxAgeDays<0 || !Number.isInteger(maxDepth) || maxDepth<1 || maxDepth>8 || !Number.isInteger(maxNodes) || maxNodes<1 || maxNodes>10000) throw new Error('Invalid ETF look-through options');
  const effective=Date.parse(portfolio.asOf),known=Date.parse(knownAt);
  const evidence=new Map(foundation.evidence.map(e=>[e.id,e]));
  const sources=new Map(foundation.sources.map(s=>[s.id,s]));
  const evidenceAvailable=(ids:string[])=>ids.some(id=>{
    const e=evidence.get(id)!,s=sources.get(e.sourceId)!;
    return Date.parse(e.observedAt)<=known && Date.parse(s.retrievedAt)<=known && (!s.publishedAt || Date.parse(s.publishedAt)<=known);
  });
  const verified=(p:EtfProvenance)=>p.dataQuality==='verified' && p.confidence!=='unknown' && ['reported','calculated'].includes(p.evidenceType) && Date.parse(p.sourceDate)<=known && Date.parse(p.lastVerifiedAt)<=known && evidenceAvailable(p.evidenceIds);
  const issuer=(asset:string)=>{
    const edges=foundation.relationships.filter(e=>e.sourceEntityId===asset && e.type==='ISSUED_BY' && e.nature==='DIRECT' && ['FACT','REPORTED'].includes(e.claim) && e.confidence!=='unknown' && !e.counterEvidenceIds.length && evidenceAvailable(e.evidenceIds)
      && Date.parse(e.updatedAt)<=Math.min(effective,known) && (!e.validFrom || Date.parse(e.validFrom)<=effective) && (!e.validTo || effective<Date.parse(e.validTo)));
    return new Set(edges.map(e=>e.targetEntityId)).size===1?edges.sort((a,b)=>a.id.localeCompare(b.id))[0]:null;
  };
  const underlying:UnderlyingExposure[]=[], unresolved:EtfUnresolvedExposure[]=[];
  const selected=new Map<string,EtfLookThroughSummary['selectedSnapshots'][number]>();
  const rounding=new Map<string,EtfLookThroughSummary['roundingAdjustments'][number]>();
  const projected:ExposurePosition[]=[], positions:EtfLookThroughSummary['positions']=[];
  const weights=new Map(base.positionWeights.map(p=>[p.positionId,p.weight]));
  let serial=0;
  let unknownAsset='__etf_unresolved__';
  while(foundation.entities.some(e=>e.id===unknownAsset)) unknownAsset+='x';
  for(const position of portfolio.positions) {
    let visited=0,complete=true;
    const start=underlying.length;
    const reject=(etfAssetId:string,reason:EtfUnresolvedExposure['reason'],fraction:number|null,path:EtfOwnershipStep[],snapshotId?:string,holdingId?:string,knowledge:ExposureKnowledge='UNKNOWN')=>{
      complete=false;
      unresolved.push({positionId:position.id,etfAssetId,reason,fractionOfPosition:fraction,ownershipPath:structuredClone(path),snapshotId,holdingId,knowledge});
    };
    const leaf=(asset:string,assetType:UnderlyingExposure['assetType'],fraction:number,path:EtfOwnershipStep[],confidence:Confidence)=>{
      const id=JSON.stringify([position.id,serial++]);
      const identity=issuer(asset);
      underlying.push({id,positionId:position.id,assetEntityId:asset,assetType,companyEntityId:identity?.targetEntityId ?? null,issuerRelationship:identity?structuredClone(identity):null,
        nature:path.length?'INDIRECT':'DIRECT',fractionOfPosition:fraction,portfolioWeight:weights.get(position.id)===null?null:weights.get(position.id)!*fraction,
        confidence:identity?weakest(confidence,identity.confidence):confidence,evidenceType:path.length?'calculated':'reported',ownershipPath:structuredClone(path)});
      projected.push({id,assetEntityId:asset,assetType,marketValue:position.marketValue===null?null:position.marketValue*fraction,valuationQuality:position.valuationQuality});
    };
    function expand(asset:string,assetType:ExposurePosition['assetType'],fraction:number,path:EtfOwnershipStep[],ancestors:string[],confidence:Confidence) {
      if(assetType!=='etf') {leaf(asset,assetType,fraction,path,confidence);return;}
      if(ancestors.includes(asset)) {reject(asset,'cycle',fraction,path);return;}
      if(path.length>=maxDepth || visited>=maxNodes) {reject(asset,'limit',fraction,path);return;}
      const snapshot=selectEtfSnapshot(options.dataset,asset,portfolio.asOf,knownAt);
      if(!snapshot) {reject(asset,'missingSnapshot',fraction,path);return;}
      selected.set(snapshot.id,structuredClone(snapshot));
      if(effective-Date.parse(snapshot.asOfDate)>maxAgeDays*86400000) {reject(asset,'stale',fraction,path,snapshot.id);return;}
      if(!verified(snapshot)) {reject(asset,'unverified',fraction,path,snapshot.id,undefined,snapshot.evidenceType==='estimated'?'ESTIMATED':snapshot.evidenceType==='inferred'?'QUALITATIVE':'UNKNOWN');return;}
      const reportedTotal=snapshot.holdings.filter(h=>h.weightBasis==='netAssets').reduce((sum,h)=>sum+(holdingFraction(h) ?? 0),0);
      const roundingEligible=snapshot.completeness==='complete' && Math.abs(reportedTotal-1)<=ROUNDING_TOLERANCE+EPS
        && snapshot.holdings.every(h=>h.weightBasis==='netAssets' && holdingFraction(h)!==null && verified(h)
          && (h.evidenceType!=='calculated' || !!h.calculation) && !!h.underlyingAssetId && h.assetType!=='unknown');
      const factor=roundingEligible && Math.abs(reportedTotal-1)>EPS?1/reportedTotal:1;
      if(factor!==1) rounding.set(snapshot.id,{snapshotId:snapshot.id,reportedTotal,factor,tolerance:ROUNDING_TOLERANCE,evidenceType:'calculated'});
      if(reportedTotal>1+EPS && !roundingEligible) {reject(asset,'overweight',fraction,path,snapshot.id);return;}
      let accepted=0;
      if(snapshot.completeness!=='complete') complete=false;
      for(const holding of snapshot.holdings) {
        if(visited++>=maxNodes) {reject(asset,'limit',null,path,snapshot.id);break;}
        const weight=holdingFraction(holding);
        if(weight===null) {reject(asset,'missingWeight',null,path,snapshot.id,holding.id);continue;}
        if(holding.weightBasis!=='netAssets') {reject(asset,'unsupportedBasis',null,path,snapshot.id,holding.id);continue;}
        if(!verified(holding) || (holding.evidenceType==='calculated' && !holding.calculation)) {
          reject(asset,'unverified',null,path,snapshot.id,holding.id,holding.evidenceType==='estimated' || holding.dataQuality==='estimated'?'ESTIMATED':holding.evidenceType==='inferred'?'QUALITATIVE':'UNKNOWN');continue;
        }
        if(!holding.underlyingAssetId || holding.assetType==='unknown') {reject(asset,'unknownAsset',fraction*weight,path,snapshot.id,holding.id);continue;}
        const appliedWeight=weight*factor;
        accepted+=appliedWeight;
        if(weight===0) continue;
        const step:EtfOwnershipStep={snapshotId:snapshot.id,etfAssetId:asset,asOfDate:snapshot.asOfDate,provenance:provenance(snapshot),holding:structuredClone(holding),normalizedWeight:weight,appliedWeight};
        expand(holding.underlyingAssetId,holding.assetType,fraction*appliedWeight,[...path,step],[...ancestors,asset],weakest(confidence,weakest(snapshot.confidence,holding.confidence)));
      }
      // This aggregate overlaps individual diagnostics. Consumers use positions.unknownFraction,
      // never sum unresolved records, whose individual unknown weights may be null.
      if(accepted<1-EPS) reject(asset,'remainder',fraction*(1-accepted),path,snapshot.id);
    }
    expand(position.assetEntityId,position.assetType,1,[],[],'high');
    const covered=Math.min(1,underlying.slice(start).reduce((sum,p)=>sum+p.fractionOfPosition,0));
    positions.push({positionId:position.id,status:status(covered,complete),coveredFraction:covered,unknownFraction:Math.max(0,1-covered)});
    // Keep the original total denominator, including all unresolved ETF value.
    if(covered<1 || position.marketValue===null) projected.push({id:JSON.stringify([position.id,'residual']),assetEntityId:unknownAsset,assetType:'other',marketValue:position.marketValue===null?null:position.marketValue*(1-covered),valuationQuality:position.valuationQuality});
  }
  const priced=base.totalMarketValue!==null && base.totalMarketValue>0;
  const covered=priced?positions.reduce((sum,p)=>sum+weights.get(p.positionId)!*p.coveredFraction,0):null;
  const companyBuckets=new Map<string,{companyEntityId:string;direct:number;indirect:number;combined:number}>();
  if(priced) for(const p of underlying) if(p.companyEntityId && p.portfolioWeight!==null) {
    const bucket=companyBuckets.get(p.companyEntityId) ?? {companyEntityId:p.companyEntityId,direct:0,indirect:0,combined:0};
    bucket[p.nature==='DIRECT'?'direct':'indirect']+=p.portfolioWeight; bucket.combined=bucket.direct+bucket.indirect; companyBuckets.set(p.companyEntityId,bucket);
  }
  const companyCoverage=priced?[...companyBuckets.values()].reduce((sum,b)=>sum+b.combined,0):null;
  const funds=[...new Map(portfolio.positions.filter(p=>p.assetType==='etf').map(p=>[p.assetEntityId,p.id]))];
  const overlaps:EtfLookThroughSummary['overlaps']=[];
  const distribution=(positionId:string)=>{
    const map=new Map<string,number>();
    for(const p of underlying.filter(p=>p.positionId===positionId)) {
      const id=p.companyEntityId?`company:${p.companyEntityId}`:`asset:${p.assetEntityId}`;
      map.set(id,(map.get(id) ?? 0)+p.fractionOfPosition);
    }
    return map;
  };
  for(let i=0;i<funds.length;i++) for(let j=i+1;j<funds.length;j++) {
    const [left,leftPosition]=funds[i],[right,rightPosition]=funds[j];
    const a=distribution(leftPosition),b=distribution(rightPosition);
    const aStatus=positions.find(p=>p.positionId===leftPosition)!.status,bStatus=positions.find(p=>p.positionId===rightPosition)!.status;
    const unresolvedIssuer=underlying.some(p=>[leftPosition,rightPosition].includes(p.positionId) && p.assetType==='stock' && !p.companyEntityId);
    const comparisonStatus=aStatus==='KNOWN' && bStatus==='KNOWN' && !unresolvedIssuer?'KNOWN':aStatus==='UNKNOWN' || bStatus==='UNKNOWN'?'UNKNOWN':'PARTIAL';
    overlaps.push({leftEtfAssetId:left,rightEtfAssetId:right,status:comparisonStatus,identityBasis:'verifiedIssuerOrAsset',knownOverlap:comparisonStatus==='UNKNOWN'?null:[...a].reduce((sum,[id,value])=>sum+Math.min(value,b.get(id) ?? 0),0)});
  }
  const exposure=calculateExpanded({...portfolio,positions:projected});
  const ownershipById=new Map(underlying.map(p=>[p.id,p]));
  for(const dimension of Object.values(exposure.dimensions)) for(const path of dimension.paths) {
    const ownership=ownershipById.get(path.positionId);
    if(ownership) path.confidence=weakest(path.confidence,ownership.confidence);
  }
  // Incomplete declared holdings remain partial even if supplied weights happen to sum to 1.
  if(positions.some(p=>p.status!=='KNOWN')) for(const d of Object.values(exposure.dimensions)) {
    if(d.coverage.status==='KNOWN') d.coverage.status='PARTIAL';
    if(d.concentration?.status==='KNOWN') d.concentration.status='PARTIAL';
  }
  return {datasetVersion:options.dataset.version,foundationVersion:foundation.version,asOfDate:portfolio.asOf,knownAt,
    status:covered===null?'UNKNOWN':status(covered,positions.every(p=>p.status==='KNOWN')),coveredPortfolioWeight:covered,unknownPortfolioWeight:covered===null?null:Math.max(0,1-covered),
    positions,underlying,unresolved,selectedSnapshots:[...selected.values()],roundingAdjustments:[...rounding.values()],
    companyConcentration:{status:companyCoverage===null?'UNKNOWN':status(companyCoverage,positions.every(p=>p.status==='KNOWN')),coveredPortfolioWeight:companyCoverage,buckets:[...companyBuckets.values()].sort((a,b)=>a.companyEntityId.localeCompare(b.companyEntityId))},
    overlaps,exposure};
}
