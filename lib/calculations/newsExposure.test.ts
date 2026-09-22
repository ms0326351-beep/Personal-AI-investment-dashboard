import test from 'node:test';
import assert from 'node:assert/strict';
import type { NewsItem } from '../types';
import type { ExposureDataset, ExposureRelationship } from '../types/exposure';
import type { ExposurePortfolioSnapshot } from '../types/portfolioExposure';
import type { EtfDataset, EtfProvenance } from '../types/etfExposure';
import type { NewsExposureCatalog, NewsExposureEvent, TransmissionRule } from '../types/newsExposure';
import { calculateNewsPortfolioIntelligence } from './newsExposure';
import { calculatePortfolioExposure } from './portfolioExposure';
import { createExposureRepository } from '../services/exposureRepository';
import { createNewsExposureEvent, createNewsExposureService } from '../services/newsExposureService';
import type { MarketImpactAnalysis } from '../types/newsAnalysis';

const date='2026-09-21', before='2026-09-20';
const relation=(id:string,source:string,target:string,extra:Partial<ExposureRelationship>={}):ExposureRelationship=>({id,sourceEntityId:source,targetEntityId:target,type:'DEPENDS_ON',nature:'DIRECT',strength:'high',confidence:'high',claim:'REPORTED',rationale:'Reviewed synthetic dependency',evidenceIds:['e'],sourceIds:['s'],counterEvidenceIds:[],invalidationConditions:['Dependency replaced'],updatedAt:before,...extra});
function foundation():ExposureDataset {
  return {version:'f1',entities:[
    ...['assetA','assetB','assetC','etf'].map(id=>({id,name:id,kind:'Asset' as const})),
    ...['A','B','C'].map(id=>({id,name:id,kind:'Company' as const})),
    {id:'AI',kind:'Technology',name:'Compute technology'}, {id:'grid',kind:'FutureDemand',name:'Grid demand'},
    {id:'industry',kind:'Industry',name:'Industry'}, {id:'theme',kind:'Theme',name:'Theme'},
  ],sources:[{id:'s',title:'Synthetic fixture',url:'https://example.com/evidence',retrievedAt:before,publishedAt:before}],
  evidence:[{id:'e',sourceId:'s',excerpt:'Reviewed fixture, not real financial data',observedAt:before}],
  relationships:[
    ...['A','B','C'].map(id=>relation(`issuer-${id}`,`asset${id}`,id,{type:'ISSUED_BY'})),
    relation('supplier','B','A',{type:'SUPPLIES'}), relation('power','C','B',{type:'SUPPLIES'}),
    relation('tech','B','AI'), relation('grid-demand','AI','grid',{type:'ENABLED_BY',nature:'INDIRECT',claim:'INFERRED'}),
    relation('grid-supplier','C','grid',{type:'SUPPLIES'}),
    ...['A','B','C'].flatMap(id=>(['industry','theme'] as const).map(d=>relation(`${id}-${d}`,id,d,{type:'PART_OF',dimension:d,measurement:{basis:'positionAllocation',quality:'known',fraction:1,asOf:before}}))),
  ]};
}
function rule(relationshipId:string,extra:Partial<TransmissionRule>={}):TransmissionRule {
  return {relationshipId,traversal:'reverse',relationshipType:'customer_to_supplier',sensitivity:'same',rationale:'Conditional demand transmission, not proven price causation',evidenceIds:['e'],sourceIds:['s'],confidence:'high',asOf:before,invalidationConditions:['Order conversion fails'],...extra};
}
const catalog=():NewsExposureCatalog=>({version:'c1',bindings:[{entityId:'A',aliases:['Acme'],symbol:'A'},{entityId:'AI',aliases:['Compute technology']},{entityId:'grid',aliases:['Grid demand']}],rules:[rule('supplier'),rule('power')]});
const news=():NewsItem=>({id:'rss-fixture',title:'Acme announces additional orders',summary:'Acme publishes its order update.',source:'Fixture source',url:'https://example.com/news',publishedAt:before,relatedSymbols:['A'],origin:'rss'});
const event=():NewsExposureEvent=>({news:news(),observedAt:before,anchors:[{entityId:'A',mention:'Acme',direction:'positive',confidence:'high'}]});
function portfolio(assets=['assetA','assetB','assetC']):ExposurePortfolioSnapshot {
  return {portfolioId:'p',version:'1',asOf:date,baseCurrency:'TWD',positions:assets.map((id,i)=>({id:`p${i}`,assetEntityId:id,assetType:id==='etf'?'etf':'stock',marketValue:100,valuationQuality:'known'}))};
}
const provenance=():EtfProvenance=>({sourceIds:['s'],evidenceIds:['e'],sourceDate:before,lastVerifiedAt:before,confidence:'high',evidenceType:'reported',dataQuality:'verified'});
function etf():EtfDataset {return {version:'etf1',snapshots:[{...provenance(),id:'snapshot',etfAssetId:'etf',asOfDate:before,completeness:'complete',holdings:[
  {...provenance(),id:'b',underlyingAssetId:'assetB',ticker:'B',name:'Supplier B',assetType:'stock',weight:.6,weightUnit:'fraction',weightBasis:'netAssets'},
  {...provenance(),id:'c',underlyingAssetId:'assetC',ticker:'C',name:'Infrastructure C',assetType:'stock',weight:.4,weightUnit:'fraction',weightBasis:'netAssets'},
]}]};}
const run=(e=event(),p=portfolio(),f=foundation(),c=catalog(),options:Parameters<typeof calculateNewsPortfolioIntelligence>[4]={})=>{
  const r=calculateNewsPortfolioIntelligence(e,p,f,c,options);
  assert.ok(r.portfolioExposure,'Fixture should pass input validation');
  return {...r,portfolioExposure:r.portfolioExposure};
};
const near=(actual:number|null,expected:number)=>assert.ok(actual!==null && Math.abs(actual-expected)<1e-10,`${actual} != ${expected}`);

