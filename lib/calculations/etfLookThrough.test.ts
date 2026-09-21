import test from 'node:test';
import assert from 'node:assert/strict';
import { calculatePortfolioExposure } from './portfolioExposure';
import { createEtfHoldingsRepository } from '../services/etfHoldingsRepository';
import { adaptLegacyPortfolio } from '../utils/portfolioExposureAdapter';
import type { ExposureDataset, ExposureRelationship } from '../types/exposure';
import type { ExposurePortfolioSnapshot } from '../types/portfolioExposure';
import type { EtfDataset, EtfHolding, EtfHoldingsSnapshot, EtfProvenance, EtfLookThroughOptions } from '../types/etfExposure';

const asOf='2026-09-20T00:00:00Z', early='2026-09-01T00:00:00Z';
const prov=():EtfProvenance=>({sourceIds:['source'],evidenceIds:['evidence'],sourceDate:early,lastVerifiedAt:early,confidence:'high',evidenceType:'reported',dataQuality:'verified'});
function relation(id:string,source:string,target:string,extra:Partial<ExposureRelationship>={}):ExposureRelationship {
  return {id,sourceEntityId:source,targetEntityId:target,type:'EXPOSED_TO',nature:'DIRECT',strength:'high',confidence:'high',claim:'REPORTED',
    rationale:'Synthetic test evidence only',evidenceIds:['evidence'],sourceIds:['source'],counterEvidenceIds:[],invalidationConditions:['Source revised'],updatedAt:early,...extra};
}
function foundation():ExposureDataset {
  return {version:'foundation-test',entities:[
    ...['fundA','fundB','fundC','A','B','C','cash'].map(id=>({id,kind:'Asset' as const,name:id})),
    ...['companyA','companyB','companyC'].map(id=>({id,kind:'Company' as const,name:id})),
    {id:'industry',kind:'Industry',name:'Industry'},{id:'sub',kind:'SubIndustry',name:'Sub industry'},
    {id:'tech',kind:'Technology',name:'Tech'},{id:'geo',kind:'Country',name:'Country'},{id:'theme',kind:'Theme',name:'Theme'},
  ],sources:[{id:'source',title:'Fixture',url:'https://example.com/fund',retrievedAt:early,publishedAt:early}],
  evidence:[{id:'evidence',sourceId:'source',excerpt:'Test-only holding/allocation evidence',observedAt:early}],
  relationships:['A','B','C'].flatMap(asset=>[
    relation(`issuer-${asset}`,asset,`company${asset}`,{type:'ISSUED_BY'}),
    ...(['industry','technology','geographic','theme'] as const).map((dimension,i)=>relation(`${asset}-${dimension}`,`company${asset}`,['industry','tech','geo','theme'][i],{dimension,measurement:{basis:'positionAllocation',quality:'known',fraction:1,asOf:early}})),
  ])};
}
function holding(asset:string|null,weight:number|null,extra:Partial<EtfHolding>={}):EtfHolding {
  return {...prov(),id:asset ?? 'unknown',underlyingAssetId:asset,ticker:asset,name:asset ?? 'Unknown holding',assetType:'stock',weight,weightUnit:'fraction',weightBasis:'netAssets',...extra};
}
function snapshot(fund='fundA',holdings=[holding('A',.6),holding('B',.4)],extra:Partial<EtfHoldingsSnapshot>={}):EtfHoldingsSnapshot {
  return {...prov(),id:`${fund}-snapshot`,etfAssetId:fund,asOfDate:early,completeness:'complete',holdings,...extra};
}
function portfolio():ExposurePortfolioSnapshot {
  return {portfolioId:'p',version:'1',baseCurrency:'TWD',asOf,positions:[{id:'pA',assetEntityId:'fundA',assetType:'etf',marketValue:100,valuationQuality:'known'}]};
}
const data=(snapshots=[snapshot()]):EtfDataset=>({version:'etf-test',snapshots});
function run(d=data(),p=portfolio(),f=foundation(),options:Partial<EtfLookThroughOptions>={}) {
  return calculatePortfolioExposure(p,f,{etf:{dataset:d,...options}}).lookThrough!;
}
const near=(actual:number|null,expected:number)=>assert.ok(actual!==null && Math.abs(actual-expected)<1e-10,`${actual} != ${expected}`);

