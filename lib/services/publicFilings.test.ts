import test from 'node:test';
import assert from 'node:assert/strict';
import type { FilingDocument, FilingIdentity, FilingRow } from '../types/publicFilings';
import { normalizePublicFiling, filingFreshness } from './publicFilingNormalization';
import { createForm4Provider, create13FProvider, createFilingIngestion, createMemoryFilingStore, filingTimeline } from './publicFilingRepository';
import { compareDisclosedHoldings } from '../calculations/filingHoldingsChanges';
import { resolveFilingIdentity } from '../utils/filingIdentity';
import { parseFilingDocument } from '../utils/publicFilingValidation';
import { createPublicIntelligenceRepository } from './publicIntelligenceRepository';

// Entirely fictional records; never loaded by application runtime.
const now = '2026-05-20T12:00:00Z';
const identity = (kind:FilingIdentity['kind'], value:string, name='Fixture identity'):FilingIdentity => ({name,kind,identifier:{namespace:kind==='security'?'cusip':'cik',value},verified:true,evidence:['Fixture identifier in source document']});
function row(id='row1', cusip='000000001', shares=100):FilingRow {
  return {rawSourceId:id,security:{identity:identity('security',cusip),issuer:identity('company','3'),ticker:null,shareClass:'COM',putCall:null},
    eventDate:null,transactionDate:'2026-05-01',transactionCode:'P',shares,shareUnit:'shares',price:10,currency:'USD',reportedValue:null,valueScale:'units',
    ownershipAfter:200,ownershipType:'direct',ownershipNature:null,investmentDiscretion:null,otherManagers:[],
    evidence:[{id:'e1',excerpt:'Fictional source row',locator:id}],quality:'reported'};
}
function form4():FilingDocument {
  return {provider:'sec-form4',form:'FORM4',filingId:'f4-1',rawSourceId:'source-1',sourceUrl:'https://example.com/filing',sourceReference:'TEST-4',origin:'mock',verified:true,
    dates:{periodEnd:null,filedAt:'2026-05-04',publishedAt:'2026-05-04T18:00:00Z',asOfDate:'2026-05-01',retrievedAt:'2026-05-05T00:00:00Z'},
    coverage:'KNOWN',publicTableComplete:true,confidentialOmissions:false,
    participants:[{identity:identity('person','1','Same Name'),role:'reporting_owner'},{identity:identity('institution','2'),role:'filer'}],
    amendment:{kind:'original',previousFilingId:null},rows:[row()]};
}
function holdings(id='h1', period='2025-12-31', shares=100):FilingDocument {
  const d=form4();d.provider='sec-13f';d.form='13F';d.filingId=id;
  d.participants=[{identity:identity('institution','2'),role:'manager'}];
  d.dates={periodEnd:period,asOfDate:period,filedAt:'2026-05-04',publishedAt:'2026-05-04T18:00:00Z',retrievedAt:'2026-05-05T00:00:00Z'};
  d.rows=[{...row(),transactionDate:null,transactionCode:null,price:null,shares,reportedValue:1000,ownershipAfter:null,ownershipType:'unknown'}];return d;
}
const normalize=(d:FilingDocument)=>normalizePublicFiling(d,{now,maxAgeDays:200});
const compare=(a:FilingDocument,b:FilingDocument)=>compareDisclosedHoldings(normalize(a),normalize(b),now);