test('direct company: reported mention and inferred direction remain separate',()=>{
  const r=run(); const a=r.paths.find(p=>p.targetEntityId==='A')!;
  assert.equal(a.basis,'reported');assert.equal(a.impactBasis,'inferred');assert.equal(a.nature,'direct');assert.equal(a.order,'first_order');
  assert.equal(r.holdings[0].direct,true);near(r.holdings[0].connectedPortfolioWeight,1/3);
  assert.equal(r.connections[0].ownershipSteps[0].relationshipType,'issuer_identity');
});
test('second-order supplier uses reviewed reverse traversal, preserves original relationship',()=>{
  const r=run();const b=r.paths.find(p=>p.targetEntityId==='B')!;
  assert.deepEqual(b.entityIds,['A','B']);assert.equal(b.order,'second_order');assert.equal(b.direction,'positive');
  assert.equal(b.steps[1].relationship!.sourceEntityId,'B');assert.equal(b.steps[1].source,'A');
  assert.equal(b.steps[1].rule!.traversal,'reverse');assert.equal(b.basis,'inferred');assert.equal(b.confidence,'medium');
});
test('third-order infrastructure preserves source and date on every hop',()=>{
  const r=run();const c=r.paths.find(p=>p.targetEntityId==='C')!;
  assert.deepEqual(c.entityIds,['A','B','C']);assert.equal(c.order,'third_order_or_more');assert.equal(c.depth,3);
  assert.equal(c.confidence,'low');assert.equal(c.evidenceCoverage.fraction,1);
  assert.ok(c.steps.every(s=>s.evidence.length && s.evidenceSource.length && s.asOf===before && s.invalidationConditions.length));
});
test('ETF look-through: supplier and infrastructure slices sum once, not graph path weights',()=>{
  const r=run(event(),portfolio(['etf']),foundation(),catalog(),{etf:{dataset:etf()}});
  near(r.holdings[0].connectedPortfolioWeight,1);assert.equal(r.holdings[0].direct,false);assert.equal(r.holdings[0].indirect,true);
  const b=r.connections.find(c=>c.ownership.companyEntityId==='B')!;
  near(b.ownership.portfolioWeight,.6);assert.deepEqual(b.ownershipSteps.map(s=>s.relationshipType),['issuer_identity','ETF_holding','portfolio_holding']);
  assert.equal(b.ownership.ownershipPath[0].asOfDate,before);assert.equal(b.evidenceCoverage.fraction,1);
  assert.equal(b.ownershipSteps[2].portfolioEvidence!.portfolioId,'p');
});
test('hidden exposure includes paths, confidence, ownership gaps and overlapping concentration',()=>{
  const d=etf();d.snapshots[0].holdings.pop();d.snapshots[0].completeness='partial';
  const r=run(event(),portfolio(['etf']),foundation(),catalog(),{etf:{dataset:d}});
  assert.equal(r.holdings[0].hidden,true);near(r.holdings[0].connectedPortfolioWeight,.6);
  near(r.portfolioExposure.unknownPortfolioWeight,.4);assert.equal(r.status,'PARTIAL');
  near(r.hiddenConcentrations[0].connectedPortfolioWeight,.6);assert.equal(r.hiddenConcentrations[0].overlapping,true);
  assert.equal(r.connections[0].hopCount,5);
});
test('circular relationships stop without duplicated target or portfolio value',()=>{
  const f=foundation();f.relationships.push(relation('cycle','C','A',{type:'SUPPLIES'}));
  const c=catalog();c.rules.push(rule('cycle',{traversal:'forward',relationshipType:'supplier_to_customer'}));
  const r=run(event(),portfolio(),f,c);assert.equal(r.paths.length,3);
  assert.ok(r.gaps.some(g=>g.reason==='cycle_stopped'));near(r.holdings[0].connectedPortfolioWeight,1/3);
});
test('semantic duplicate edges/rules and anchors do not duplicate paths',()=>{
  const f=foundation();f.relationships.push({...f.relationships.find(e=>e.id==='supplier')!,id:'supplier-copy'});
  const c=catalog();c.rules.push(rule('supplier-copy'),rule('supplier'));
  const e=event();e.anchors.push({...e.anchors[0]});
  assert.equal(run(e,portfolio(),f,c).paths.length,3);
});
test('confidence decays high to medium to low, never sums independent evidence',()=>{
  const r=run();assert.deepEqual(r.paths.map(p=>p.confidence),['high','medium','low']);
  const e=event();e.anchors[0].confidence='low';assert.ok(run(e).paths.every(p=>p.confidence==='low'));
  e.anchors[0].confidence='unknown';assert.ok(run(e).paths.every(p=>p.confidence==='unknown'));
});
test('reported relationship never upgrades multi-hop impact to reported',()=>{
  const r=run();assert.equal(r.paths[1].steps[1].basis,'reported');assert.equal(r.paths[1].basis,'inferred');
  assert.ok(r.paths.every(p=>p.impactBasis==='inferred'));assert.ok(r.connections.every(c=>c.impactBasis==='inferred'));
});
test('missing evidence produces UNKNOWN and uncertain instead of a fabricated conclusion',()=>{
  const f=foundation();f.relationships.find(e=>e.id==='supplier')!.evidenceIds=[];
  const r=run(event(),portfolio(['assetB']),f);
  assert.equal(r.status,'UNKNOWN');assert.equal(r.paths[1].basis,'unknown');assert.equal(r.paths[1].direction,'uncertain');
  assert.equal(r.paths[1].evidenceCoverage.fraction,.5);assert.equal(r.holdings[0].connectedPortfolioWeight,null);
});
test('future-demand scenario stays conditional through grid and infrastructure supplier',()=>{
  const c=catalog();c.rules=[rule('grid-demand',{traversal:'forward',relationshipType:'demand_driver',scenario:{condition:'If compute deployment continues',demandKind:'compute'}}),rule('grid-supplier',{relationshipType:'infrastructure_dependency'})];
  const e=event();e.news.title='Compute technology expands';e.news.summary='Compute technology';e.anchors=[{entityId:'AI',mention:'Compute technology',direction:'positive',confidence:'high'}];
  const r=run(e,portfolio(['assetC']),foundation(),c);const path=r.paths.find(p=>p.targetEntityId==='C')!;
  assert.deepEqual(path.entityIds,['AI','grid','C']);assert.equal(path.basis,'inferred');assert.equal(path.scenarios[0].demandKind,'compute');
  assert.equal(path.scenarios[0].condition,'If compute deployment continues');assert.equal(r.holdings[0].hidden,true);
});
test('negative and mixed sensitivities propagate without inferring sign from relationship names',()=>{
  const c=catalog();c.rules[0].sensitivity='opposite';c.rules[1].sensitivity='mixed';
  const r=run(event(),portfolio(),foundation(),c);assert.deepEqual(r.paths.map(p=>p.direction),['positive','negative','mixed']);
  c.rules[0].sensitivity='unknown';assert.equal(run(event(),portfolio(),foundation(),c).paths[1].direction,'uncertain');
});
test('conflicting valid paths become mixed, connected ownership is counted once',()=>{
  const c=catalog();c.rules.push(rule('supplier',{sensitivity:'opposite',rationale:'Alternative negative demand scenario'}));
  const r=run(event(),portfolio(['assetB']),foundation(),c);
  assert.equal(r.holdings[0].direction,'mixed');near(r.holdings[0].connectedPortfolioWeight,1);
  near(r.hiddenConcentrations[0].connectedPortfolioWeight,1);
});
test('stale, future and expired relations are excluded with explicit gaps',()=>{
  for(const extra of [{updatedAt:'2020-01-01'},{updatedAt:'2027-01-01'},{validTo:before}]) {
    const f=foundation();Object.assign(f.relationships.find(e=>e.id==='supplier')!,extra);
    const r=run(event(),portfolio(['assetB']),f);assert.equal(r.status,'UNKNOWN');assert.equal(r.connections.length,0);
    assert.ok(r.gaps.some(g=>g.relationshipId==='supplier'));
  }
});
test('future evidence cannot turn an otherwise dated relationship into known exposure',()=>{
  const f=foundation();f.sources[0].retrievedAt='2027-01-01';
  const r=run(event(),portfolio(['assetB']),f);assert.equal(r.status,'UNKNOWN');assert.equal(r.paths[1].confidence,'unknown');
});
test('unreviewed or unsupported model entity anchors never enter the graph',()=>{
  const e=event();e.anchors=[{entityId:'B',mention:'Acme',direction:'positive',confidence:'high'}];
  assert.equal(run(e).paths.length,0);
  e.anchors=[{...event().anchors[0],mention:'Nonexistent quotation'}];assert.equal(run(e).paths.length,0);
  const c=catalog();c.rules.push(rule('hallucinated'));assert.equal(calculateNewsPortfolioIntelligence(event(),portfolio(),foundation(),c).status,'UNKNOWN');
});
test('mock, future news and unsafe source URL cannot produce reported anchors',()=>{
  for(const patch of [{origin:'mock' as const},{publishedAt:'2027-01-01'},{url:'javascript:alert(1)'},{url:undefined}]) {
    const e=event();Object.assign(e.news,patch);e.observedAt=e.news.publishedAt;const r=run(e);assert.equal(r.status,'UNKNOWN');assert.equal(r.paths.length,0);
  }
});
test('no transmission rule means no implicit supplier graph inference',()=>{
  const c=catalog();c.rules=[];const r=run(event(),portfolio(['assetB']),foundation(),c);
  assert.equal(r.connections.length,0);assert.equal(r.status,'UNKNOWN');assert.ok(r.gaps.some(g=>g.reason==='no_supported_path_not_proof_of_no_exposure'));
});
test('traversal caps explicitly mark partial and preserve known prefixes',()=>{
  for(const options of [{maxDepth:1},{maxPaths:1}]) {
    const r=run(event(),portfolio(),foundation(),catalog(),options);assert.equal(r.truncated,true);assert.equal(r.status,'PARTIAL');assert.equal(r.paths.length,1);
  }
});
test('direct plus ETF overlap uses existing denominator and per-position ownership',()=>{
  const r=run(event(),portfolio(['assetB','etf']),foundation(),catalog(),{etf:{dataset:etf()}});
  near(r.holdings[0].connectedPortfolioWeight,.5);near(r.holdings[1].connectedPortfolioWeight,.5);
  near(r.hiddenConcentrations[0].connectedPortfolioWeight,1);
  near(r.portfolioExposure.companyConcentration.buckets.find(b=>b.companyEntityId==='B')!.combined,.8);
});
test('missing ETF weights and valuation remain unknown, not zero exposure',()=>{
  const r=run(event(),portfolio(['etf']));assert.equal(r.status,'UNKNOWN');near(r.portfolioExposure.unknownPortfolioWeight,1);
  const p=portfolio();p.positions[0].marketValue=null;p.positions[0].valuationQuality='unknown';
  assert.ok(run(event(),p).holdings.every(h=>h.connectedPortfolioWeight===null));
});
test('concentrations are reused without treating economic edges as financial allocations',()=>{
  const r=run();near(r.portfolioExposure.exposure.dimensions.industry.concentration!.buckets[0].portfolioWeight,1);
  assert.equal(r.portfolioExposure.exposure.dimensions.theme.concentration!.overlapping,true);
  near(r.portfolioExposure.companyConcentration.buckets.reduce((s,b)=>s+b.combined,0),1);
});
test('adapter reuses RSS input selection but never imports inferred model entities',()=>{
  const n=news();n.title='Company update';n.summary='';n.contentSnippet='Acme announces orders';
  const market={inferredSymbols:['B'],explicitlyMentionedSymbols:['B'],securityImpacts:[]} as unknown as MarketImpactAnalysis;
  const e=createNewsExposureEvent(n,catalog(),before,market);assert.deepEqual(e.anchors.map(a=>a.entityId),['A']);assert.equal(e.anchors[0].direction,'uncertain');
  n.contentSnippet='Nonmatching text';assert.equal(createNewsExposureEvent(n,catalog(),before,market).anchors.length,0);
});
test('service uses existing repository; recomputes per portfolio without cache or mutations',async()=>{
  const f=foundation(),c=catalog(),n=news(),p=portfolio(),original=structuredClone({f,c,n,p});
  const service=createNewsExposureService(createExposureRepository(f),c);
  const base=calculatePortfolioExposure(p,f);
  const one=await service.analyze(n,p,{newsObservedAt:before});const two=await service.analyze(n,portfolio(['assetC']),{newsObservedAt:before});
  assert.equal(one.holdings.length,3);assert.equal(two.holdings.length,1);
  assert.deepEqual({f,c,n,p},original);assert.deepEqual(calculatePortfolioExposure(p,f),base);
  one.paths[0].steps[0].evidence.length=0;assert.equal((await service.analyze(n,p,{newsObservedAt:before})).paths[0].steps[0].evidence.length,1);
});

