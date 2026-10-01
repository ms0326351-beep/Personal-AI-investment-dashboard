import test from 'node:test';
import assert from 'node:assert/strict';
import { createSecIngestionService } from './secIngestionService';
import { InMemorySecIngestionRepository } from './secIngestionRepository';
import { InMemorySecIngestionAudit } from './secIngestionAudit';
import { parseForm4Xml, SEC_FORM4_PARSER_VERSION } from '../utils/secForm4Parser';
import { secPersistenceAmounts } from '../utils/secPersistenceAmounts';
import { form4Fixtures } from '../utils/fixtures/secForm4Xml';
import { secAccessionDirectoryUrl, secDocumentUrl, secFilingKey, validateSecMetadata } from '../utils/secEndpoints';
import type { SecForm4Metadata } from '../types/secTransport';
import type { SecIngestionAttempt } from '../types/secIngestion';

const input:SecForm4Metadata={cik:'12345',accessionNumber:'0000012345-26-000001',primaryDocument:'fixture.xml',formType:'4',filingDate:'2026-01-05'};
const time='2026-10-01T00:00:00Z';
const transport={fetchResolvedForm4Document:async(m:SecForm4Metadata)=>{
  const data=validateSecMetadata(m),base=secAccessionDirectoryUrl(data.cik,data.accessionNumber);
  return {...data,source:'SEC' as const,filingKey:secFilingKey(data.accessionNumber),rawXml:form4Fixtures.purchase,
    sourceUrl:base+'fixture.xml',presentationUrl:secDocumentUrl(data),indexUrl:base+'index.json',resolvedDocument:'fixture.xml',
    resolutionMethod:'index_primary_basename' as const,retrievedAt:time};
}};
function parsedDecimals(shares:string,price:string){
  return parseForm4Xml(form4Fixtures.purchase.replace('<value>100</value>','<value>'+shares+'</value>')
    .replace('<value>12.50</value>','<value>'+price+'</value>'),
    {filingId:input.accessionNumber,sourceIdentifier:'fixture',origin:'mock',retrievedAt:time});
}
test('persistence boundary keeps exact decimal fractions and trailing zeros',()=>{
  const p=parsedDecimals('0.1','0.20000000000000000001'),row=p.source!.transactions[0];
  const values=secPersistenceAmounts(p,row);assert.equal(values.shares,'0.1');assert.equal(values.price,'0.20000000000000000001');
  assert.equal(values.transactionValue,null); // no floating multiplication or invented basis
});
test('persistence boundary preserves large source quantity without number round-trip',()=>{
  const p=parsedDecimals('9007199254740993.125','12.50');
  assert.equal(secPersistenceAmounts(p,p.source!.transactions[0]).shares,'9007199254740993.125');
});
test('missing or ambiguous decimal stays null and is not reconstructed from parsed number',()=>{
  const p=parsedDecimals('100','12.50'),row=p.source!.transactions[0],locator=row.evidence[0].locator!;
  delete p.rawFields[`${locator}/transactionAmounts/transactionPricePerShare/value`];
  assert.equal(row.price,12.5);assert.equal(secPersistenceAmounts(p,row).price,null);
  p.rawFields[`${locator}/transactionAmounts/transactionPricePerShare/value`]='1e3';
  assert.equal(secPersistenceAmounts(p,row).price,null);
});
test('untyped save error is outcome UNKNOWN even when rollback may have happened',async()=>{
  const base=new InMemorySecIngestionRepository(),audit=new InMemorySecIngestionAudit();
  const service=createSecIngestionService({getFilingByAccession:a=>base.getFilingByAccession(a),saveIngestion:async()=>{throw new Error('private details');}},transport,{audit,now:()=>time});
  const r=await service.ingestForm4Filing(input);assert.equal(r.status,'ACKNOWLEDGEMENT_UNKNOWN');assert.equal(r.persistenceOutcome,'UNKNOWN');
  assert.equal(r.transactionCount,null);assert.equal(r.failure?.retryable,true);assert.equal(await base.getFilingByAccession(input.accessionNumber),null);
  assert.ok(!JSON.stringify(r).includes('private details'));
});
test('read failure has NOT_COMMITTED outcome, since no write was attempted',async()=>{
  let calls=0;
  const r=await createSecIngestionService({getFilingByAccession:async()=>{throw new Error('private');},saveIngestion:async()=>{calls++;throw new Error();}},transport)
    .ingestForm4Filing(input);
  assert.equal(r.status,'FAILED');assert.equal(r.persistenceOutcome,'NOT_COMMITTED');assert.equal(calls,0);
});
test('audit failure is observable but does not erase successful filing',async()=>{
  const repo=new InMemorySecIngestionRepository();
  const r=await createSecIngestionService(repo,transport,{audit:{recordAttempt:async()=>{throw new Error('private');}},now:()=>time}).ingestForm4Filing(input);
  assert.equal(r.status,'CREATED');assert.equal(r.auditStatus,'UNAVAILABLE');assert.ok(r.warnings.includes('AUDIT_UNAVAILABLE'));
  assert.equal((await repo.getFilingByAccession(input.accessionNumber))?.state,'PARSED');assert.ok(!JSON.stringify(r).includes('private'));
});
test('audit picks only safe fields and returns detached snapshots',async()=>{
  const audit=new InMemorySecIngestionAudit();await createSecIngestionService(new InMemorySecIngestionRepository(),transport,{audit,now:()=>time}).ingestForm4Filing(input);
  const a=(await audit.getAttempts(input.accessionNumber))[0];
  const extra={...a,requestConfig:'private-config',metadata:{...a.metadata,requestConfig:'private-config'}};
  await audit.recordAttempt(extra);const stored=await audit.getAttempts(input.accessionNumber);
  assert.ok(!JSON.stringify(stored).includes('private-config'));stored[0].warnings.push('MUTATED');
  assert.deepEqual((await audit.getAttempts(input.accessionNumber))[0].warnings,a.warnings);
});
test('audit rejects arbitrary exception text in code field',async()=>{
  const audit=new InMemorySecIngestionAudit();await createSecIngestionService(new InMemorySecIngestionRepository(),transport,{audit,now:()=>time}).ingestForm4Filing(input);
  const a:SecIngestionAttempt=(await audit.getAttempts(input.accessionNumber))[0];
  a.failure={category:'REPOSITORY',code:'private exception text',retryable:true};await assert.rejects(audit.recordAttempt(a));
});
test('exported parser version is deterministic and agrees with parsed provenance',()=>{
  const p=parsedDecimals('100','12.50');assert.equal(SEC_FORM4_PARSER_VERSION,'form4-xml-v1');
  assert.equal(p.source?.provenance.parserVersion,SEC_FORM4_PARSER_VERSION);
});
test('retry success preserves failure attempt rather than replacing history',async()=>{
  const repo=new InMemorySecIngestionRepository(),audit=new InMemorySecIngestionAudit();let failure=true;
  const service=createSecIngestionService({getFilingByAccession:a=>repo.getFilingByAccession(a),saveIngestion:async r=>{
    if(failure)throw new Error('unknown write outcome');return repo.saveIngestion(r);
  }},transport,{audit,now:()=>time});
  await service.ingestForm4Filing(input);failure=false;assert.equal((await service.ingestForm4Filing(input)).status,'CREATED');
  assert.deepEqual((await audit.getAttempts(input.accessionNumber)).map(a=>a.outcome),['ACKNOWLEDGEMENT_UNKNOWN','CREATED']);
});
