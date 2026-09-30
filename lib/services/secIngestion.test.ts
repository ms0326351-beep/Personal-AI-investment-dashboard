import test from 'node:test';
import assert from 'node:assert/strict';
import { createSecIngestionService, hashSecRawXml } from './secIngestionService';
import { InMemorySecIngestionRepository } from './secIngestionRepository';
import type { SecIngestionRepository } from '../types/secIngestion';
import { SecTransportError, type SecForm4Metadata, type SecResolvedXmlEnvelope } from '../types/secTransport';
import { secAccessionDirectoryUrl, secDocumentUrl, secFilingKey, validateSecMetadata } from '../utils/secEndpoints';
import { form4Fixtures, form4Xml } from '../utils/fixtures/secForm4Xml';
import { createSecClient } from './secClient';
import { createSecRequestGate, type SecClock } from './secRequestPolicy';

const input: SecForm4Metadata={cik:'12345',accessionNumber:'0000012345-26-000001',primaryDocument:'xslF345X03/fixture.xml',formType:'4',filingDate:'2026-01-05'};
const amended:SecForm4Metadata={...input,accessionNumber:'0000012345-26-000002',formType:'4/A'};
function envelope(rawXml=form4Fixtures.purchase, data=input):SecResolvedXmlEnvelope {
  const m=validateSecMetadata(data), base=secAccessionDirectoryUrl(m.cik,m.accessionNumber);
  return {...m,source:'SEC',filingKey:secFilingKey(m.accessionNumber),rawXml,sourceUrl:base+'fixture.xml',
    presentationUrl:secDocumentUrl(m),indexUrl:base+'index.json',resolvedDocument:'fixture.xml',resolutionMethod:'index_primary_basename',
    retrievedAt:'2026-09-30T00:00:00Z'};
}
function setup() {
  const repo=new InMemorySecIngestionRepository();let calls=0;let body=form4Fixtures.purchase;
  let failure:unknown=null;
  const transport={fetchResolvedForm4Document:async(m:SecForm4Metadata)=>{
    calls++;if(failure)throw failure;return envelope(body,m);
  }};
  return {repo,transport,service:createSecIngestionService(repo,transport),calls:()=>calls,
    body:(xml:string)=>{body=xml;},fail:(e:unknown)=>{failure=e;}};
}
test('ingestion first accession atomically creates filing and transaction',async()=>{
  const h=setup(),r=await h.service.ingestForm4Filing(input);
  assert.equal(r.status,'CREATED');assert.equal(r.created,true);assert.equal(r.state,'PARSED');assert.equal(r.transactionCount,1);
  const stored=await h.repo.getFilingByAccession(input.accessionNumber);
  assert.deepEqual(stored?.steps,['PENDING','FETCHED','PARSED']);assert.equal(stored?.transactions.length,1);
});
test('ingestion same accession repeated ten times is no-op without refetch',async()=>{
  const h=setup();await h.service.ingestForm4Filing(input);
  for(let i=0;i<10;i++)assert.equal((await h.service.ingestForm4Filing(input)).status,'ALREADY_EXISTS');
  assert.equal(h.calls(),1);assert.equal((await h.repo.getFilingByAccession(input.accessionNumber))?.transactions.length,1);
});
test('ingestion explicit same XML revalidation is idempotent',async()=>{
  const h=setup();await h.service.ingestForm4Filing(input);
  assert.equal((await h.service.ingestForm4Filing(input,{revalidate:true})).status,'ALREADY_EXISTS');assert.equal(h.calls(),2);
});
test('failed parse hash remains protected across transport failure and changed-content retry',async()=>{
  const h=setup();h.body(form4Fixtures.malformed);await h.service.ingestForm4Filing(input);
  const observedHash=hashSecRawXml(form4Fixtures.malformed);
  h.fail(new SecTransportError('TIMEOUT'));await h.service.ingestForm4Filing(input);
  assert.equal((await h.repo.getFilingByAccession(input.accessionNumber))?.provenance?.rawXmlHash,observedHash);
  h.fail(null);h.body(form4Fixtures.purchase);const r=await h.service.ingestForm4Filing(input);
  assert.equal(r.status,'INTEGRITY_CONFLICT');assert.equal(r.transactionCount,0);assert.equal(r.provenance?.rawXmlHash,observedHash);
});
test('ingestion different XML hash conflicts without overwriting original',async()=>{
  const h=setup();await h.service.ingestForm4Filing(input);const before=await h.repo.getFilingByAccession(input.accessionNumber);
  h.body(form4Fixtures.sale);const r=await h.service.ingestForm4Filing(input,{revalidate:true});
  assert.equal(r.status,'INTEGRITY_CONFLICT');assert.ok(r.warnings.includes('INTEGRITY_CONFLICT'));
  assert.deepEqual(await h.repo.getFilingByAccession(input.accessionNumber),before);
});
test('ingestion Form 4/A keeps separate accession and never overwrites original',async()=>{
  const h=setup();await h.service.ingestForm4Filing(input);h.body(form4Fixtures.amendment);await h.service.ingestForm4Filing(amended);
  const a=await h.repo.getFilingByAccession(input.accessionNumber),b=await h.repo.getFilingByAccession(amended.accessionNumber);
  assert.equal(a?.metadata.formType,'4');assert.equal(b?.metadata.formType,'4/A');
  assert.deepEqual(b?.amendment,{isAmendment:true,amendsAccessionNumber:null,lineageStatus:'unknown'});
  assert.notEqual(a?.transactions[0].id,b?.transactions[0].id);assert.equal(b?.parsed?.dateOfOriginalSubmission,'2026-01-03');
});
for(const code of ['TIMEOUT','NETWORK_ERROR','SEC_5XX','RATE_LIMITED'] as const) test(`ingestion ${code} persists retryable failure, no success rows`,async()=>{
  const h=setup();h.fail(new SecTransportError(code));const r=await h.service.ingestForm4Filing(input);
  assert.equal(r.status,'FAILED');assert.equal(r.failure?.category,'TRANSPORT');assert.equal(r.failure?.retryable,true);
  const stored=await h.repo.getFilingByAccession(input.accessionNumber);assert.equal(stored?.state,'FAILED');assert.deepEqual(stored?.transactions,[]);
  assert.equal(h.calls(),1);
});
test('ingestion retry after transient failure succeeds once',async()=>{
  const h=setup();h.fail(new SecTransportError('SEC_5XX',500));await h.service.ingestForm4Filing(input);h.fail(null);
  assert.equal((await h.service.ingestForm4Filing(input)).status,'CREATED');
  assert.equal((await h.service.ingestForm4Filing(input)).status,'ALREADY_EXISTS');assert.equal(h.calls(),2);
});
test('ingestion parser failure creates no successful transactions',async()=>{
  const h=setup();h.body(form4Fixtures.malformed);const r=await h.service.ingestForm4Filing(input);
  assert.equal(r.status,'FAILED');assert.equal(r.parserStatus,'unavailable');assert.equal(r.failure?.category,'PARSER');assert.equal(r.transactionCount,0);
  assert.ok(r.provenance?.rawXmlHash);
});
test('ingestion partial preserves supported rows, unsupported counts and diagnostics',async()=>{
  const h=setup();h.body(form4Xml({extra:'<derivativeTable><derivativeTransaction/></derivativeTable>'}));
  const r=await h.service.ingestForm4Filing(input);assert.equal(r.status,'CREATED');assert.equal(r.state,'PARTIAL');
  assert.equal(r.transactionCount,1);assert.ok(r.warnings.includes('unsupported_rows'));
  const stored=await h.repo.getFilingByAccession(input.accessionNumber);assert.equal(stored?.parsed?.unsupported.derivativeTransactions,1);
  assert.equal((await h.service.ingestForm4Filing(input)).status,'ALREADY_EXISTS');
});
test('ingestion multiple rows have stable accession-scoped identities after retry',async()=>{
  const h=setup();h.body(form4Fixtures.multiple);await h.service.ingestForm4Filing(input);
  const before=await h.repo.getFilingByAccession(input.accessionNumber);await h.service.ingestForm4Filing(input,{revalidate:true});
  const after=await h.repo.getFilingByAccession(input.accessionNumber);assert.deepEqual(after?.transactions,before?.transactions);
  assert.deepEqual(after?.transactions.map(t=>t.id),[1,2].map(i=>`sec:${input.accessionNumber}:non_derivative:${i}`));
});
test('ingestion identical row values in distinct accessions remain distinct',async()=>{
  const h=setup();await h.service.ingestForm4Filing(input);const second={...input,accessionNumber:amended.accessionNumber};
  await h.service.ingestForm4Filing(second);
  const a=await h.repo.getFilingByAccession(input.accessionNumber),b=await h.repo.getFilingByAccession(second.accessionNumber);
  assert.equal(a?.transactions[0].data.shares,b?.transactions[0].data.shares);assert.notEqual(a?.transactions[0].id,b?.transactions[0].id);
});
test('ingestion invalid accession rejected before repository and transport',async()=>{
  const h=setup();await assert.rejects(h.service.ingestForm4Filing({...input,accessionNumber:'../invalid'}));assert.equal(h.calls(),0);
});
test('ingestion retains provenance and parser versions without conflating dates',async()=>{
  const h=setup(),r=await h.service.ingestForm4Filing(input),p=r.provenance!;
  assert.equal(p.primaryDocument,input.primaryDocument);assert.equal(p.source,'SEC');assert.equal(p.cik,'0000012345');
  assert.equal(p.sourceUrl,envelope().sourceUrl);assert.equal(p.presentationUrl,envelope().presentationUrl);assert.equal(p.indexUrl,envelope().indexUrl);
  assert.equal(p.parserVersion,'form4-xml-v1');assert.equal(p.parserSchemaVersion,'form4-source-v1');
  const stored=await h.repo.getFilingByAccession(input.accessionNumber);assert.equal(stored?.parsed?.source?.dates.asOfDate,null);
  assert.equal(stored?.parsed?.source?.dates.periodEnd,null);assert.equal(stored?.transactions[0].data.transactionDate,'2026-01-02');
  assert.equal(p.filingDate,'2026-01-05');assert.equal(p.retrievedAt,'2026-09-30T00:00:00Z');
});
test('raw XML SHA256 is deterministic and sensitive to exact content',()=>{
  assert.equal(hashSecRawXml('abc'),'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(hashSecRawXml(form4Fixtures.purchase),hashSecRawXml(form4Fixtures.purchase));
  assert.notEqual(hashSecRawXml(form4Fixtures.purchase),hashSecRawXml(form4Fixtures.purchase+'\n'));
});
test('repository rejects invalid row snapshot atomically',async()=>{
  const h=setup();h.body(form4Fixtures.multiple);await h.service.ingestForm4Filing(input);
  const record=(await h.repo.getFilingByAccession(input.accessionNumber))!;record.transactions[1].id='bad';
  const empty=new InMemorySecIngestionRepository();await assert.rejects(empty.saveIngestion(record));
  assert.equal(await empty.getFilingByAccession(input.accessionNumber),null);
});
test('repository failure leaves no partial success and retry can succeed',async()=>{
  const h=setup();let fails=true;
  const repository:SecIngestionRepository={getFilingByAccession:a=>h.repo.getFilingByAccession(a),saveIngestion:async r=>{
    if(fails)throw new Error('private storage details');return h.repo.saveIngestion(r);
  }};
  const service=createSecIngestionService(repository,h.transport);const r=await service.ingestForm4Filing(input);
  assert.equal(r.failure?.category,'REPOSITORY');assert.equal(r.transactionCount,0);assert.equal(await h.repo.getFilingByAccession(input.accessionNumber),null);
  assert.ok(!JSON.stringify(r).includes('private storage'));fails=false;assert.equal((await service.ingestForm4Filing(input)).status,'CREATED');
});
test('repository read failure prevents network and returns classified failure',async()=>{
  const h=setup();const repository:SecIngestionRepository={getFilingByAccession:async()=>{throw new Error('private');},saveIngestion:r=>h.repo.saveIngestion(r)};
  const r=await createSecIngestionService(repository,h.transport).ingestForm4Filing(input);assert.equal(r.failure?.category,'REPOSITORY');assert.equal(h.calls(),0);
});
test('ingestion result deterministic with fixed input and fresh repositories',async()=>{
  assert.deepEqual(await setup().service.ingestForm4Filing(input),await setup().service.ingestForm4Filing(input));
});
test('concurrent services sharing repository insert accession only once',async()=>{
  const h=setup();const services=Array.from({length:10},()=>createSecIngestionService(h.repo,h.transport));
  const results=await Promise.all(services.map(s=>s.ingestForm4Filing(input)));
  assert.equal(results.filter(r=>r.status==='CREATED').length,1);assert.equal(results.filter(r=>r.status==='ALREADY_EXISTS').length,9);
  assert.equal((await h.repo.getFilingByAccession(input.accessionNumber))?.transactions.length,1);
});
test('repository catches conflicting content in concurrent first ingestions',async()=>{
  const h=setup();const other=createSecIngestionService(h.repo,{fetchResolvedForm4Document:async m=>envelope(form4Fixtures.sale,m)});
  const results=await Promise.all([h.service.ingestForm4Filing(input),other.ingestForm4Filing(input)]);
  assert.equal(results.filter(r=>r.status==='CREATED').length,1);assert.equal(results.filter(r=>r.status==='INTEGRITY_CONFLICT').length,1);
});
test('late failed attempt cannot erase a committed filing',async()=>{
  const h=setup();await h.service.ingestForm4Filing(input);const before=await h.repo.getFilingByAccession(input.accessionNumber);
  h.fail(new SecTransportError('TIMEOUT'));const r=await h.service.ingestForm4Filing(input,{revalidate:true});
  assert.equal(r.status,'FAILED');assert.deepEqual(await h.repo.getFilingByAccession(input.accessionNumber),before);
});
test('repository reads and result mutations cannot mutate stored records',async()=>{
  const h=setup();const r=await h.service.ingestForm4Filing(input);r.provenance!.rawXmlHash='changed';
  const read=(await h.repo.getFilingByAccession(input.accessionNumber))!;read.transactions.splice(0);
  const stored=(await h.repo.getFilingByAccession(input.accessionNumber))!;
  assert.equal(stored.transactions.length,1);assert.equal(stored.provenance?.rawXmlHash,hashSecRawXml(form4Fixtures.purchase));
});
test('same accession cannot be silently relabeled as amendment',async()=>{
  const h=setup();await h.service.ingestForm4Filing(input);
  assert.equal((await h.service.ingestForm4Filing({...input,formType:'4/A'})).status,'METADATA_CONFLICT');assert.equal(h.calls(),1);
});
test('resolver failures remain distinct from transport and parser failures',async()=>{
  const h=setup();h.fail(new SecTransportError('AMBIGUOUS_OWNERSHIP_DOCUMENT'));
  const r=await h.service.ingestForm4Filing(input);assert.equal(r.failure?.category,'RESOLUTION');assert.equal(r.failure?.retryable,false);
});
test('envelope from wrong accession or outside raw directory is never saved as success',async()=>{
  for(const override of [{accessionNumber:amended.accessionNumber},{sourceUrl:'https://example.invalid/other.xml'},{indexUrl:'https://example.invalid/index.json'}]){
    const repo=new InMemorySecIngestionRepository();const s=createSecIngestionService(repo,{fetchResolvedForm4Document:async()=>({...envelope(),...override})});
    const r=await s.ingestForm4Filing(input);assert.equal(r.failure?.code,'ENVELOPE_MISMATCH');assert.equal(r.transactionCount,0);
  }
});
test('unknown transport error is sanitized and not auto-retried',async()=>{
  const h=setup();h.fail(new Error('private contact data'));const r=await h.service.ingestForm4Filing(input);
  assert.equal(r.failure?.code,'UNEXPECTED_TRANSPORT_ERROR');assert.ok(!JSON.stringify(r).includes('private contact'));assert.equal(h.calls(),1);
});
test('Form type mismatch parser result creates no transaction records',async()=>{
  const h=setup();h.body(form4Fixtures.amendment);const r=await h.service.ingestForm4Filing(input);
  assert.equal(r.failure?.category,'PARSER');assert.equal(r.transactionCount,0);
});
test('unknown identity stays unknown, joint owners are not assigned transactions',async()=>{
  const h=setup();h.body(form4Fixtures.joint);await h.service.ingestForm4Filing(input);
  const record=await h.repo.getFilingByAccession(input.accessionNumber);
  assert.equal(record?.parsed?.source?.reportingOwners.length,2);
  assert.equal(record?.parsed?.source?.reportingOwners[0].identity.verified,false);
  assert.equal(record?.transactions[0].data.ownerAttribution.status,'unknown');
});
test('atomic publication exposes either no record or the complete filing and all rows',async()=>{
  const h=setup();h.body(form4Fixtures.multiple);
  let release!:()=>void,entered!:()=>void;
  const barrier=new Promise<void>(resolve=>{release=resolve;});const ready=new Promise<void>(resolve=>{entered=resolve;});
  const service=createSecIngestionService({getFilingByAccession:a=>h.repo.getFilingByAccession(a),saveIngestion:async r=>{
    entered();await barrier;return h.repo.saveIngestion(r);
  }},h.transport);
  const pending=service.ingestForm4Filing(input);await ready;
  assert.equal(await h.repo.getFilingByAccession(input.accessionNumber),null);release();await pending;
  const stored=await h.repo.getFilingByAccession(input.accessionNumber);assert.equal(stored?.state,'PARSED');assert.equal(stored?.transactions.length,2);
});
test('repository failed snapshot cannot replace a concurrent successful snapshot',async()=>{
  const h=setup();await h.service.ingestForm4Filing(input);const before=await h.repo.getFilingByAccession(input.accessionNumber);
  const failed=setup();failed.fail(new SecTransportError('TIMEOUT'));await failed.service.ingestForm4Filing(input);
  const outcome=await h.repo.saveIngestion((await failed.repo.getFilingByAccession(input.accessionNumber))!);
  assert.equal(outcome.outcome,'ALREADY_EXISTS');assert.deepEqual(await h.repo.getFilingByAccession(input.accessionNumber),before);
});
test('ingestion integrates existing SEC index resolver and parser with offline fetch only',async()=>{
  let now=Date.parse('2026-09-30T00:00:00Z');const urls:string[]=[];
  const clock:SecClock={now:()=>now,sleep:async ms=>{now+=ms;},timeout:()=>()=>{}};
  const base=secAccessionDirectoryUrl(input.cik,input.accessionNumber);
  const responses=[new Response(JSON.stringify({directory:{item:[{name:'fixture.xml'}]}}),{headers:{'content-type':'application/json'}}),
    new Response(form4Fixtures.purchase,{headers:{'content-type':'text/xml'}})];
  const client=createSecClient({userAgent:'Offline tests <qa@example.invalid>'},{clock,gate:createSecRequestGate(clock),fetch:async url=>{
    urls.push(String(url));const response=responses.shift();assert.ok(response);return response;
  }});
  const r=await createSecIngestionService(new InMemorySecIngestionRepository(),client).ingestForm4Filing(input);
  assert.equal(r.status,'CREATED');assert.equal(r.transactionCount,1);assert.deepEqual(urls,[base+'index.json',base+'fixture.xml']);
  assert.ok(!JSON.stringify(r).includes('qa@example.invalid'));
});