test('publication date never substitutes for actual observation in historical queries',()=>{
  const e=event();e.observedAt='2026-09-22';const r=run(e);assert.equal(r.paths.length,0);
  assert.equal(r.status,'UNKNOWN');
});
test('hypothesis and counter evidence cap confidence and retain contrary provenance',()=>{
  const f=foundation();f.evidence.push({id:'counter',sourceId:'s',excerpt:'Conflicting evidence',observedAt:before});
  const edge=f.relationships.find(e=>e.id==='supplier')!;edge.claim='HYPOTHESIS';edge.counterEvidenceIds=['counter'];
  const r=run(event(),portfolio(),f);const path=r.paths[1];
  assert.equal(path.confidence,'low');assert.equal(path.basis,'inferred');assert.ok(path.scenarios.length>0);
  assert.ok(path.steps[1].evidence.some(e=>e.id==='counter'));
});
test('ambiguous entity alias is rejected instead of producing two reported company mentions',()=>{
  const c=catalog();c.bindings.push({entityId:'B',aliases:['ACME']});assert.equal(calculateNewsPortfolioIntelligence(event(),portfolio(),foundation(),c).status,'UNKNOWN');
});

test('technology to industry to constituent finds hidden ETF exposure with full reverse path',()=>{
  const f=foundation();f.relationships.push(relation('industry-tech','industry','AI'));
  const c=catalog();c.rules=[rule('industry-tech',{relationshipType:'technology_dependency'}),rule('B-industry',{relationshipType:'company_to_industry'})];
  const e=event();e.news.title='Compute technology demand';e.anchors=[{entityId:'AI',mention:'Compute technology',direction:'positive',confidence:'high'}];
  const r=run(e,portfolio(['etf']),f,c,{etf:{dataset:etf()}});
  const path=r.paths.find(p=>p.targetEntityId==='B')!;assert.deepEqual(path.entityIds,['AI','industry','B']);
  const connection=r.connections[0];assert.equal(connection.pathId,path.id);assert.equal(connection.hidden,true);
  assert.deepEqual(connection.ownershipSteps.map(s=>s.target),['assetB','etf','position:p0']);
  near(r.holdings[0].connectedPortfolioWeight,.6);assert.equal(connection.confidence,'low');
});
test('distinct evidence alternatives remain auditable without double-counting ownership',()=>{
  const f=foundation();f.evidence.push({id:'alternative',sourceId:'s',excerpt:'Independent evidence',observedAt:before});
  const c=catalog();c.rules.push(rule('supplier',{evidenceIds:['alternative']}));
  const r=run(event(),portfolio(['assetB']),f,c);assert.equal(r.connections.length,2);
  assert.ok(r.paths.some(p=>p.steps.some(s=>s.evidence.some(e=>e.id==='alternative'))));
  near(r.holdings[0].connectedPortfolioWeight,1);
});