test('Form 4 buy retains reported P/date/price/shares/issuer/evidence, compatible with C1',async()=>{
  const n=normalize(form4()),a=n.dataset.activities[0];assert.equal(a.action,'purchase');assert.equal(a.quantity?.value,100);
  assert.equal(a.filing.price,10);assert.equal(a.filing.ownershipAfter,200);assert.equal(a.transactionDate,'2026-05-01');
  assert.equal(a.filing.dates.filedAt,'2026-05-04');assert.equal(a.filing.dates.eventDate,null);assert.equal(a.provenance.origin,'mock');
  assert.equal((await createPublicIntelligenceRepository(n.dataset).getSnapshot()).activities.length,1);
});
test('Form 4 sell only from S; F tax withholding is not inferred sale',()=>{
  const d=form4();d.rows[0].transactionCode='S';assert.equal(normalize(d).dataset.activities[0].action,'sale');
  d.rows[0].transactionCode='F';assert.equal(normalize(d).dataset.activities[0].action,'other');
});
test('indirect ownership and nature retained, without adding beneficiary role',()=>{
  const d=form4();d.rows[0].ownershipType='indirect';d.rows[0].ownershipNature='Fixture trust';
  const a=normalize(d).dataset.activities[0];assert.equal(a.filing.ownershipType,'indirect');assert.equal(a.filing.ownershipNature,'Fixture trust');assert.ok(!a.participants.some(p=>p.role==='beneficial_owner'));
});
test('missing price remains null with PARTIAL; not imputed from value',()=>{
  const d=form4();d.rows[0].price=null;const n=normalize(d);assert.equal(n.dataset.activities[0].filing.price,null);assert.equal(n.coverage,'PARTIAL');assert.equal(n.dataset.activities[0].action,'purchase');
});
test('13F new disclosed position is snapshot difference, not trade',()=>{
  const a=holdings();a.rows=[];const result=compare(a,holdings('h2','2026-03-31',100));
  assert.equal(result.changes[0].change,'new');assert.equal(result.changes[0].delta,100);assert.equal(result.changes[0].basis,'disclosed_snapshot_difference');
});
test('13F increased position',()=>{assert.equal(compare(holdings(),holdings('h2','2026-03-31',150)).changes[0].delta,50);assert.equal(compare(holdings(),holdings('h2','2026-03-31',150)).changes[0].change,'increased');});
test('13F reduced position',()=>{const r=compare(holdings(),holdings('h2','2026-03-31',30));assert.equal(r.changes[0].change,'reduced');assert.equal(r.changes[0].delta,-70);});
test('13F exited position requires complete public tables and no confidential omissions',()=>{
  const b=holdings('h2','2026-03-31');b.rows=[];assert.equal(compare(holdings(),b).changes[0].change,'exited');
  b.confidentialOmissions=null;assert.equal(compare(holdings(),b).changes[0].change,'unknown');
});
test('partial filing absence never implies zero or exited',()=>{
  const b=holdings('h2','2026-03-31');b.rows=[];b.coverage='PARTIAL';b.publicTableComplete=false;
  const r=compare(holdings(),b);assert.equal(r.coverage,'PARTIAL');assert.equal(r.changes[0].after,null);assert.equal(r.changes[0].change,'unknown');
});
test('same-name different person remains distinct; names never resolve',()=>{
  assert.notEqual(resolveFilingIdentity(identity('person','1','Same Name'),'x').id,resolveFilingIdentity(identity('person','2','Same Name'),'y').id);
  const missing=identity('person','1');missing.identifier=null;
  assert.notEqual(resolveFilingIdentity(missing,'filing1').id,resolveFilingIdentity(missing,'filing2').id);
  assert.equal(resolveFilingIdentity(missing,'x').status,'unknown');
});
test('verified explicit bindings preserve legacy IDs; conflicting bindings fail closed',()=>{
  const i=identity('person','1');const binding={id:'legacy-person',kind:'person' as const,identifier:i.identifier!,verified:true,evidence:['Registry proof']};
  assert.equal(resolveFilingIdentity(i,'x',[binding]).id,'legacy-person');
  assert.equal(resolveFilingIdentity(i,'x',[binding,{...binding,id:'another'}]).status,'unknown');
});
test('unknown entity retained with UNKNOWN, no ticker/company guess',()=>{
  const d=form4();d.rows[0].security.identity.identifier=null;const n=normalize(d);
  assert.equal(n.coverage,'UNKNOWN');assert.equal(n.dataset.activities[0].security.ticker,null);assert.match(n.dataset.activities[0].security.id,/unresolved/);
});
test('stale filing judged by asOfDate, not fresh retrieval',()=>{
  const d=holdings();assert.equal(filingFreshness(d,now,90),'stale');assert.equal(normalizePublicFiling(d,{now,maxAgeDays:90}).dataset.activities[0].filing.freshness,'stale');
  d.dates.asOfDate=null;d.dates.periodEnd=null;assert.equal(filingFreshness(d,now,90),'unknown');
});
test('filing date never becomes transaction date and date-only publication is conservative',()=>{
  const d=form4();d.rows[0].transactionDate=null;d.dates.publishedAt='2026-05-04';d.dates.retrievedAt='2026-05-04T20:00:00Z';
  const n=normalize(d);assert.equal(n.dataset.activities[0].transactionDate,null);assert.equal(n.knownAt,'2026-05-05T00:00:00.000Z');
});
test('future publication, invalid date, duplicate row and unsupported form rejected',()=>{
  const d=form4();d.dates.publishedAt='2026-12-01';assert.throws(()=>normalize(d));
  d.dates.publishedAt='2026-02-30';assert.throws(()=>parseFilingDocument(d));
  d.dates.publishedAt=null;d.rows.push(d.rows[0]);assert.throws(()=>normalize(d),/duplicate/);
  d.rows.pop();d.form='13D';assert.throws(()=>normalize(d),/adapter required/);
});
test('13F value scale explicit; unknown unit never becomes exact dollar value',()=>{
  const d=holdings();d.rows[0].valueScale='thousands';assert.equal(normalize(d).dataset.activities[0].filing.value,1_000_000);
  d.rows[0].valueScale='units';assert.equal(normalize(d).dataset.activities[0].filing.value,1000);
  d.rows[0].valueScale='unknown';assert.equal(normalize(d).dataset.activities[0].filing.value,null);assert.equal(normalize(d).coverage,'PARTIAL');
});
test('estimated/inferred/unknown retain quality and never become FACT',()=>{
  for (const quality of ['estimated','inferred','unknown'] as const) {
    const d=form4();d.rows[0].quality=quality;const a=normalize(d).dataset.activities[0];
    assert.equal(a.filing.quality,quality);assert.notEqual(a.claim,'FACT');assert.notEqual(a.provenance.coverage,'KNOWN');
  }
});
test('duplicate filing idempotency preserves earliest system observation',async()=>{
  const store=createMemoryFilingStore();const ingest=createFilingIngestion(store,{now:()=>now,maxAgeDays:200});let d=form4();
  const provider=createForm4Provider(async()=>d);
  assert.equal((await ingest.ingest(provider,'ref')).status,'inserted');d={...d,dates:{...d.dates,retrievedAt:'2026-05-06T00:00:00Z'}};
  assert.equal((await ingest.ingest(provider,'ref')).status,'duplicate');assert.equal((await store.list()).length,1);assert.equal((await store.list())[0].knownAt,'2026-05-05T00:00:00.000Z');
  d.rows[0].shares=101;assert.equal((await ingest.ingest(provider,'ref')).status,'conflict');assert.equal((await store.list())[0].source.rows[0].shares,100);
});
test('concurrent duplicate insert remains idempotent',async()=>{
  const store=createMemoryFilingStore(),ingest=createFilingIngestion(store,{now:()=>now,maxAgeDays:200});
  const statuses=await Promise.all([1,2,3].map(()=>ingest.ingest(createForm4Provider(async()=>form4()),'ref')));
  assert.equal(statuses.filter(r=>r.status==='inserted').length,1);assert.equal((await store.list()).length,1);
});
test('amendment retained and unavailable before knownAt; no retroactive overwrite',async()=>{
  const store=createMemoryFilingStore(),ingest=createFilingIngestion(store,{now:()=>now,maxAgeDays:200});
  await ingest.ingest(createForm4Provider(async()=>form4()),'ref');
  const d=form4();d.filingId='f4-2';d.amendment={kind:'correction',previousFilingId:'f4-1'};d.dates.retrievedAt='2026-05-10T00:00:00Z';d.dates.filedAt='2026-05-09';d.dates.publishedAt='2026-05-09T18:00:00Z';d.rows[0].shares=90;
  await ingest.ingest(createForm4Provider(async()=>d),'ref');
  assert.equal((await filingTimeline(store,'2026-05-04T23:00:00Z')).length,0);
  assert.ok((await filingTimeline(store,'2026-05-06T00:00:00Z')).every(e=>e.filingId.endsWith('f4-1')));
  const events=await filingTimeline(store,now);assert.equal(events.find(e=>e.type==='amendment')?.previousFilingId,'f4-1');assert.equal((await store.list()).length,2);
});
test('13F amendments not treated as quarterly trades or blindly combined',()=>{
  const d=holdings('h2','2026-03-31');d.amendment={kind:'additional',previousFilingId:'h0'};
  assert.equal(compare(holdings(),d).coverage,'UNKNOWN');
});
test('snapshot comparison cutoff prevents look-ahead',()=>{
  assert.equal(compareDisclosedHoldings(normalize(holdings()),normalize(holdings('h2','2026-03-31')),'2026-05-01').coverage,'UNKNOWN');
});
test('ambiguous duplicated allocations are not summed; principal/option scope preserved',()=>{
  const a=holdings(),b=holdings('h2','2026-03-31');b.rows.push({...b.rows[0],rawSourceId:'row2'});
  assert.equal(compare(a,b).changes[0].change,'unknown');
  b.rows.pop();b.rows[0].shareUnit='principal';assert.equal(normalize(b).dataset.activities[0].quantity,null);
});
test('provider errors safe, malformed payload rejected, no empty-success fallback',async()=>{
  const store=createMemoryFilingStore(),ingest=createFilingIngestion(store,{now:()=>now,maxAgeDays:200});
  assert.equal((await ingest.ingest(createForm4Provider(async()=>{throw Error('private transport details');}),'ref')).status,'unavailable');
  assert.equal((await ingest.ingest(create13FProvider(async()=>form4()),'ref')).status,'rejected');
  assert.equal((await ingest.ingest(createForm4Provider(async()=>({})),'ref')).status,'rejected');assert.equal((await store.list()).length,0);
});
test('empty holdings filing still retains manager and filing timeline',async()=>{
  const d=holdings();d.rows=[];const store=createMemoryFilingStore(),ingest=createFilingIngestion(store,{now:()=>now,maxAgeDays:200});
  await ingest.ingest(create13FProvider(async()=>d),'ref');assert.ok((await filingTimeline(store,now)).some(e=>e.type==='periodEnd'));
});
test('empty filing lacking publication is PARTIAL, missing manager is UNKNOWN',()=>{
  const d=holdings();d.rows=[];d.dates.publishedAt=null;assert.equal(normalize(d).coverage,'PARTIAL');
  d.participants[0].role='filer';assert.equal(normalize(d).coverage,'UNKNOWN');
});
test('confidence/evidence absence fails closed at activity and filing levels',()=>{
  const d=form4();d.rows[0].evidence=[];const n=normalize(d);assert.equal(n.coverage,'UNKNOWN');assert.equal(n.dataset.activities[0].provenance.confidence,'unknown');
});
test('previously fresh snapshot is stale at a later query, cannot imply exit',()=>{
  const a=normalize(holdings()),d=holdings('h2','2026-03-31');d.rows=[];const b=normalize(d);
  assert.equal(compareDisclosedHoldings(a,b,'2027-01-01').changes[0].change,'unknown');
});
test('public SEC adapter refuses non-SEC URLs; issuer/security namespaces cannot mix',()=>{
  const d=form4();d.origin='public';assert.throws(()=>normalize(d),/SEC source/);
  d.sourceUrl='https://www.sec.gov/Archives/edgar/data/1/filing.xml';assert.equal(normalize(d).dataset.activities[0].provenance.sourceType,'sec_form4');
  d.rows[0].security.identity.identifier={namespace:'cik',value:'1'};assert.throws(()=>normalize(d),/namespace/);
});
test('unavailable storage does not claim ingestion success',async()=>{
  const ingest=createFilingIngestion({insert:async()=>{throw Error('storage');},list:async()=>[]},{now:()=>now,maxAgeDays:200});
  assert.deepEqual(await ingest.ingest(createForm4Provider(async()=>form4()),'ref'),{status:'unavailable',reason:'storage_unavailable'});
});
test('amendment cycle rejected without overwriting earlier record',async()=>{
  const store=createMemoryFilingStore(),ingest=createFilingIngestion(store,{now:()=>now,maxAgeDays:200});
  const a=form4();a.amendment={kind:'correction',previousFilingId:'f4-2'};
  assert.equal((await ingest.ingest(createForm4Provider(async()=>a),'ref')).status,'inserted');
  const b=form4();b.filingId='f4-2';b.amendment={kind:'correction',previousFilingId:'f4-1'};
  assert.equal((await ingest.ingest(createForm4Provider(async()=>b),'ref')).status,'conflict');assert.equal((await store.list()).length,1);
});
test('future retrieval/transaction after filing rejected; unknown quantities remain null',()=>{
  const d=form4();d.rows[0].transactionDate='2026-05-05';assert.throws(()=>normalize(d),/transaction after filing/);
  d.rows[0].transactionDate=null;d.dates.retrievedAt='2026-06-01T00:00:00Z';assert.throws(()=>normalize(d),/Retrieval after evaluation/);
  d.dates.retrievedAt='2026-05-05T00:00:00Z';d.rows[0].quality='unknown';assert.equal(normalize(d).dataset.activities[0].quantity?.value,null);
});
