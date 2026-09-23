import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {readFileSync} from 'node:fs';
import type {Provenance,PublicActivity,PublicIntelligenceDataset,TrackedEntity} from '../types/publicIntelligence';
import {validatePublicDataset,effectiveCoverage,safePublicUrl} from './publicIntelligenceValidation';
import {adaptPeopleRegistry,createPublicIntelligenceRepository,publicIntelligenceRepository} from '../services/publicIntelligenceRepository';
import {peopleRegistry} from '../data/peopleRegistry';
import {createFollowingRepository,FOLLOWING_KEY,parseFollowing} from '../services/followingRepository';
import {PublicActivityCard,ProvenanceDetails} from '../../components/people/PublicIntelligence';
import {FollowingProvider} from '../../components/people/Following';
import {IntelligenceDirectory} from '../../components/people/IntelligenceDirectory';

// Entirely fictional entities and securities. Never imported by application modules.
const provenance=():Provenance=>({source:'Deterministic test fixture',sourceType:'fixture',sourceUrl:'https://example.com/disclosure',filingReference:'TEST-001',reportedAt:'2026-01-05',filedAt:'2026-01-04',asOfDate:'2025-12-31',knownAt:'2026-01-06',lastVerifiedAt:'2026-01-06',evidence:[{id:'ev1',excerpt:'Fictional test disclosure',locator:'row 1'}],confidence:'medium',coverage:'PARTIAL',verification:'unverified',freshness:'unknown',origin:'mock'});
const entity=(id:string,entityType:TrackedEntity['entityType']):TrackedEntity=>({id,name:`測試 ${id}`,entityType,roles:[],avatar:null,description:'fictional',roleLabel:'測試角色',organizationLabel:null,externalIds:[],lastUpdated:null,provenance:provenance()});
const base=()=>({id:'a1',title:'Fictional activity',participants:[{entityId:'fund',role:'reporting_owner' as const},{entityId:'filer',role:'filer' as const}],security:{id:'test:XYZ',ticker:'XYZ',company:'虛構公司',market:'TEST',shareClass:'common'},transactionDate:null,provenance:provenance(),supersedesId:null,claim:'REPORTED' as const});
const activity=():PublicActivity=>({...base(),kind:'institutional_holding',action:'held',quantity:{value:100,quality:'reported',unit:'shares',currency:null,denominator:null}});
const dataset=():PublicIntelligenceDataset=>({version:1,entities:[entity('manager','person'),entity('fund','institution'),entity('filer','institution')],relationships:[{id:'aff1',sourceId:'manager',target:{kind:'entity',id:'fund'},type:'affiliation',validFrom:null,validTo:null,provenance:provenance()}],activities:[activity()]});
const html=(a:PublicActivity)=>renderToStaticMarkup(createElement(PublicActivityCard,{activity:a,entities:dataset().entities}));

