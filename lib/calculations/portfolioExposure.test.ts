import test from 'node:test';
import assert from 'node:assert/strict';
import { calculatePortfolioExposure } from './portfolioExposure';
import { calculatePortfolio } from './portfolioMath';
import { createExposureRepository } from '../services/exposureRepository';
import { adaptLegacyPortfolio } from '../utils/portfolioExposureAdapter';
import type { ExposureDataset, ExposureRelationship, ExposureDimension } from '../types/exposure';
import type { ExposurePortfolioSnapshot } from '../types/portfolioExposure';
import type { Security } from '../types';

const date='2026-09-01T00:00:00Z';
function edge(id='a-sector', source='a', target='sector', dimension:ExposureDimension|undefined='sector', override:Partial<ExposureRelationship>={}):ExposureRelationship {
  return {id,sourceEntityId:source,targetEntityId:target,type:'EXPOSED_TO',nature:'DIRECT',dimension,
    strength:'high',confidence:'high',claim:'REPORTED',rationale:'Fixture relationship, not production data',
    evidenceIds:['e'],sourceIds:['s'],counterEvidenceIds:[],invalidationConditions:['分類來源修訂'],updatedAt:date,...override};
}
function dataset(relationships:ExposureRelationship[]=[edge()]):ExposureDataset {
  return {version:'test-v1',entities:[{id:'a',kind:'Asset',name:'A'},{id:'b',kind:'Asset',name:'B'},
    {id:'sector',kind:'Sector',name:'Sector'},{id:'industry',kind:'Industry',name:'Industry'},
    {id:'accelerator',kind:'Technology',name:'Accelerator'},{id:'infra',kind:'Theme',name:'Infrastructure'},
    {id:'dc',kind:'Theme',name:'Data center'},{id:'country',kind:'Country',name:'Country'},
    {id:'currency',kind:'Currency',name:'Currency'},{id:'commodity',kind:'Commodity',name:'Commodity'},
    {id:'rate',kind:'MacroFactor',name:'Rate'},{id:'policy',kind:'Policy',name:'Policy'}],relationships,
    evidence:[{id:'e',sourceId:'s',excerpt:'Synthetic test evidence',observedAt:date}],
    sources:[{id:'s',title:'Test source',url:'https://example.com/evidence',retrievedAt:date}]};
}
function portfolio():ExposurePortfolioSnapshot {
  return {portfolioId:'test',version:'1',baseCurrency:'TWD',asOf:date,positions:[
    {id:'p1',assetEntityId:'a',assetType:'stock',marketValue:60,valuationQuality:'known'},
    {id:'p2',assetEntityId:'b',assetType:'stock',marketValue:40,valuationQuality:'known'},
  ]};
}
const allocation=(fraction=1):ExposureRelationship['measurement']=>({basis:'positionAllocation',quality:'known',fraction,asOf:date});
const run=(data=dataset(),p=portfolio(),options={})=>calculatePortfolioExposure(p,data,options);