// Labels below are synthetic topology fixtures, not assertions about real companies or ETF weights.
for(const fixture of [
  {name:'A 0050 → TSMC → semiconductor → advanced packaging → AI compute',company:'TSMC',nodes:['semiconductor','advanced packaging','AI compute'],kinds:['Industry','Technology','FutureDemand'] as const,depth:4},
  {name:'B ETF → utility → electricity demand → data center expansion',company:'utility company',nodes:['electricity demand','data center expansion'],kinds:['FutureDemand','FutureDemand'] as const,depth:3},
  {name:'C ETF → industrial → transformer/grid → AI power demand',company:'industrial company',nodes:['transformer / grid infrastructure','AI power demand'],kinds:['Technology','FutureDemand'] as const,depth:3},
]) test(`acceptance hidden exposure ${fixture.name}`,()=>{
  const f=foundation(),c=catalog(),e=event(),d=etf();
  f.entities.find(x=>x.id==='A')!.name=fixture.company;
  const nodes=['A',...fixture.nodes];c.rules=[];
  for(let i=0;i<fixture.nodes.length;i++) {
    f.entities.push({id:fixture.nodes[i],name:fixture.nodes[i],kind:fixture.kinds[i]});
    f.relationships.push(relation(`hidden-${i}`,nodes[i],nodes[i+1],{nature:'INDIRECT',claim:'INFERRED'}));
    c.rules.push(rule(`hidden-${i}`,{relationshipType:'technology_dependency',scenario:{condition:'Only if the fixture demand scenario persists',demandKind:'compute'}}));
  }
  const target=nodes[nodes.length-1];c.bindings=[{entityId:target,aliases:[target]}];
  e.news.title=`Scenario: ${target}`;e.news.summary='';e.anchors=[{entityId:target,mention:target,direction:'positive',confidence:'high'}];
  d.snapshots[0].holdings=[{...d.snapshots[0].holdings[0],underlyingAssetId:'assetA',name:fixture.company,weight:1}];
  const r=run(e,portfolio(['etf']),f,c,{etf:{dataset:d}}),connection=r.connections[0];
  const path=r.paths.find(p=>p.id===connection.pathId)!;
  assert.deepEqual(path.entityIds,[...nodes].reverse());assert.equal(path.depth,fixture.depth);
  assert.equal(path.order,'third_order_or_more');assert.equal(path.basis,'inferred');assert.equal(path.confidence,'low');
  assert.ok(path.scenarios.length>0);assert.equal(connection.nature,'indirect');assert.equal(connection.hidden,true);
  assert.equal(connection.hopCount,fixture.depth+3);near(r.holdings[0].connectedPortfolioWeight,1);
  assert.ok(path.steps.every(s=>s.basis!=='reported' && s.invalidationConditions.length>0));
  assert.equal(connection.evidenceCoverage.fraction,1);
  f.relationships.find(x=>x.id==='hidden-0')!.evidenceIds=[];
  const missing=run(e,portfolio(['etf']),f,c,{etf:{dataset:d}});
  assert.equal(missing.holdings[0].status,'UNKNOWN');assert.equal(missing.holdings[0].connectedPortfolioWeight,null);
});