test('identity adapter keeps every legacy person ID and unresolved placeholders',()=>{
  const data=adaptPeopleRegistry(peopleRegistry);validatePublicDataset(data);
  for(const p of peopleRegistry) assert.ok(data.entities.find(e=>e.id===p.id));
  assert.equal(data.entities.find(e=>e.id==='tw-executive')?.entityType,'unresolved');
  assert.ok(data.entities.some(e=>e.entityType==='institution'));
  assert.ok(data.relationships.every(r=>r.type!=='reported_holding'));
  assert.ok(data.entities.every(e=>effectiveCoverage(e.provenance)==='UNKNOWN'));
});
test('production repository contains no fixture activities, inferred owners or copied institution positions',async()=>{
  const data=await publicIntelligenceRepository.getSnapshot();assert.equal(data.activities.length,0);
  assert.ok(data.entities.every(e=>e.provenance.origin==='legacy' && e.externalIds.length===0));
});
test('institution holding belongs to explicit participants, never its affiliated manager',async()=>{
  const repo=createPublicIntelligenceRepository(dataset());
  assert.equal((await repo.getActivities('manager')).length,0);assert.equal((await repo.getActivities('fund')).length,1);
  assert.equal((await repo.getActivities('filer')).length,1);assert.equal(await repo.getEntity('absent'),null);
});
test('filer/reporting owner/beneficial owner/manager remain distinct participants in presentation',()=>{
  const a=activity();a.participants.push({entityId:'manager',role:'manager'},{entityId:'manager',role:'beneficial_owner'});
  const data=dataset();data.activities=[a];validatePublicDataset(data);
  const output=html(a);for(const label of ['Filer','Reporting Owner','Beneficial Owner','Manager'])assert.ok(output.includes(label));
});
test('repository snapshots are immutable copies',async()=>{
  const input=dataset(),repo=createPublicIntelligenceRepository(input);input.activities.length=0;
  const copy=await repo.getSnapshot();copy.entities.length=0;
  assert.equal((await repo.getSnapshot()).activities.length,1);assert.equal((await repo.getSnapshot()).entities.length,3);
});
test('all seven activity types preserve semantics and metadata',()=>{
  const rows:PublicActivity[]=[activity(),{...base(),kind:'disclosed_holding',action:'held',quantity:null},{...base(),kind:'disclosed_transaction',action:'sale',quantity:null,transactionCode:'S',transactionDate:'2026-01-02'},{...base(),kind:'insider_transaction',action:'grant',quantity:null,transactionCode:'A',transactionDate:'2026-01-02'},{...base(),kind:'public_mention',action:'mentioned',quantity:null},{...base(),kind:'research_opinion',action:'opinion',quantity:null,claim:'OPINION'},{...base(),kind:'planned_transaction',action:'planned',quantity:null}];
  for(const [i,a] of rows.entries())a.id=`a${i}`;
  const data=dataset();data.activities=rows;validatePublicDataset(data);
  for(const a of rows) {const output=html(a);assert.ok(output.includes('模擬資料'));assert.ok(output.includes('TEST-001'));assert.ok(output.includes('2025-12-31'));}
});
test('public mention cannot be a purchase or carry position quantities',()=>{
  const data=dataset();data.activities=[{...base(),kind:'public_mention',action:'mentioned',quantity:null}];validatePublicDataset(data);
  (data.activities[0] as unknown as {action:string}).action='purchase';assert.throws(()=>validatePublicDataset(data),/not a trade/);
  data.activities[0]={...base(),kind:'public_mention',action:'mentioned',quantity:null,transactionDate:'2026-01-01'};assert.throws(()=>validatePublicDataset(data),/not a trade/);
});
test('holding snapshot and planned transfer cannot masquerade as executed trade',()=>{
  const data=dataset();data.activities[0].transactionDate='2026-01-01';assert.throws(()=>validatePublicDataset(data),/not a trade/);
  data.activities=[{...base(),kind:'planned_transaction',action:'planned',quantity:null}];validatePublicDataset(data);
  (data.activities[0] as unknown as {action:string}).action='sale';assert.throws(()=>validatePublicDataset(data),/not executed/);
});
test('unknown/unverified/mock never gets KNOWN, stale verified records remain PARTIAL',()=>{
  const p=provenance();p.coverage='KNOWN';p.confidence='high';assert.equal(effectiveCoverage(p),'UNKNOWN');
  p.origin='public';p.sourceType='institution_report';p.verification='verified';p.freshness='current';assert.equal(effectiveCoverage(p),'KNOWN');
  p.freshness='stale';assert.equal(effectiveCoverage(p),'PARTIAL');p.evidence=[];assert.equal(effectiveCoverage(p),'UNKNOWN');
});
test('unsupported reported holding edge is rejected',()=>{
  const data=dataset();data.relationships[0].type='reported_holding';assert.throws(()=>validatePublicDataset(data),/unsupported holding/);
});
test('fixture cannot become a public verified fact by changing origin flags',()=>{
  const data=dataset();const p=data.activities[0].provenance;p.origin='public';p.verification='verified';p.coverage='KNOWN';p.freshness='current';
  assert.equal(effectiveCoverage(p),'UNKNOWN');assert.throws(()=>validatePublicDataset(data),/fixture origin/);
});
test('unverified high confidence is not presented as a high confidence finding',()=>{
  const p=provenance();p.confidence='high';p.coverage='KNOWN';
  const output=renderToStaticMarkup(createElement(ProvenanceDetails,{data:p}));
  assert.ok(output.includes('UNKNOWN'));assert.ok(output.includes('可信度：未知'));assert.ok(!output.includes('可信度：高'));
});
test('dates retain disclosure delay and reject knownAt before publication',()=>{
  const data=dataset();
  assert.ok(html(data.activities[0]).includes('公開或申報日期不等於交易日'));
  data.activities[0].provenance.knownAt='2026-01-01';assert.throws(()=>validatePublicDataset(data),/precedes/);
});
test('quantity denominator/currency missing, negative shares and fabricated certainty rejected',()=>{
  const data=dataset(),a=data.activities[0];a.quantity={value:.2,unit:'fraction',quality:'reported',currency:null,denominator:null};assert.throws(()=>validatePublicDataset(data),/denominator/);
  a.quantity={value:10,unit:'currency',quality:'reported',currency:null,denominator:null};assert.throws(()=>validatePublicDataset(data),/currency/);
  a.quantity={value:-1,unit:'shares',quality:'reported',currency:null,denominator:null};assert.throws(()=>validatePublicDataset(data),/quantity/);
  a.quantity=null;a.claim='FACT';assert.throws(()=>validatePublicDataset(data),/unsupported fact/);
});
test('duplicate identities, unknown participants and circular revisions rejected',()=>{
  const data=dataset();data.entities.push(data.entities[0]);assert.throws(()=>validatePublicDataset(data),/duplicate/);data.entities.pop();
  data.activities[0].participants[0].entityId='missing';assert.throws(()=>validatePublicDataset(data),/participants/);
  data.activities=[{...activity(),supersedesId:'a2'},{...activity(),id:'a2',supersedesId:'a1'}];assert.throws(()=>validatePublicDataset(data),/revision cycle/);
});
test('source links are safe and evidence is escaped',()=>{
  for(const url of ['javascript:alert(1)','data:text/html,x','https://user:password@example.com'])assert.equal(safePublicUrl(url),null);
  const p=provenance();p.evidence[0].excerpt='<script>alert(1)</script>';
  const output=renderToStaticMarkup(createElement(ProvenanceDetails,{data:p}));assert.ok(output.includes('&lt;script&gt;'));assert.ok(output.includes('noopener noreferrer'));
});
const storage=()=>{const map=new Map<string,string>();return {getItem:(key:string)=>map.get(key) ?? null,setItem:(key:string,value:string)=>{map.set(key,value);}};};
test('follow persists person/institution independently and unfollow is idempotent',()=>{
  const store=storage(),repo=createFollowingRepository(()=>store,()=> '2026-01-06');repo.read();repo.setFollowed('manager',true);repo.setFollowed('fund',true);repo.setFollowed('fund',true);
  assert.equal(createFollowingRepository(()=>store).read().snapshot.records.length,2);
  assert.equal(repo.setFollowed('fund',false).snapshot.records.length,1);assert.equal(repo.setFollowed('fund',false).snapshot.records.length,1);
});
test('cross-tab refresh merges sequential updates and storage clear removes follows',()=>{
  const store=storage(),a=createFollowingRepository(()=>store),b=createFollowingRepository(()=>store);a.setFollowed('manager',true);b.setFollowed('fund',true);
  assert.equal(a.refresh().snapshot.records.length,2);store.setItem(FOLLOWING_KEY,JSON.stringify({version:1,records:[]}));assert.equal(b.refresh().snapshot.records.length,0);
});
test('corrupt/future storage is not overwritten, read exception is safe',()=>{
  const store=storage();for(const raw of ['{bad','{"version":2,"records":[]}']) {store.setItem(FOLLOWING_KEY,raw);const repo=createFollowingRepository(()=>store);assert.ok(repo.read().warning);assert.ok(repo.setFollowed('fund',true).warning);assert.equal(store.getItem(FOLLOWING_KEY),raw);}
  assert.ok(createFollowingRepository(()=>{throw new Error('Denied');}).read().warning);
});
test('failed storage write retains explicit session-only state and does not claim persisted',()=>{
  const repo=createFollowingRepository(()=>({getItem:()=>null,setItem:()=>{throw new Error('quota');}}));
  const state=repo.setFollowed('fund',true);assert.equal(state.snapshot.records.length,1);assert.match(state.warning!,/只保留到離開此頁/);assert.equal(repo.read().snapshot.records.length,1);
});
test('invalid and duplicate follow records rejected, future unknown entity IDs preserved',()=>{
  assert.throws(()=>parseFollowing(JSON.stringify({version:1,records:[{entityId:'x',followedAt:'bad'}]})));
  const r={entityId:'future-entity',followedAt:'2026-01-01'};assert.throws(()=>parseFollowing(JSON.stringify({version:1,records:[r,r]})));
  assert.equal(parseFollowing(JSON.stringify({version:1,records:[r]})).records[0].entityId,'future-entity');
});
test('directory is SSR safe without localStorage and distinguishes institutions/no data',()=>{
  const output=renderToStaticMarkup(createElement(FollowingProvider,null,createElement(IntelligenceDirectory,{data:adaptPeopleRegistry(peopleRegistry)})));
  assert.ok(output.includes('載入追蹤狀態'));assert.ok(output.includes('機構'));assert.ok(output.includes('UNKNOWN'));assert.ok(!output.includes('Fictional activity'));
});
test('existing people anchors and filters retained, new UI uses responsive minmax and no provider calls',()=>{
  const page=readFileSync('app/people/page.tsx','utf8'),css=readFileSync('app/globals.css','utf8');assert.ok(page.includes('<PeopleDirectory'));
  assert.ok(css.includes('.intelligence-detail{grid-template-columns:minmax(0,1fr)}'));
  const service=readFileSync('lib/services/publicIntelligenceRepository.ts','utf8');assert.ok(!service.includes('fetch('));assert.ok(!service.includes('newsAnalysisProvider'));assert.ok(service.includes('activities:[]'));
});