test('direct exposure retains evidence, no invented percentage for qualitative relationship',()=>{
  const result=run(); const path=result.dimensions.sector.paths[0];
  assert.equal(path.nature,'DIRECT'); assert.equal(path.claim,'REPORTED'); assert.equal(path.knowledge,'QUALITATIVE');
  assert.deepEqual(path.sourceIds,['s']); assert.deepEqual(path.invalidationConditions,['分類來源修訂']);
  assert.equal(result.dimensions.sector.concentration?.status,'UNKNOWN');
  assert.equal(result.dimensions.sector.coverage.portfolioWeight,.6);
});
test('indirect relationship cannot masquerade as a fact',()=>{
  assert.throws(()=>run(dataset([edge('x','a','sector','sector',{nature:'INDIRECT',claim:'FACT'})])),/indirect factual/);
  const path=run(dataset([edge('x','a','sector','sector',{nature:'INDIRECT',claim:'INFERRED'})])).dimensions.sector.paths[0];
  assert.equal(path.nature,'INDIRECT'); assert.equal(path.knowledge,'QUALITATIVE');
});
test('multi-hop retains full path, weakest confidence and strength without multiplying them',()=>{
  const result=run(dataset([
    edge('1','a','accelerator','technology'),
    edge('2','accelerator','infra','theme',{confidence:'medium',strength:'low'}),
    edge('3','infra','dc','theme'),
  ]));
  const path=result.dimensions.theme.paths.find(p=>p.targetEntityId==='dc')!;
  assert.deepEqual(path.entityIds,['a','accelerator','infra','dc']); assert.deepEqual(path.relationshipIds,['1','2','3']);
  assert.equal(path.depth,3); assert.equal(path.nature,'INDIRECT'); assert.equal(path.claim,'INFERRED');
  assert.equal(path.confidence,'medium'); assert.equal(path.strength,'low');
  assert.equal(path.evidenceCoverage.fraction,1); assert.equal(path.knowledge,'QUALITATIVE');
});
test('missing edge evidence yields UNKNOWN with partial evidence coverage',()=>{
  const result=run(dataset([edge('1','a','accelerator','technology'),edge('2','accelerator','infra','theme',{evidenceIds:[],sourceIds:[]})]));
  const path=result.dimensions.theme.paths[0];
  assert.equal(path.knowledge,'UNKNOWN'); assert.equal(path.confidence,'unknown');
  assert.equal(path.evidenceCoverage.fraction,.5); assert.equal(result.dimensions.theme.coverage.status,'UNKNOWN');
});
test('partial coverage preserves unknown positions instead of declaring zero exposure',()=>{
  const c=run().dimensions.sector.coverage;
  assert.equal(c.status,'PARTIAL'); assert.deepEqual(c.unknownPositionIds,['p2']);
  assert.equal(c.coveredPositions,1); assert.equal(c.totalPositions,2);
  assert.equal(run().dimensions.currency.coverage.status,'UNKNOWN');
});
test('missing entity data and no relationships are supported unknowns',()=>{
  const d=dataset([]); d.entities=d.entities.filter(e=>e.id!=='a');
  assert.equal(run(d).dimensions.sector.coverage.status,'UNKNOWN');
});
test('duplicate relationship IDs and equivalent edges do not duplicate exposure',()=>{
  const e=edge(); const result=run(dataset([e,{...e},{...e,id:'duplicate'}]));
  assert.equal(result.dimensions.sector.paths.length,1);
  assert.throws(()=>run(dataset([e,{...e,confidence:'low'}])),/conflicting relationship/);
});
test('cycle protection terminates while preserving simple paths',()=>{
  const result=run(dataset([edge('1','a','infra','theme'),edge('2','infra','dc','theme'),edge('3','dc','infra','theme')]));
  assert.equal(result.dimensions.theme.paths.length,2); assert.equal(result.truncated,false);
});
test('depth and work budgets report truncation and never claim complete coverage',()=>{
  const d=dataset([edge('1','a','infra','theme'),edge('2','infra','dc','theme')]);
  assert.equal(run(d,portfolio(),{maxDepth:1}).truncated,true);
  assert.equal(run(d,portfolio(),{maxPathsPerPosition:1}).truncated,true);
  assert.throws(()=>run(d,portfolio(),{maxDepth:99}),/limits/);
});
test('position weights and complete sector/industry concentration are deterministic',()=>{
  const d=dataset([edge('1','a','sector','sector',{measurement:allocation()}),edge('2','b','sector','sector',{measurement:allocation()}),
    edge('3','a','industry','industry',{measurement:allocation()}),edge('4','b','industry','industry',{measurement:allocation()})]);
  const r=run(d);
  assert.deepEqual(r.positionWeights,[{positionId:'p1',weight:.6},{positionId:'p2',weight:.4}]);
  for(const dim of ['sector','industry'] as const) {
    assert.equal(r.dimensions[dim].concentration?.status,'KNOWN');
    assert.equal(r.dimensions[dim].concentration?.buckets[0].portfolioWeight,1);
  }
});
test('partial allocation is not normalized to 100 percent',()=>{
  const c=run(dataset([edge('1','a','sector','sector',{measurement:allocation(.5)})])).dimensions.sector.concentration!;
  assert.equal(c.buckets[0].portfolioWeight,.3); assert.equal(c.coveredPortfolioWeight,.3); assert.equal(c.status,'PARTIAL');
});
test('revenue shares and estimated measurements never become allocation concentration',()=>{
  for(const measurement of [{...allocation()!,basis:'revenueShare' as const},{...allocation()!,quality:'estimated' as const}]) {
    const r=run(dataset([edge('1','a','sector','sector',{measurement})]));
    assert.equal(r.dimensions.sector.concentration?.status,'UNKNOWN');
    assert.equal(r.dimensions.sector.paths[0].measurements[0].measurement.basis,measurement.basis);
    assert.equal(r.dimensions.sector.paths[0].knowledge,measurement.quality==='estimated'?'ESTIMATED':'KNOWN_QUANTITATIVE');
  }
});
test('overlapping themes are separate buckets, never summed into allocation',()=>{
  const r=run(dataset([edge('1','a','infra','theme',{measurement:allocation()}),edge('2','a','dc','theme',{measurement:allocation()})]));
  const c=r.dimensions.theme.concentration!;
  assert.equal(c.overlapping,true); assert.equal(c.buckets.length,2);
  assert.equal(c.coverageBasis,'LOWER_BOUND_UNION');
  assert.equal(c.coveredPortfolioWeight,.6); assert.ok(c.buckets.every(b=>b.portfolioWeight===.6));
});
test('conflicting allocation observations are excluded, not averaged',()=>{
  const c=run(dataset([edge('1','a','sector','sector',{measurement:allocation(.4)}),edge('2','a','sector','sector',{measurement:allocation(.7)})])).dimensions.sector.concentration!;
  assert.equal(c.status,'UNKNOWN'); assert.deepEqual(c.buckets,[]);
});
test('exclusive sector allocations exceeding 100 percent are unknown',()=>{
  const d=dataset([edge('1','a','sector','sector',{measurement:allocation(.8)}),edge('2','a','sector2','sector',{measurement:allocation(.8)})]);
  d.entities.push({id:'sector2',kind:'Sector',name:'Second sector'});
  const c=run(d).dimensions.sector.concentration!;
  assert.equal(c.status,'UNKNOWN'); assert.deepEqual(c.buckets,[]);
});
test('cash and ETF positions retain valuations without inventing underlying assets',()=>{
  const p=portfolio(); p.positions[0].assetType='cash'; p.positions[1].assetType='etf';
  const r=run(dataset([edge('cash-currency','a','currency','currency')]),p);
  assert.equal(r.positionWeights[0].weight,.6);
  assert.equal(r.dimensions.currency.paths.length,1);
  assert.deepEqual(r.dimensions.sector.coverage.unknownPositionIds,['p1','p2']);
});
test('future-demand entities can be represented but no relationships are invented',()=>{
  const d=dataset([]);
  for(const kind of ['FutureDemand','EmergingTechnology','WeakSignal','Bottleneck','CapacityConstraint','DemandDriver'] as const) d.entities.push({id:kind,kind,name:kind});
  assert.ok(Object.values(run(d).dimensions).every(d=>d.paths.length===0));
});
test('invalid provenance and future measurement cannot create known concentration',()=>{
  assert.throws(()=>run(dataset([edge('x','a','sector','sector',{sourceIds:[]})])),/source mismatch/);
  const d=dataset(); d.sources[0].url='javascript:alert(1)'; assert.throws(()=>run(d),/source URL/);
  const r=run(dataset([edge('x','a','sector','sector',{measurement:{...allocation()!,asOf:'2027-01-01'}})]));
  assert.equal(r.dimensions.sector.concentration?.status,'UNKNOWN');
});
test('duplicate paths into a target do not multiply position coverage',()=>{
  const c=run(dataset([edge('1','a','infra','theme'),edge('2','a','accelerator','technology'),edge('3','accelerator','infra','theme')])).dimensions.theme;
  assert.equal(c.paths.length,2); assert.equal(c.coverage.portfolioWeight,.6);
});
test('unpriced/estimated portfolio never uses a partial valuation denominator',()=>{
  for(const value of [null,40]) {
    const p=portfolio(); p.positions[1].marketValue=value; p.positions[1].valuationQuality=value===null?'unknown':'estimated';
    const r=run(dataset(),p); assert.equal(r.totalMarketValue,null); assert.equal(r.valuationStatus,'PARTIAL');
    assert.ok(r.positionWeights.every(w=>w.weight===null)); assert.equal(r.dimensions.sector.coverage.portfolioWeight,null);
  }
});
test('empty and zero portfolios produce no NaN and no invented weights',()=>{
  for(const positions of [[],portfolio().positions.map(p=>({...p,marketValue:0}))]) {
    const r=run(dataset(),{...portfolio(),positions}); assert.equal(r.totalMarketValue,0);
    assert.ok(r.positionWeights.every(p=>p.weight===null)); assert.equal(r.dimensions.sector.concentration?.status,'UNKNOWN');
  }
});
test('future, expired relationships and future evidence do not support current exposure',()=>{
  for(const override of [{validFrom:'2027-01-01'},{validTo:date},{updatedAt:'2027-01-01'}]) assert.equal(run(dataset([edge('x','a','sector','sector',override)])).dimensions.sector.paths.length,0);
  const d=dataset(); d.evidence[0].observedAt='2027-01-01';
  assert.equal(run(d).dimensions.sector.paths[0].knowledge,'UNKNOWN');
});
test('hypotheses, speculation and counter-evidence are never confirmed quantitative exposure',()=>{
  for(const claim of ['HYPOTHESIS','SPECULATIVE'] as const) {
    const r=run(dataset([edge('x','a','sector','sector',{claim,measurement:allocation()})]));
    assert.equal(r.dimensions.sector.paths[0].knowledge,'QUALITATIVE'); assert.equal(r.dimensions.sector.coverage.status,'UNKNOWN');
  }
  const r=run(dataset([edge('x','a','sector','sector',{counterEvidenceIds:['e'],measurement:allocation()})]));
  assert.equal(r.dimensions.sector.paths[0].confidence,'low'); assert.equal(r.dimensions.sector.paths[0].knowledge,'QUALITATIVE');
});
test('all nine dimensions supported without inferring missing categories',()=>{
  const targets={sector:'sector',industry:'industry',geographic:'country',currency:'currency',commodity:'commodity',interestRate:'rate',policy:'policy',technology:'accelerator',theme:'infra'};
  const d=dataset(Object.entries(targets).map(([dim,target])=>edge(dim,'a',target,dim as ExposureDimension)));
  const r=run(d); for(const value of Object.values(r.dimensions)) assert.equal(value.paths.length,1);
});
test('causal dependencies are inferred; competition and ETF look-through are not traversed',()=>{
  const d=dataset([edge('1','a','infra','theme',{type:'DEPENDS_ON'}),edge('2','a','sector','sector',{type:'COMPETES_WITH'}),
    edge('3','a','b',undefined,{type:'PART_OF',dimension:undefined}),edge('4','b','industry','industry')]);
  const r=run(d); assert.equal(r.dimensions.theme.paths[0].claim,'INFERRED');
  assert.equal(r.dimensions.sector.paths.length,0); assert.equal(r.dimensions.industry.paths.filter(p=>p.positionId==='p1').length,0);
});
test('repository snapshots and calculations do not mutate caller data',async()=>{
  const d=dataset(); const original=structuredClone(d); const repo=createExposureRepository(d);
  d.entities[0].name='changed'; const first=await repo.getSnapshot(); first.relationships.length=0;
  assert.deepEqual(await repo.getSnapshot(),original);
  const p=portfolio(), before=structuredClone(p); run(original,p); assert.deepEqual(p,before); assert.deepEqual(await repo.getSnapshot(),original);
});
test('invalid references, ranges, dates and negative positions fail explicitly',()=>{
  assert.throws(()=>run(dataset([edge('x','missing')])));
  assert.throws(()=>run(dataset([edge('x','a','sector','sector',{evidenceIds:['missing']})])));
  assert.throws(()=>run(dataset([edge('x','a','sector','sector',{measurement:allocation(1.1)})])));
  assert.throws(()=>run(dataset([edge('x','a','sector','theme')])));
  assert.throws(()=>run(dataset([edge('x','a','sector','sector',{validFrom:'invalid'})])));
  const p=portfolio(); p.positions[0].marketValue=-1; assert.throws(()=>run(dataset(),p));
});
test('legacy adapter preserves existing holdings/P&L and requires explicit asset mapping',()=>{
  const holdings=[{id:'p1',symbol:'TEST',shares:10,avgCost:4,buyDate:date}];
  const security:Security={symbol:'TEST',name:'Test',market:'TW',type:'stock',currency:'TWD',price:6,change:1,changePercent:0,sector:'test',dividendYield:0,updatedAt:date};
  const before=calculatePortfolio(holdings,[security],{TWD:1,USD:32});
  const {positions:_,...meta}=portfolio();
  const snapshot=adaptLegacyPortfolio(holdings,meta,{p1:{assetEntityId:'a',assetType:'stock',marketValue:before.rows[0].twdValue,valuationQuality:'known'}});
  assert.equal(run(dataset(),snapshot).positionWeights[0].weight,1);
  assert.deepEqual(calculatePortfolio(holdings,[security],{TWD:1,USD:32}),before);
  assert.throws(()=>adaptLegacyPortfolio(holdings,meta,{}),/Missing exposure mapping/);
});
test('unknown confidence cannot produce known quantitative concentration',()=>{
  const r=run(dataset([edge('1','a','sector','sector',{confidence:'unknown',measurement:allocation()})]));
  assert.equal(r.dimensions.sector.paths[0].knowledge,'UNKNOWN');
  assert.equal(r.dimensions.sector.coverage.status,'UNKNOWN');
  assert.equal(r.dimensions.sector.concentration?.status,'UNKNOWN');
  assert.deepEqual(r.dimensions.sector.concentration?.buckets,[]);
});
test('semantic duplicate edges are deduplicated regardless of object key order',()=>{
  const original=edge();
  const reordered=Object.fromEntries(Object.entries(original).reverse()) as unknown as ExposureRelationship;
  assert.equal(run(dataset([original,reordered,{...reordered,id:'another'}])).dimensions.sector.paths.length,1);
});
test('each multi-hop edge preserves independent evidence and immutable relationship metadata',()=>{
  const d=dataset([edge('1','a','accelerator','technology'),edge('2','accelerator','infra','theme',{evidenceIds:[],sourceIds:[]})]);
  const p=run(d).dimensions.theme.paths[0];
  assert.deepEqual(p.steps.map(s=>s.evidenceSupported),[true,false]);
  assert.deepEqual(p.steps[0].relationship.evidenceIds,['e']);
  assert.deepEqual(p.steps[1].relationship.evidenceIds,[]);
  p.steps[0].relationship.evidenceIds.length=0;
  assert.deepEqual(d.relationships[0].evidenceIds,['e']);
});