// Financial acceptance fixtures: A represents TSMC in cases 1/5/6, X in case 2.
test('acceptance 1: 50% ETF plus 50% TSMC = 75% TSMC and 25% B',()=>{
  const p=portfolio(); p.positions[0].marketValue=50;
  p.positions.push({id:'direct',assetEntityId:'A',assetType:'stock',marketValue:50,valuationQuality:'known'});
  const r=run(data([snapshot('fundA',[holding('A',.5),holding('B',.5)])]),p);
  const [a,b]=r.companyConcentration.buckets;
  near(a.direct,.5); near(a.indirect,.25); near(a.combined,.75); near(b.combined,.25);
  near(a.combined+b.combined,1); assert.equal(r.status,'KNOWN');
});
test('acceptance 2: two ETFs yield X40 Y20 Z40 and 20% intrinsic overlap',()=>{
  const p=portfolio(); p.positions=[{...p.positions[0],marketValue:50},{...p.positions[0],id:'pB',assetEntityId:'fundB',marketValue:50}];
  const r=run(data([snapshot(),snapshot('fundB',[holding('A',.2),holding('C',.8)])]),p);
  [.4,.2,.4].forEach((v,i)=>near(r.companyConcentration.buckets[i].combined,v));
  near(r.overlaps[0].knownOverlap,.2);
  const left=r.underlying.filter(v=>v.positionId==='pA').map(v=>v.companyEntityId);
  assert.deepEqual(r.underlying.filter(v=>v.positionId==='pB' && left.includes(v.companyEntityId)).map(v=>v.companyEntityId),['companyA']);
});
test('acceptance 3: 80% known leaves 20% unknown even with a complete declaration',()=>{
  for(const completeness of ['complete','partial','unknown'] as const) {
    const r=run(data([snapshot('fundA',[holding('A',.5),holding('B',.3)],{completeness})]));
    near(r.coveredPortfolioWeight,.8); near(r.unknownPortfolioWeight,.2); assert.equal(r.status,'PARTIAL');
    near(r.companyConcentration.buckets[0].combined,.5); near(r.companyConcentration.buckets[1].combined,.3);
    assert.equal(r.roundingAdjustments.length,0);
  }
});
test('acceptance 4: 99.99/100.01 rounding only for complete verified holdings',()=>{
  for(const second of [.4999,.5001]) {
    const r=run(data([snapshot('fundA',[holding('A',.5),holding('B',second)])]));
    assert.equal(r.status,'KNOWN'); near(r.coveredPortfolioWeight,1); near(r.unknownPortfolioWeight,0);
    near(r.underlying[0].portfolioWeight,.5/(.5+second));
    near(r.underlying[1].portfolioWeight,second/(.5+second));
    near(r.roundingAdjustments[0].reportedTotal,.5+second);
    near(r.underlying[1].ownershipPath[0].normalizedWeight,second);
    near(r.underlying[1].ownershipPath[0].appliedWeight,second/(.5+second));
    assert.equal(r.roundingAdjustments[0].evidenceType,'calculated');
  }
  for(const completeness of ['partial','unknown'] as const) {
    const r=run(data([snapshot('fundA',[holding('A',.5),holding('B',.4999)],{completeness})]));
    assert.equal(r.status,'PARTIAL'); near(r.unknownPortfolioWeight,.0001); assert.equal(r.roundingAdjustments.length,0);
  }
  const beyond=run(data([snapshot('fundA',[holding('A',.5),holding('B',.5002)])]));
  assert.equal(beyond.status,'UNKNOWN'); assert.equal(beyond.unresolved[0].reason,'overweight');
  const unverified=run(data([snapshot('fundA',[holding('A',.5),holding('B',.4999,{evidenceType:'estimated'})])]));
  assert.equal(unverified.roundingAdjustments.length,0); near(unverified.coveredPortfolioWeight,.5);
});
test('acceptance 5: historical 2025 TSMC40 and 2026 TSMC55 never use future holdings',()=>{
  const f=foundation(), past='2024-01-01';
  f.sources.forEach(s=>{s.retrievedAt=past;s.publishedAt=past;}); f.evidence.forEach(e=>e.observedAt=past);
  f.relationships.forEach(e=>{e.updatedAt=past;if(e.measurement)e.measurement.asOf=past;});
  const dated=(date:string,w:number)=>snapshot('fundA',[
    holding('A',w,{sourceDate:date,lastVerifiedAt:date}),holding('B',1-w,{sourceDate:date,lastVerifiedAt:date}),
  ],{id:date,asOfDate:date,sourceDate:date,lastVerifiedAt:date});
  const d=data([dated('2025-01-01',.4),dated('2026-01-01',.55)]);
  for(const [date,w] of [['2025-01-01',.4],['2026-01-01',.55]] as const) {
    const r=run(d,{...portfolio(),asOf:date},f); near(r.companyConcentration.buckets[0].combined,w);
    assert.equal(r.selectedSnapshots[0].asOfDate,date); assert.equal(r.status,'KNOWN');
  }
});
test('acceptance 6: direct and two valid ETF paths aggregate once per company',()=>{
  const p=portfolio(); p.positions=[{...p.positions[0],marketValue:40},{...p.positions[0],id:'pB',assetEntityId:'fundB',marketValue:30},{id:'direct',assetEntityId:'A',assetType:'stock',marketValue:30,valuationQuality:'known'}];
  const r=run(data([snapshot(),snapshot('fundB',[holding('A',.5),holding('C',.5)])]),p);
  const a=r.companyConcentration.buckets.filter(v=>v.companyEntityId==='companyA'); assert.equal(a.length,1);
  near(a[0].direct,.3); near(a[0].indirect,.24+.15); near(a[0].combined,.69);
  assert.equal(r.underlying.filter(v=>v.companyEntityId==='companyA').length,3);
  near(r.companyConcentration.buckets.reduce((sum,v)=>sum+v.combined,0),1);
});
test('acceptance 7: ownership plus technology/supply chain retains every evidenced dated edge',()=>{
  const f=foundation(); f.relationships.push(relation('tech-supply','tech','sub',{type:'DEPENDS_ON',dimension:'industry',nature:'INDIRECT',claim:'INFERRED',confidence:'medium',validFrom:early}));
  const r=run(data([snapshot('fundA',[holding('A',1)])]),portfolio(),f);
  const path=r.exposure.dimensions.industry.paths.find(v=>v.targetEntityId==='sub')!;
  assert.deepEqual(path.entityIds,['A','companyA','tech','sub']);
  assert.deepEqual(path.relationshipIds,['issuer-A','A-technology','tech-supply']);
  const owner=r.underlying.find(v=>v.id===path.positionId)!; assert.equal(owner.ownershipPath[0].asOfDate,early);
  assert.deepEqual(owner.ownershipPath[0].holding.evidenceIds,['evidence']);
  for(const step of path.steps) {
    assert.deepEqual(step.relationship.evidenceIds,['evidence']); assert.deepEqual(step.relationship.sourceIds,['source']);
    assert.equal(step.relationship.updatedAt,early); assert.equal(step.evidenceSupported,true);
  }
  assert.equal(path.steps[1].relationship.measurement!.asOf,early);
  assert.equal(path.confidence,'medium'); assert.equal(path.claim,'INFERRED'); assert.equal(path.knowledge,'QUALITATIVE');
});
test('acceptance 8: all five evidence qualities survive aggregation without promotion',()=>{
  for(const evidenceType of ['reported','calculated','estimated','inferred','unknown'] as const) {
    const h=holding('A',1,{evidenceType,confidence:'low',...(evidenceType==='calculated'?{calculation:{holdingMarketValue:100,fundNetAssetValue:100,currency:'TWD',asOfDate:early}}:{})});
    const r=run(data([snapshot('fundA',[h],{confidence:'medium'})]));
    assert.equal(r.selectedSnapshots[0].holdings[0].evidenceType,evidenceType);
    if(evidenceType==='reported' || evidenceType==='calculated') {
      near(r.coveredPortfolioWeight,1); assert.equal(r.underlying[0].evidenceType,'calculated');
      assert.equal(r.underlying[0].ownershipPath[0].holding.evidenceType,evidenceType);
      assert.equal(r.underlying[0].confidence,'low');
      assert.ok(r.exposure.dimensions.technology.paths.every(v=>v.confidence==='low'));
    } else {assert.equal(r.status,'UNKNOWN'); near(r.unknownPortfolioWeight,1); assert.equal(r.companyConcentration.buckets.length,0);}
  }
});
test('acceptance 9: A to B to C to A terminates without repeated financial exposure',()=>{
  const r=run(data([
    snapshot('fundA',[holding('A',.5),holding('fundB',.5,{assetType:'etf'})]),
    snapshot('fundB',[holding('fundC',1,{assetType:'etf'})]),snapshot('fundC',[holding('fundA',1,{assetType:'etf'})]),
  ]));
  near(r.coveredPortfolioWeight,.5); near(r.unknownPortfolioWeight,.5); assert.equal(r.underlying.length,1);
  const cycle=r.unresolved.filter(v=>v.reason==='cycle'); assert.equal(cycle.length,1);
  assert.deepEqual(cycle[0].ownershipPath.map(v=>v.etfAssetId),['fundA','fundB','fundC']);
  near(r.companyConcentration.buckets[0].combined,.5);
});
test('acceptance 10: additive financial100 differs from overlapping technology/theme160',()=>{
  const f=foundation();
  for(const dimension of ['technology','theme'] as const) {
    const id=`second-${dimension}`; f.entities.push({id,kind:dimension==='technology'?'Technology':'Theme',name:id});
    f.relationships.push(relation(id,'companyA',id,{dimension,measurement:{basis:'positionAllocation',quality:'known',fraction:1,asOf:early}}));
  }
  const r=run(data(),portfolio(),f);
  near(r.companyConcentration.buckets.reduce((sum,v)=>sum+v.combined,0),1);
  const industry=r.exposure.dimensions.industry.concentration!;
  near(industry.buckets.reduce((sum,v)=>sum+v.portfolioWeight,0),1); assert.equal(industry.overlapping,false);
  for(const dimension of ['technology','theme'] as const) {
    const c=r.exposure.dimensions[dimension].concentration!;
    near(c.buckets.reduce((sum,v)=>sum+v.portfolioWeight,0),1.6); near(c.coveredPortfolioWeight,1);
    assert.equal(c.overlapping,true); assert.equal(c.coverageBasis,'LOWER_BOUND_UNION');
  }
});