test('invalid or missing input safely returns UNKNOWN without throwing or exposing source data',()=>{
  const cases:[NewsExposureEvent,ExposurePortfolioSnapshot,ExposureDataset,NewsExposureCatalog][]=[
    [event(),null as unknown as ExposurePortfolioSnapshot,foundation(),catalog()],
    [event(),{...portfolio(),positions:undefined} as unknown as ExposurePortfolioSnapshot,foundation(),catalog()],
    [null as unknown as NewsExposureEvent,portfolio(),foundation(),catalog()],
    [event(),portfolio(),null as unknown as ExposureDataset,catalog()],
  ];
  for(const args of cases) {
    const r=calculateNewsPortfolioIntelligence(...args);assert.equal(r.status,'UNKNOWN');assert.equal(r.portfolioExposure,null);
    assert.equal(r.connections.length,0);assert.deepEqual(r.gaps,[{reason:'invalid_input'}]);
  }
  const r=run(event(),portfolio([]));assert.equal(r.status,'UNKNOWN');assert.equal(r.connections.length,0);
});
test('service repository failure and invalid catalog do not escape to callers',async()=>{
  const broken=createNewsExposureService({async getSnapshot(){throw new Error('private source details');}},catalog());
  const r=await broken.analyze(news(),portfolio(),{newsObservedAt:before});
  assert.equal(r.status,'UNKNOWN');assert.ok(!JSON.stringify(r).includes('private source details'));
});
test('invalid supplier traversal label is rejected, including syntactically invalid direction',()=>{
  for(const patch of [{traversal:'forward' as const},{traversal:'sideways' as TransmissionRule['traversal']}]) {
    const c=catalog();Object.assign(c.rules[0],patch);
    const r=calculateNewsPortfolioIntelligence(event(),portfolio(),foundation(),c);
    assert.equal(r.status,'UNKNOWN');assert.equal(r.paths.length,0);
  }
  const c=catalog();c.rules[0].traversal='forward';c.rules[0].relationshipType='supplier_to_customer';
  const r=run(event(),portfolio(),foundation(),c);assert.equal(r.paths.length,1); // A is not the supplier.
});
test('missing invalidation condition is rejected instead of accepting an unfalsifiable rule',()=>{
  const c=catalog();c.rules[0].invalidationConditions=[];
  assert.equal(calculateNewsPortfolioIntelligence(event(),portfolio(),foundation(),c).status,'UNKNOWN');
});
test('missing sensitivity evidence cannot borrow support from the structural relationship',()=>{
  const c=catalog();c.rules[0].evidenceIds=[];
  const r=run(event(),portfolio(['assetB']),foundation(),c);
  assert.equal(r.holdings[0].status,'UNKNOWN');assert.equal(r.holdings[0].connectedPortfolioWeight,null);
  assert.equal(r.paths[1].direction,'uncertain');
});
test('multiple weak paths never amplify confidence or allocate the same owned slice twice',()=>{
  const c=catalog();c.rules[0].confidence='low';
  for(let i=0;i<5;i++) c.rules.push(rule('supplier',{confidence:'low',rationale:`Weak alternative ${i}`}));
  const r=run(event(),portfolio(['assetB']),foundation(),c);
  assert.equal(r.connections.length,6);assert.equal(r.holdings[0].confidence,'low');near(r.holdings[0].connectedPortfolioWeight,1);
});
test('known and unknown alternative paths yield PARTIAL, not confirmed certainty',()=>{
  const c=catalog();c.rules.push(rule('supplier',{evidenceIds:[],rationale:'Unsupported alternative'}));
  const r=run(event(),portfolio(['assetB']),foundation(),c);
  assert.equal(r.holdings[0].status,'PARTIAL');assert.equal(r.holdings[0].confidence,'unknown');assert.equal(r.holdings[0].direction,'uncertain');
  near(r.holdings[0].connectedPortfolioWeight,1); // Owned value on the supported path, not causal probability.
});
test('unpriced holdings and stale excluded alternatives cannot be labeled fully KNOWN',()=>{
  const p=portfolio(['assetB']);p.positions[0].valuationQuality='unknown';p.positions[0].marketValue=null;
  assert.equal(run(event(),p).holdings[0].status,'PARTIAL');
  const c=catalog();c.rules.push(rule('supplier',{asOf:'2020-01-01',rationale:'Stale alternative'}));
  const r=run(event(),portfolio(['assetB']),foundation(),c);
  assert.equal(r.holdings[0].status,'PARTIAL');assert.equal(r.hiddenConcentrations[0].status,'PARTIAL');
});
test('ownership join cannot close a cycle that was absent from the forward graph',()=>{
  const f=foundation();f.relationships.push(relation('back-to-self','assetB','A'));
  const c=catalog();c.bindings=[{entityId:'assetB',aliases:['StockB']}];
  c.rules.unshift(rule('back-to-self',{traversal:'forward',relationshipType:'company_to_company'}));
  const e=event();e.news.title='StockB';e.anchors=[{entityId:'assetB',mention:'StockB',direction:'positive',confidence:'high'}];
  const r=run(e,portfolio(['assetB']),f,c);
  assert.equal(r.connections.length,1);assert.ok(r.gaps.some(g=>g.reason==='ownership_cycle_stopped'));
  near(r.holdings[0].connectedPortfolioWeight,1);
});
test('query cannot import ETF evidence from a future knownAt override',()=>{
  const r=calculateNewsPortfolioIntelligence(event(),portfolio(['etf']),foundation(),catalog(),{etf:{dataset:etf(),knownAt:'2027-01-01'}});
  assert.equal(r.status,'UNKNOWN');assert.equal(r.connections.length,0);
});
test('excessive depth is rejected safely and valid depth limit returns only bounded paths',()=>{
  assert.equal(calculateNewsPortfolioIntelligence(event(),portfolio(),foundation(),catalog(),{maxDepth:100000}).status,'UNKNOWN');
  const r=run(event(),portfolio(),foundation(),catalog(),{maxDepth:2});
  assert.ok(r.paths.every(p=>p.depth<=2));assert.equal(r.truncated,true);
});
test('direct + ETF A + ETF B: company50 = direct20 + indirect30, overlap25, no path inflation',()=>{
  const f=foundation();f.entities.push({id:'etfB',kind:'Asset',name:'ETF B'});
  const d=etf();d.snapshots[0].holdings=[{...d.snapshots[0].holdings[0],underlyingAssetId:'assetA',weight:.5},{...d.snapshots[0].holdings[1],underlyingAssetId:'assetB',weight:.5}];
  d.snapshots.push({...structuredClone(d.snapshots[0]),id:'snapshotB',etfAssetId:'etfB',holdings:[{...d.snapshots[0].holdings[0],weight:.25},{...d.snapshots[0].holdings[1],underlyingAssetId:'assetC',weight:.75}]});
  const p=portfolio(['assetA','etf']);p.positions[0].marketValue=20;p.positions[1].marketValue=40;
  p.positions.push({...p.positions[1],id:'p2',assetEntityId:'etfB'});
  const c=catalog();c.rules=[];
  const r=run(event(),p,f,c,{etf:{dataset:d}}),a=r.portfolioExposure.companyConcentration.buckets.find(x=>x.companyEntityId==='A')!;
  near(a.direct,.2);near(a.indirect,.3);near(a.combined,.5);near(r.portfolioExposure.overlaps[0].knownOverlap,.25);
  near(r.holdings.reduce((s,h)=>s+(h.connectedPortfolioWeight ?? 0),0),.5);near(r.portfolioExposure.unknownPortfolioWeight,0);
  d.snapshots[1].holdings.pop();d.snapshots[1].completeness='partial';
  const partial=run(event(),p,f,c,{etf:{dataset:d}});near(partial.portfolioExposure.unknownPortfolioWeight,.3);assert.equal(partial.status,'PARTIAL');
});
