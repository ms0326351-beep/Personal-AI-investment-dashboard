import test from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryRawXmlStore } from './rawXmlStore';
import { hashSecRawXml,createSecIngestionService } from './secIngestionService';
import { InMemorySecIngestionRepository } from './secIngestionRepository';
import { secContractInput as input,secContractEnvelope as envelope } from './testing/secIngestionContract';
import { form4Fixtures } from '../utils/fixtures/secForm4Xml';

const xml=form4Fixtures.purchase;
const document={accessionNumber:input.accessionNumber,rawXml:xml,rawXmlHash:hashSecRawXml(xml),hashBasis:'decoded_xml_utf8' as const,
  sourceUrl:envelope(xml,input).sourceUrl,retrievedAt:'2026-10-02T00:00:00Z'};
test('retention immutable insert/read/exists and copy isolation',async()=>{
  const store=new InMemoryRawXmlStore();assert.equal(await store.exists(input.accessionNumber),false);
  assert.equal((await store.putImmutable(document)).status,'CREATED');assert.equal(await store.exists(input.accessionNumber),true);
  const read=await store.get(input.accessionNumber);assert.ok(read);read.rawXml='changed';assert.equal((await store.get(input.accessionNumber))?.rawXml,xml);
});
test('same accession/hash is idempotent under concurrent calls',async()=>{
  const store=new InMemoryRawXmlStore();const results=await Promise.all(Array.from({length:10},()=>store.putImmutable(document)));
  assert.equal(results.filter(r=>r.status==='CREATED').length,1);assert.equal(results.filter(r=>r.status==='ALREADY_EXISTS').length,9);
});
test('different hash conflicts without overwrite',async()=>{
  const store=new InMemoryRawXmlStore();await store.putImmutable(document);
  assert.equal((await store.putImmutable({...document,rawXml:'other',rawXmlHash:hashSecRawXml('other')})).status,'INTEGRITY_CONFLICT');
  assert.equal((await store.get(input.accessionNumber))?.rawXml,xml);
});
test('incorrect hash cannot become stored provenance',async()=>{
  const store=new InMemoryRawXmlStore();await assert.rejects(store.putImmutable({...document,rawXmlHash:'0'.repeat(64)}));assert.equal(await store.exists(input.accessionNumber),false);
});
test('service retains reference and original XML before parser handoff',async()=>{
  const repository=new InMemorySecIngestionRepository(),store=new InMemoryRawXmlStore();
  const result=await createSecIngestionService(repository,{fetchResolvedForm4Document:async m=>envelope(xml,m)},{rawXmlStore:store}).ingestForm4Filing(input);
  assert.equal(result.status,'CREATED');assert.equal(result.provenance?.rawXmlReference?.rawXmlHash,document.rawXmlHash);
  assert.equal((await store.get(input.accessionNumber))?.rawXml,xml);
});
test('retention unavailable does not save false success',async()=>{
  const repository=new InMemorySecIngestionRepository();
  const store={putImmutable:async()=>{throw new Error('sensitive upstream');},get:async()=>null,exists:async()=>false};
  const result=await createSecIngestionService(repository,{fetchResolvedForm4Document:async m=>envelope(xml,m)},{rawXmlStore:store}).ingestForm4Filing(input);
  assert.equal(result.failure?.code,'RAW_XML_RETENTION_UNAVAILABLE');assert.equal(result.persistenceOutcome,'NOT_COMMITTED');
  assert.equal(await repository.getFilingByAccession(input.accessionNumber),null);assert.equal(JSON.stringify(result).includes('sensitive upstream'),false);
});
test('malformed XML is retained without inventing successful transactions',async()=>{
  const repository=new InMemorySecIngestionRepository(),store=new InMemoryRawXmlStore();
  const result=await createSecIngestionService(repository,{fetchResolvedForm4Document:async m=>envelope('<bad',m)},{rawXmlStore:store}).ingestForm4Filing(input);
  assert.equal(result.status,'FAILED');assert.equal(result.transactionCount,0);assert.equal(await store.exists(input.accessionNumber),true);
});