test('single ETF: quantities, company identity and complete provenance survive look-through',()=>{
  const r=run(); assert.equal(r.status,'KNOWN'); near(r.coveredPortfolioWeight,1);
  const a=r.underlying.find(p=>p.assetEntityId==='A')!;
  near(a.portfolioWeight,.6); assert.equal(a.companyEntityId,'companyA'); assert.equal(a.nature,'INDIRECT'); assert.equal(a.evidenceType,'calculated');
  assert.equal(a.ownershipPath[0].snapshotId,'fundA-snapshot'); assert.equal(a.ownershipPath[0].holding.evidenceType,'reported');
  assert.deepEqual(a.ownershipPath[0].holding.evidenceIds,['evidence']);
  assert.equal(r.companyConcentration.status,'KNOWN');
});
test('direct stock plus multiple ETFs combine once per owned slice; overlap is not subtracted',()=>{
  const p=portfolio(); p.positions=[{...p.positions[0],marketValue:40},{...p.positions[0],id:'pB',assetEntityId:'fundB',marketValue:30},{id:'direct',assetEntityId:'A',assetType:'stock',marketValue:30,valuationQuality:'known'}];
  const r=run(data([snapshot(),snapshot('fundB',[holding('A',.5),holding('C',.5)])]),p);
  const a=r.companyConcentration.buckets.find(b=>b.companyEntityId==='companyA')!;
  near(a.direct,.3); near(a.indirect,.39); near(a.combined,.69);
  near(r.companyConcentration.buckets.reduce((s,b)=>s+b.combined,0),1);
  near(r.overlaps[0].knownOverlap,.5); assert.equal(r.overlaps[0].status,'KNOWN');
});
test('several share classes of one company aggregate by issuer, not ticker',()=>{
  const f=foundation(); f.relationships.find(e=>e.id==='issuer-B')!.targetEntityId='companyA';
  const r=run(data(),portfolio(),f);
  assert.equal(r.companyConcentration.buckets.length,1); near(r.companyConcentration.buckets[0].combined,1);
});
test('multiple position lots do not create duplicate ETF comparison rows',()=>{
  const p=portfolio(); p.positions.push({...p.positions[0],id:'lot2'},{...p.positions[0],id:'pB',assetEntityId:'fundB'});
  const r=run(data([snapshot(),snapshot('fundB')]),p);
  assert.equal(r.overlaps.length,1); near(r.overlaps[0].knownOverlap,1); near(r.companyConcentration.coveredPortfolioWeight,1);
});
test('nested ETF multiplies only ownership weights and retains all ownership steps',()=>{
  const r=run(data([snapshot('fundA',[holding('fundB',.5,{assetType:'etf'}),holding('C',.5)]),snapshot('fundB')]));
  const a=r.underlying.find(p=>p.assetEntityId==='A')!;
  near(a.portfolioWeight,.3); assert.equal(a.ownershipPath.length,2);
  assert.deepEqual(a.ownershipPath.map(s=>s.etfAssetId),['fundA','fundB']);
  assert.equal(r.status,'KNOWN');
});
test('underlying classification uses the Foundation engine and conserves original denominator',()=>{
  const r=run(data([snapshot('fundA',[holding('A',.6)])]));
  for(const dim of ['industry','technology','geographic','theme'] as const) {
    const c=r.exposure.dimensions[dim].concentration!;
    assert.equal(c.status,'PARTIAL'); near(c.buckets[0].portfolioWeight,.6);
  }
  near(r.exposure.totalMarketValue,100);
  assert.deepEqual(r.exposure.dimensions.industry.paths[0].entityIds,['A','companyA','industry']);
});
test('supply-chain and sub-industry paths are retained qualitatively, not multiplied as holdings',()=>{
  const f=foundation();
  f.relationships.push(relation('supplier','companyA','companyB',{type:'DEPENDS_ON'}),relation('subindustry','industry','sub',{type:'PART_OF',dimension:'industry'}));
  const r=run(data(),portfolio(),f);
  assert.ok(r.exposure.dimensions.industry.paths.some(p=>p.entityIds.includes('companyB') && p.entityIds.includes('companyA') && p.knowledge==='QUALITATIVE'));
  assert.ok(r.exposure.dimensions.industry.paths.some(p=>p.targetEntityId==='sub'));
  near(r.companyConcentration.buckets.find(b=>b.companyEntityId==='companyB')!.combined,.4);
});
test('multiple technology memberships overlap without summing into a false allocation',()=>{
  const f=foundation(); f.entities.push({id:'tech2',kind:'Technology',name:'Technology 2'});
  f.relationships.push(relation('tech2-A','companyA','tech2',{dimension:'technology',measurement:{basis:'positionAllocation',quality:'known',fraction:1,asOf:early}}));
  const c=run(data(),portfolio(),f).exposure.dimensions.technology.concentration!;
  near(c.buckets.find(b=>b.entityId==='tech')!.portfolioWeight,1); near(c.buckets.find(b=>b.entityId==='tech2')!.portfolioWeight,.6);
  assert.equal(c.coverageBasis,'LOWER_BOUND_UNION'); near(c.coveredPortfolioWeight,1);
});
test('missing weight remains unknown and known portion is not rescaled',()=>{
  const r=run(data([snapshot('fundA',[holding('A',.6),holding('B',null)])]));
  assert.equal(r.status,'PARTIAL'); near(r.coveredPortfolioWeight,.6); near(r.unknownPortfolioWeight,.4);
  assert.ok(r.unresolved.some(p=>p.reason==='missingWeight' && p.fractionOfPosition===null));
  near(r.companyConcentration.buckets[0].combined,.6);
});
test('unknown holdings retain provenance but never become invented assets',()=>{
  const r=run(data([snapshot('fundA',[holding(null,1,{assetType:'unknown'})])]));
  assert.equal(r.status,'UNKNOWN'); assert.equal(r.underlying.length,0); near(r.unknownPortfolioWeight,1);
  assert.equal(r.selectedSnapshots[0].holdings[0].name,'Unknown holding');
});
test('stale snapshots remain inspectable but cannot produce current exact exposure',()=>{
  const r=run(data(),portfolio(),foundation(),{maxAgeDays:2});
  assert.equal(r.status,'UNKNOWN'); assert.equal(r.unresolved[0].reason,'stale'); assert.equal(r.selectedSnapshots.length,1);
  assert.deepEqual(r.companyConcentration.buckets,[]);
});
test('partial declaration is preserved even when supplied weights sum to one',()=>{
  const r=run(data([snapshot('fundA',undefined,{completeness:'partial'})]));
  assert.equal(r.status,'PARTIAL'); assert.equal(r.exposure.dimensions.industry.concentration?.status,'PARTIAL');
});
test('missing snapshot and empty snapshot never imply zero company risk',()=>{
  for(const d of [data([]),data([snapshot('fundA',[])])]) {
    const r=run(d); assert.equal(r.status,'UNKNOWN'); assert.equal(r.companyConcentration.status,'UNKNOWN');
    near(r.unknownPortfolioWeight,1); near(r.exposure.totalMarketValue,100);
  }
});
test('historical snapshot uses effective date; corrections require their publication/verification date',async()=>{
  const old=snapshot();
  const newer=snapshot('fundA',[holding('C',1,{sourceDate:'2026-09-15',lastVerifiedAt:'2026-09-15'})],{id:'new',asOfDate:'2026-09-15',sourceDate:'2026-09-15',lastVerifiedAt:'2026-09-15'});
  const correction={...old,id:'corrected',sourceDate:'2026-09-18',lastVerifiedAt:'2026-09-18',holdings:[holding('C',1)]};
  const repo=createEtfHoldingsRepository(data([old,newer,correction]),foundation());
  assert.equal((await repo.getSnapshot('fundA','2026-09-10'))!.id,old.id);
  assert.equal((await repo.getSnapshot('fundA','2026-09-10','2026-09-19'))!.id,'corrected');
  assert.equal((await repo.getSnapshot('fundA',asOf))!.id,'new');
  assert.equal((await repo.getHistory('fundA')).length,3);
  assert.equal(await repo.getSnapshot('fundA','2026-08-01'),null);
});
test('new partial snapshot supersedes old complete holdings instead of merging dates',()=>{
  const newer=snapshot('fundA',[holding('C',.2,{sourceDate:'2026-09-15',lastVerifiedAt:'2026-09-15'})],{id:'new',asOfDate:'2026-09-15',sourceDate:'2026-09-15',lastVerifiedAt:'2026-09-15',completeness:'partial'});
  const r=run(data([snapshot(),newer]));
  assert.deepEqual(r.underlying.map(p=>p.assetEntityId),['C']); near(r.coveredPortfolioWeight,.2);
});
test('percent conversion is explicit; overweight snapshots are rejected rather than normalized',()=>{
  const r=run(data([snapshot('fundA',[holding('A',60,{weightUnit:'percent'}),holding('B',40,{weightUnit:'percent'})])]));
  near(r.underlying[0].fractionOfPosition,.6);
  const bad=run(data([snapshot('fundA',[holding('A',.8),holding('B',.5)])]));
  assert.equal(bad.status,'UNKNOWN'); assert.equal(bad.unresolved[0].reason,'overweight');
});
test('complete rounding correction is disclosed; zero weights create no phantom positions',()=>{
  const r=run(data([snapshot('fundA',[holding('A',.3333),holding('B',.6666),holding('C',0)])]));
  assert.equal(r.status,'KNOWN'); near(r.unknownPortfolioWeight,0); assert.equal(r.underlying.length,2);
  near(r.roundingAdjustments[0].reportedTotal,.9999); near(r.underlying[0].portfolioWeight,1/3);
});
test('equity-sleeve weights are not treated as fund net asset weights',()=>{
  const r=run(data([snapshot('fundA',[holding('A',1,{weightBasis:'equitySleeve'})])]));
  assert.equal(r.status,'UNKNOWN'); assert.ok(r.unresolved.some(p=>p.reason==='unsupportedBasis'));
});
test('estimated and inferred weights never enter known quantitative buckets',()=>{
  for(const evidenceType of ['estimated','inferred','unknown'] as const) {
    const r=run(data([snapshot('fundA',[holding('A',1,{evidenceType})])]));
    assert.equal(r.status,'UNKNOWN'); assert.deepEqual(r.companyConcentration.buckets,[]);
    assert.equal(r.unresolved[0].knowledge,evidenceType==='estimated'?'ESTIMATED':evidenceType==='inferred'?'QUALITATIVE':'UNKNOWN');
  }
});
test('calculated inputs require reproducible arithmetic, not merely a calculated label',()=>{
  const h=holding('A',1,{evidenceType:'calculated'});
  assert.equal(run(data([snapshot('fundA',[h])])).status,'UNKNOWN');
  h.calculation={holdingMarketValue:50,fundNetAssetValue:50,currency:'USD',asOfDate:early};
  assert.equal(run(data([snapshot('fundA',[h])])).status,'KNOWN');
  h.calculation.holdingMarketValue=40;
  assert.throws(()=>run(data([snapshot('fundA',[h])])),/calculated weight mismatch/);
});
test('ETF cycles and traversal limits terminate with partial known branches',()=>{
  const d=data([snapshot('fundA',[holding('fundB',.5,{assetType:'etf'}),holding('A',.5)]),snapshot('fundB',[holding('fundA',1,{assetType:'etf'})])]);
  const r=run(d); assert.equal(r.status,'PARTIAL'); near(r.coveredPortfolioWeight,.5); assert.ok(r.unresolved.some(p=>p.reason==='cycle'));
  assert.ok(run(d,portfolio(),foundation(),{maxDepth:1}).unresolved.some(p=>p.reason==='limit'));
  assert.ok(run(data(),portfolio(),foundation(),{maxNodesPerPosition:1}).unresolved.some(p=>p.reason==='limit'));
});
test('unknown valuation does not use known partial portfolio value as denominator',()=>{
  const p=portfolio(); p.positions.push({id:'missing',assetEntityId:'A',assetType:'stock',marketValue:null,valuationQuality:'unknown'});
  const r=run(data(),p); assert.equal(r.coveredPortfolioWeight,null); assert.equal(r.companyConcentration.status,'UNKNOWN');
  assert.ok(r.underlying.every(p=>p.portfolioWeight===null));
});
test('partial overlap is explicitly a lower bound; absent holdings is UNKNOWN not zero',()=>{
  const p=portfolio(); p.positions.push({...p.positions[0],id:'pB',assetEntityId:'fundB'});
  const r=run(data([snapshot(),snapshot('fundB',[holding('A',.2)])]),p);
  assert.equal(r.overlaps[0].status,'PARTIAL'); near(r.overlaps[0].knownOverlap,.2);
  const missing=run(data(),p); assert.equal(missing.overlaps[0].status,'UNKNOWN'); assert.equal(missing.overlaps[0].knownOverlap,null);
});
test('confidence propagates by weakest level, never by multiplying probabilities',()=>{
  const r=run(data([snapshot('fundA',[holding('A',1,{confidence:'low'})],{confidence:'medium'})]));
  assert.equal(r.underlying[0].confidence,'low'); near(r.underlying[0].portfolioWeight,1);
  assert.equal(r.exposure.dimensions.industry.paths[0].confidence,'low');
  assert.equal(run(data([snapshot('fundA',[holding('A',1,{confidence:'unknown'})])])).status,'UNKNOWN');
});
test('future evidence cannot support snapshot known at an earlier date',()=>{
  const f=foundation(); f.sources[0].retrievedAt='2026-10-01';
  assert.equal(run(data(),portfolio(),f).status,'UNKNOWN');
});
test('ambiguous company identities never invent a company concentration',()=>{
  const f=foundation(); f.relationships.push(relation('ambiguous','A','companyC',{type:'ISSUED_BY'}));
  const r=run(data(),portfolio(),f); assert.equal(r.companyConcentration.status,'PARTIAL');
  assert.equal(r.underlying.find(p=>p.assetEntityId==='A')!.companyEntityId,null);
  near(r.exposure.dimensions.industry.concentration!.coveredPortfolioWeight,.4);
});
test('unresolved share-class identity marks overlap partial even with complete fund weights',()=>{
  const f=foundation(); f.relationships=f.relationships.filter(e=>e.type!=='ISSUED_BY');
  const p=portfolio(); p.positions.push({...p.positions[0],id:'pB',assetEntityId:'fundB'});
  const r=run(data([snapshot(),snapshot('fundB',[holding('C',1)])]),p,f);
  assert.equal(r.overlaps[0].status,'PARTIAL'); near(r.overlaps[0].knownOverlap,0);
});
test('nested stale fund preserves unrelated known ownership and residual value',()=>{
  const recent='2026-09-19';
  const r=run(data([snapshot('fundA',[holding('fundB',.5,{assetType:'etf',sourceDate:recent,lastVerifiedAt:recent}),holding('A',.5,{sourceDate:recent,lastVerifiedAt:recent})],{asOfDate:recent,sourceDate:recent,lastVerifiedAt:recent}),snapshot('fundB')]),portfolio(),foundation(),{maxAgeDays:2});
  assert.equal(r.status,'PARTIAL'); near(r.coveredPortfolioWeight,.5); near(r.exposure.totalMarketValue,100);
});
test('empty portfolios, missing issuer and cash residuals remain finite and explicit',()=>{
  assert.equal(run(data(),{...portfolio(),positions:[]}).status,'UNKNOWN');
  const r=run(data([snapshot('fundA',[holding('A',.8),holding('cash',.2,{assetType:'cash'})])]));
  assert.equal(r.status,'KNOWN'); assert.equal(r.companyConcentration.status,'PARTIAL'); near(r.companyConcentration.coveredPortfolioWeight,.8);
});
test('nested fund cannot be mislabeled as a stock to bypass look-through guards',()=>{
  assert.throws(()=>run(data([snapshot('fundA',[holding('fundB',1)]),snapshot('fundB')])),/mislabeled/);
});
test('bad weights, duplicate holdings, broken evidence and ambiguous revisions fail validation',()=>{
  for(const w of [-.1,NaN,Infinity,1.1]) assert.throws(()=>run(data([snapshot('fundA',[holding('A',w)])])));
  assert.throws(()=>run(data([snapshot('fundA',[holding('A',.5),holding('A',.5,{id:'duplicate'})])])),/duplicate/);
  assert.throws(()=>run(data([snapshot('fundA',[holding('A',1,{evidenceIds:['missing']})])])),/evidence/);
  assert.throws(()=>run(data([snapshot(),{...snapshot(),id:'duplicate'}])),/ambiguous/);
});
test('repository/history and result snapshots are isolated from mutation',async()=>{
  const d=data(),f=foundation(),p=portfolio(),before=structuredClone({d,f,p});
  const repo=createEtfHoldingsRepository(d,f);
  const r=run(d,p,f); r.selectedSnapshots[0].holdings[0].weight=0;
  (await repo.getHistory('fundA'))[0].holdings.length=0;
  assert.equal((await repo.getSnapshot('fundA',asOf))!.holdings.length,2);
  assert.deepEqual({d,f,p},before);
});
test('legacy portfolio adapter and no-option 3B.1 output remain compatible',()=>{
  const p=portfolio(),f=foundation();
  const {positions:_,...meta}=p;
  const adapted=adaptLegacyPortfolio([{id:'pA',symbol:'TEST_ETF',shares:1,avgCost:70,buyDate:early}],meta,{pA:{assetEntityId:'fundA',assetType:'etf',marketValue:100,valuationQuality:'known'}});
  assert.deepEqual(adapted,p);
  const old=calculatePortfolioExposure(p,f); assert.equal(old.lookThrough,undefined);
  const next=calculatePortfolioExposure(p,f,{etf:{dataset:data()}}); const {lookThrough:__,...withoutExtension}=next;
  assert.deepEqual(withoutExtension,old); assert.equal(next.lookThrough!.status,'KNOWN');
});
