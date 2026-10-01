import test from 'node:test';
import assert from 'node:assert/strict';
import type { SecIngestionRepository, SecIngestionAttempt, SecIngestionAudit } from '../../types/secIngestion';
import type { SecForm4Metadata, SecResolvedXmlEnvelope } from '../../types/secTransport';
import { SecTransportError } from '../../types/secTransport';
import { createSecIngestionService } from '../secIngestionService';
import { secAccessionDirectoryUrl, secDocumentUrl, secFilingKey, validateSecMetadata } from '../../utils/secEndpoints';
import { form4Fixtures, form4Xml } from '../../utils/fixtures/secForm4Xml';

/** Implement with independently acquired DB connections for a persistent adapter.
 * stats MUST inspect actual stored filings/rows; injected fault MUST hit the real
 * transaction boundary (e.g. second child INSERT), not merely throw before save.
 * Memory implementation validates whole snapshots; it proves no distributed DB claim.
 */
export interface SecAdapterContractHarness {
  repository: SecIngestionRepository;
  audit: SecIngestionAudit;
  attempts(accession:string):Promise<SecIngestionAttempt[]>;
  stats():Promise<{filings:number;transactions:number}>;
  faultNextSave(kind:'child_failure'|'rollback'|'ack_timeout'):void;
  dispose():Promise<void>;
}
const input:SecForm4Metadata={cik:'12345',accessionNumber:'0000012345-26-000001',primaryDocument:'fixture.xml',formType:'4',filingDate:'2026-01-05'};
const second={...input,accessionNumber:'0000012345-26-000002'};
const time='2026-10-01T00:00:00Z';
function envelope(xml:string,m:SecForm4Metadata):SecResolvedXmlEnvelope {
  const metadata=validateSecMetadata(m),base=secAccessionDirectoryUrl(metadata.cik,metadata.accessionNumber);
  return {...metadata,source:'SEC',filingKey:secFilingKey(metadata.accessionNumber),rawXml:xml,
    sourceUrl:base+'fixture.xml',presentationUrl:secDocumentUrl(metadata),indexUrl:base+'index.json',
    resolvedDocument:'fixture.xml',resolutionMethod:'index_primary_basename',retrievedAt:time};
}
export {input as secContractInput,envelope as secContractEnvelope};

/** Shared, offline contract registration. Future PostgreSQL/Neon adapters reuse
 * these tests with a new harness, including real rollback/count/fault assertions.
 */
