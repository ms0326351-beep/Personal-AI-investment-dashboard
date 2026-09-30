import test from 'node:test';
import assert from 'node:assert/strict';
import { createSecClient } from './secClient';
import { createSecRequestGate, type SecClock } from './secRequestPolicy';
import { SecTransportError, type SecErrorCode } from '../types/secTransport';
import { form4Fixtures } from '../utils/fixtures/secForm4Xml';

const metadata = {cik:'12345',accessionNumber:'0000012345-26-000001',primaryDocument:'xslF345X03/form4.xml',formType:'4' as const,filingDate:'2026-01-05'};
const base='https://www.sec.gov/Archives/edgar/data/12345/000001234526000001/';
const json=(data:unknown)=>new Response(JSON.stringify(data),{headers:{'content-type':'application/json'}});
const index=(...names:string[])=>json({directory:{name:new URL(base).pathname.slice(0,-1),item:names.map(name=>({name,type:'text.xml'}))}});
const xml=(body=form4Fixtures.purchase, mime='text/xml')=>new Response(body,{headers:{'content-type':mime}});
function setup(replies:Response[], primaryDocument=metadata.primaryDocument) {
  let now=Date.parse('2026-09-30T00:00:00Z'); const urls:string[]=[];
  const clock:SecClock={now:()=>now,sleep:async ms=>{now+=ms;},timeout:()=>()=>{}};
  const client=createSecClient({userAgent:'Offline tests <qa@example.invalid>',maxAttempts:1},{clock,gate:createSecRequestGate(clock),
    fetch:async url=>{urls.push(String(url)); const response=replies.shift(); assert.ok(response,'Unexpected request'); return response;}});
  return {urls,run:()=>client.fetchAndParseForm4({...metadata,primaryDocument})};
}
const error=(code:SecErrorCode)=>(e:unknown)=>e instanceof SecTransportError && e.code===code;

for(const name of ['form4.xml','xslF345X03/form4.xml']) test(`resolver index confirms ${name} before fetching`,async()=>{
  const h=setup([index('form4.xml'),xml()],name); const r=await h.run();
  assert.deepEqual(h.urls,[base+'index.json',base+'form4.xml']);
  assert.equal(r.envelope.primaryDocument,name); assert.equal(r.envelope.presentationUrl,base+name);
  assert.equal(r.envelope.sourceUrl,base+'form4.xml'); assert.equal(r.envelope.resolutionMethod,'index_primary_basename');
  assert.equal(r.error,null); assert.ok(r.parsed.source?.transactions.length);
});
test('resolver finds non-hardcoded filename when primary hint is absent',async()=>{
  const h=setup([index('wk-form4_123.xml'),xml()]); const r=await h.run();
  assert.equal(r.envelope.resolvedDocument,'wk-form4_123.xml');assert.equal(r.envelope.resolutionMethod,'index_unique_ownership');
});
test('resolver excludes index.xml and verifies matching candidate before other XML',async()=>{
  const h=setup([index('index.xml','other.xml','form4.xml'),xml()]);await h.run();assert.equal(h.urls.length,2);
});
test('resolver selects unique ownership document, not first XML',async()=>{
  const h=setup([index('a.xml','b.xml'),xml('<other/>'),xml()]);const r=await h.run();assert.equal(r.envelope.resolvedDocument,'b.xml');
});
test('resolver rejects ambiguous ownership documents',async()=>{
  await assert.rejects(setup([index('a.xml','b.xml'),xml(),xml()]).run(),error('AMBIGUOUS_OWNERSHIP_DOCUMENT'));
});
test('resolver reports no candidates without guessing basename',async()=>{
  const h=setup([index('index.xml','filings.xml','directory.xml','page.htm')]);
  await assert.rejects(h.run(),error('OWNERSHIP_DOCUMENT_NOT_FOUND'));assert.equal(h.urls.length,1);
});
for(const [label,body,mime] of [
  ['HTML','<html>presentation</html>','text/html'],['HTML with XML MIME','<html/>','text/xml'],
  ['malformed','<ownershipDocument><broken></ownershipDocument>','text/xml'],
  ['different root','<other/>','text/xml'],
  ['DTD','<!DOCTYPE ownershipDocument [<!ENTITY x "value">]><ownershipDocument>&x;</ownershipDocument>','text/xml'],
  ['trailing root','<ownershipDocument/><other/>','text/xml'],
]) test(`resolver basename hint cannot bypass ${label} verification`,async()=>{
  await assert.rejects(setup([index('form4.xml'),xml(body,mime)]).run(),error(mime==='text/html'?'INVALID_RESPONSE':'OWNERSHIP_DOCUMENT_NOT_FOUND'));
});
test('resolver index 404 stays transport error',async()=>{
  await assert.rejects(setup([new Response('',{status:404})]).run(),error('SEC_4XX'));
});
test('resolver rejects malformed index JSON',async()=>{
  await assert.rejects(setup([new Response('{',{headers:{'content-type':'application/json'}})]).run(),error('INVALID_RESPONSE'));
});
test('resolver rejects invalid index structure and mismatched directory',async()=>{
  for(const value of [{},{directory:{item:null}},{directory:{name:'/another/accession',item:[]}}])
    await assert.rejects(setup([json(value)]).run(),error('INVALID_RESPONSE'));
});
test('resolver rejects traversal and external index filenames before document fetch',async()=>{
  for(const name of ['..','../a.xml','/a.xml','a/../b.xml','a\\b.xml','//evil/a.xml','http://evil/a.xml','https://evil/a.xml',
    '%2e%2e.xml','a.xml?x=1','a.xml#x','xslF345X03/a.xml']) {
    const h=setup([index(name)]);await assert.rejects(h.run(),error('INVALID_DOCUMENT'));assert.equal(h.urls.length,1);
  }
});
test('resolver bounds candidate requests without assuming uniqueness',async()=>{
  const h=setup([index(...Array.from({length:6},(_,i)=>`candidate${i}.xml`))]);
  await assert.rejects(h.run(),error('RESOLUTION_LIMIT_EXCEEDED'));assert.equal(h.urls.length,1);
});
test('resolver duplicate index entries do not cause duplicate requests or ambiguity',async()=>{
  const h=setup([index('a.xml','a.xml'),xml()]);await h.run();assert.equal(h.urls.length,2);
});
test('resolver candidate retrieval failure is not silently ignored for uniqueness',async()=>{
  await assert.rejects(setup([index('a.xml','b.xml'),xml(),new Response('',{status:503})]).run(),error('SEC_5XX'));
});
test('resolver invalid primary hint does not hide a unique verified alternative',async()=>{
  const r=await setup([index('form4.xml','valid.xml'),xml('<other/>'),xml()]).run();
  assert.equal(r.envelope.resolvedDocument,'valid.xml');
});