export function registerSecAdapterContract(name:string,create:()=>Promise<SecAdapterContractHarness>):void {
  const run=(title:string,fn:(h:SecAdapterContractHarness)=>Promise<void>)=>test(`${name} contract: ${title}`,async()=>{
    const h=await create();try{await fn(h);}finally{await h.dispose();}
  });
  const service=(h:SecAdapterContractHarness,xml=form4Fixtures.purchase)=>createSecIngestionService(h.repository,
    {fetchResolvedForm4Document:async m=>envelope(xml,m)},{audit:h.audit,now:()=>time});
  const saved=async(h:SecAdapterContractHarness)=>{
    const r=await h.repository.getFilingByAccession(input.accessionNumber);assert.ok(r);return r;
  };
  run('first insert publishes complete filing and metadata',async h=>{
    const r=await service(h).ingestForm4Filing(input);assert.equal(r.status,'CREATED');assert.equal(r.state,'PARSED');
    assert.equal((await saved(h)).provenance?.source,'SEC');assert.deepEqual(await h.stats(),{filings:1,transactions:1});
  });
  run('duplicate accession is deterministic existing result',async h=>{
    const s=service(h);await s.ingestForm4Filing(input);const a=await s.ingestForm4Filing(input),b=await s.ingestForm4Filing(input);
    assert.equal(a.status,'ALREADY_EXISTS');assert.deepEqual(a,b);
  });
  run('ten concurrent workers return one created and nine existing',async h=>{
    const rs=await Promise.all(Array.from({length:10},()=>service(h).ingestForm4Filing(input)));
    assert.equal(rs.filter(r=>r.status==='CREATED').length,1);assert.equal(rs.filter(r=>r.status==='ALREADY_EXISTS').length,9);
    assert.deepEqual(await h.stats(),{filings:1,transactions:1});
  });
  run('exactly one logical filing after repeated saves',async h=>{
    await service(h).ingestForm4Filing(input);const r=await saved(h);
    await Promise.all(Array.from({length:10},()=>h.repository.saveIngestion(r)));assert.equal((await h.stats()).filings,1);
  });
  run('transactions exactly once including multiple rows',async h=>{
    const s=service(h,form4Fixtures.multiple);await s.ingestForm4Filing(input);await s.ingestForm4Filing(input,{revalidate:true});
    assert.equal((await h.stats()).transactions,2);assert.equal(new Set((await saved(h)).transactions.map(r=>r.id)).size,2);
  });
  run('different accessions retain equal transaction values independently',async h=>{
    await service(h).ingestForm4Filing(input);await service(h).ingestForm4Filing(second);
    const a=await saved(h),b=(await h.repository.getFilingByAccession(second.accessionNumber))!;
    for(const key of ['transactionDate','transactionCode','shares','price'] as const)assert.equal(a.transactions[0].data[key],b.transactions[0].data[key]);
    assert.notEqual(a.transactions[0].id,b.transactions[0].id);
    assert.deepEqual(await h.stats(),{filings:2,transactions:2});
  });
  run('child save failure rolls back all rows and filing',async h=>{
    h.faultNextSave('child_failure');const r=await service(h,form4Fixtures.multiple).ingestForm4Filing(input);
    assert.equal(r.persistenceOutcome,'NOT_COMMITTED');assert.equal(r.status,'FAILED');
    assert.deepEqual(await h.stats(),{filings:0,transactions:0});
  });
  run('confirmed repository rollback permits clean retry',async h=>{
    h.faultNextSave('rollback');const s=service(h);assert.equal((await s.ingestForm4Filing(input)).persistenceOutcome,'NOT_COMMITTED');
    assert.equal(await h.repository.getFilingByAccession(input.accessionNumber),null);
    assert.equal((await s.ingestForm4Filing(input)).status,'CREATED');
  });
  run('commit-success acknowledgement timeout does not imply rollback',async h=>{
    h.faultNextSave('ack_timeout');const r=await service(h).ingestForm4Filing(input);
    assert.equal(r.status,'ACKNOWLEDGEMENT_UNKNOWN');assert.equal(r.state,'UNKNOWN');assert.equal(r.transactionCount,null);
    assert.equal((await saved(h)).state,'PARSED');assert.deepEqual(await h.stats(),{filings:1,transactions:1});
  });
  run('retry after acknowledgement timeout resolves existing snapshot',async h=>{
    h.faultNextSave('ack_timeout');const s=service(h);await s.ingestForm4Filing(input);
    const r=await s.ingestForm4Filing(input);assert.equal(r.status,'ALREADY_EXISTS');assert.equal(r.persistenceOutcome,'CONFIRMED');
    assert.deepEqual(await h.stats(),{filings:1,transactions:1});
  });
  run('hash conflict preserves original and exposes both hashes to audit',async h=>{
    await service(h).ingestForm4Filing(input);const before=await saved(h);
    const r=await service(h,form4Fixtures.sale).ingestForm4Filing(input,{revalidate:true});assert.equal(r.status,'INTEGRITY_CONFLICT');
    assert.deepEqual(await saved(h),before);const attempt=(await h.attempts(input.accessionNumber)).at(-1)!;
    assert.equal(attempt.existingRawXmlHash,before.provenance?.rawXmlHash);assert.notEqual(attempt.rawXmlHash,attempt.existingRawXmlHash);
  });
  run('partial preserves supported rows and unsupported diagnostics',async h=>{
    await service(h,form4Xml({extra:'<derivativeTable><derivativeTransaction/></derivativeTable>'})).ingestForm4Filing(input);
    const before=await saved(h);assert.equal(before.state,'PARTIAL');assert.equal(before.transactions.length,1);
    assert.equal(before.parsed?.unsupported.derivativeTransactions,1);
    await service(h).ingestForm4Filing(input);assert.deepEqual(await saved(h),before);
  });
  run('parser failure is stored without successful transactions',async h=>{
    const r=await service(h,form4Fixtures.malformed).ingestForm4Filing(input);assert.equal(r.status,'FAILED');
    assert.equal(r.failure?.category,'PARSER');assert.equal((await saved(h)).state,'FAILED');assert.equal((await h.stats()).transactions,0);
  });
  run('ordinary save is not an implicit reprocessing operation',async h=>{
    await service(h,form4Xml({extra:'<derivativeTable><derivativeTransaction/></derivativeTable>'})).ingestForm4Filing(input);
    const before=await saved(h),candidate=structuredClone(before);candidate.state='PARSED';candidate.parsed!.status='parsed';
    const r=await h.repository.saveIngestion(candidate);assert.equal(r.outcome,'ALREADY_EXISTS');assert.deepEqual(await saved(h),before);
  });
  run('new parser version cannot overwrite active revision',async h=>{
    await service(h).ingestForm4Filing(input);const before=await saved(h),candidate=structuredClone(before);
    candidate.provenance!.parserVersion='form4-xml-v2';candidate.parsed!.source!.provenance.parserVersion='form4-xml-v2';
    assert.equal((await h.repository.saveIngestion(candidate)).outcome,'ALREADY_EXISTS');assert.deepEqual(await saved(h),before);
  });
  run('successful attempt has timestamp parser and exact source hash',async h=>{
    const r=await service(h).ingestForm4Filing(input);assert.equal(r.auditStatus,'RECORDED');
    const a=(await h.attempts(input.accessionNumber))[0];assert.equal(a.outcome,'CREATED');assert.equal(a.attemptedAt,time);
    assert.equal(a.parserVersion,'form4-xml-v1');assert.equal(a.rawXmlHash,r.provenance?.rawXmlHash);
  });
  run('transient failure records safe classification and no parser version',async h=>{
    const s=createSecIngestionService(h.repository,{fetchResolvedForm4Document:async()=>{throw new SecTransportError('TIMEOUT');}},{audit:h.audit,now:()=>time});
    await s.ingestForm4Filing(input);const a=(await h.attempts(input.accessionNumber))[0];
    assert.equal(a.failure?.category,'TRANSPORT');assert.equal(a.retryable,true);assert.equal(a.parserVersion,null);assert.equal(a.rawXmlHash,null);
  });
  run('conflict audit recorded even when service returns before repository save',async h=>{
    await service(h).ingestForm4Filing(input);await service(h,form4Fixtures.sale).ingestForm4Filing(input,{revalidate:true});
    assert.equal((await h.attempts(input.accessionNumber)).at(-1)?.outcome,'INTEGRITY_CONFLICT');
  });
  run('unknown commit outcome retained in attempt history',async h=>{
    h.faultNextSave('ack_timeout');const s=service(h);await s.ingestForm4Filing(input);await s.ingestForm4Filing(input);
    const a=await h.attempts(input.accessionNumber);assert.equal(a.length,2);assert.equal(a[0].persistenceOutcome,'UNKNOWN');assert.equal(a[1].outcome,'ALREADY_EXISTS');
  });
  run('stable result with fixed input and clock',async h=>{
    await service(h).ingestForm4Filing(input);assert.deepEqual(await service(h).ingestForm4Filing(input),await service(h).ingestForm4Filing(input));
  });
  run('metadata conflict also protects failed observations',async h=>{
    await service(h,form4Fixtures.malformed).ingestForm4Filing(input);const before=await saved(h);
    const r=await service(h).ingestForm4Filing({...input,formType:'4/A'});assert.equal(r.status,'METADATA_CONFLICT');assert.deepEqual(await saved(h),before);
  });
  run('amendment uses distinct accession without inferred parent',async h=>{
    await service(h).ingestForm4Filing(input);await service(h,form4Fixtures.amendment).ingestForm4Filing({...second,formType:'4/A'});
    const amended=await h.repository.getFilingByAccession(second.accessionNumber);
    assert.equal(amended?.amendment.isAmendment,true);assert.equal(amended?.amendment.amendsAccessionNumber,null);
    assert.deepEqual(await h.stats(),{filings:2,transactions:2});
  });
  run('parser version is required for successful snapshots',async h=>{
    await service(h).ingestForm4Filing(input);const candidate=await saved(h);candidate.provenance!.parserVersion=null;
    await assert.rejects(h.repository.saveIngestion(candidate));
  });
  run('decimal strings must match original source lexemes',async h=>{
    await service(h).ingestForm4Filing(input);const candidate=await saved(h);candidate.transactions[0].persistenceAmounts.price='999.999';
    await assert.rejects(h.repository.saveIngestion(candidate));
  });
  run('concurrent reads observe absent or complete snapshot, never half rows',async h=>{
    const pending=service(h,form4Fixtures.multiple).ingestForm4Filing(input);
    for(let i=0;i<10;i++){
      const r=await h.repository.getFilingByAccession(input.accessionNumber);
      if(r){assert.equal(r.state,'PARSED');assert.equal(r.transactions.length,2);assert.equal(r.parsed?.source?.transactions.length,2);}
    }
    await pending;assert.deepEqual(await h.stats(),{filings:1,transactions:2});
  });
  run('concurrent distinct accessions complete independently',async h=>{
    const results=await Promise.all([service(h).ingestForm4Filing(input),service(h).ingestForm4Filing(second)]);
    assert.ok(results.every(r=>r.status==='CREATED'));assert.deepEqual(await h.stats(),{filings:2,transactions:2});
  });
  run('concurrent partial snapshots cannot mix or inflate rows',async h=>{
    const xml=form4Xml({extra:'<derivativeTable><derivativeTransaction/></derivativeTable>'});
    const results=await Promise.all(Array.from({length:10},()=>service(h,xml).ingestForm4Filing(input)));
    assert.equal(results.filter(r=>r.status==='CREATED').length,1);assert.ok(results.every(r=>r.state==='PARTIAL'));
    assert.deepEqual(await h.stats(),{filings:1,transactions:1});
  });
  run('failed revalidation attempt retains successful filing and audit history',async h=>{
    await service(h).ingestForm4Filing(input);const before=await saved(h);
    const s=createSecIngestionService(h.repository,{fetchResolvedForm4Document:async()=>{throw new SecTransportError('TIMEOUT');}},{audit:h.audit,now:()=>time});
    const r=await s.ingestForm4Filing(input,{revalidate:true});assert.equal(r.status,'FAILED');assert.deepEqual(await saved(h),before);
    assert.equal((await h.attempts(input.accessionNumber)).at(-1)?.failure?.code,'TIMEOUT');
  });
}
