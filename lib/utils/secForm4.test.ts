import test from 'node:test';
import assert from 'node:assert/strict';
import type { FilingIdentity } from '../types/publicFilings';
import type { Form4Source } from '../types/secForm4';
import { assessForm4Source, resolveForm4Party, validateForm4Source } from './secForm4';

// Synthetic structured data only; SEC URLs below are not downloaded or asserted to exist.
const ev = () => [{id:'e1',excerpt:'Synthetic reported field',locator:'/ownershipDocument'}];
const identity = (kind: FilingIdentity['kind'], value: string): FilingIdentity => ({name:'Same Name',kind,identifier:{namespace:kind==='security'?'cusip':'cik',value},verified:true,evidence:['Synthetic identifier evidence']});
function fixture(): Form4Source {
  return {
    schemaVersion:'form4-source-v1',form:'FORM4',filingType:'4',filingId:'0000000001-26-000001',accessionNumber:'0000000001-26-000001',
    dates:{filedAt:'2026-01-05',periodEnd:'2026-01-02',asOfDate:'2026-01-02',publishedAt:null,retrievedAt:'2026-01-06T12:00:00Z'},
    issuer:identity('company','3'),issuerTicker:'TEST',filers:[identity('person','1')],
    reportingOwners:[{reference:'owner1',identity:identity('person','1'),relationship:{director:true,officer:false,tenPercentOwner:false,other:false,officerTitle:null,otherText:null,evidence:ev()}}],
    amendment:{kind:'original',previousFilingId:null},footnotes:[{id:'F1',text:'Synthetic transaction explanation'}],
    provenance:{sourceAuthority:'SEC',sourceIdentifier:'source1',sourceUrl:'https://www.sec.gov/Archives/edgar/data/1/example.xml',filingUrl:'https://www.sec.gov/Archives/edgar/data/1/example-index.html',origin:'public',parserVersion:null,evidence:ev()},
    parseStatus:'KNOWN',normalizationStatus:'KNOWN',transactions:[{
      rawSourceId:'nonDerivativeTransaction:1',transactionDate:'2026-01-02',transactionCode:'P',acquisitionDisposition:'A',shares:100,price:10,currency:'USD',ownershipAfter:200,ownershipType:'direct',ownershipNature:null,evidence:ev(),
      security:{identity:identity('security','000000001'),title:'Common stock',category:'non_derivative'},
      ownerAttribution:{references:['owner1'],status:'reported',evidence:ev()},footnoteReferences:[{field:'price',ids:['F1']}],
    }],
  };
}
test('valid Form 4 identity and completeness reuse existing C2 identifiers',()=>{
  const d=fixture(); assert.equal(assessForm4Source(d).coverage,'KNOWN');
  assert.equal(resolveForm4Party(d.reportingOwners[0].identity,d.filingId,'reporting_owner','owner1').id,'filing-entity:person:cik:0000000001');
});
test('same name different CIK never merges',()=>{
  assert.notEqual(resolveForm4Party(identity('person','1'),'f','reporting_owner','a').id,resolveForm4Party(identity('person','2'),'f','reporting_owner','b').id);
});
test('same verified CIK with different spelling keeps identity',()=>{
  const a=identity('person','1'),b={...a,name:'Other Spelling'};
  assert.equal(resolveForm4Party(a,'f','reporting_owner','a').id,resolveForm4Party(b,'g','reporting_owner','b').id);
});
test('missing CIK is UNKNOWN and unresolved scopes do not merge',()=>{
  const d=fixture();d.reportingOwners[0].identity.identifier=null;
  assert.equal(assessForm4Source(d).coverage,'UNKNOWN');
  const i=d.reportingOwners[0].identity;
  assert.notEqual(resolveForm4Party(i,'f','reporting_owner','a').id,resolveForm4Party(i,'g','reporting_owner','a').id);
});
test('CIK alone cannot establish person or institution kind',()=>{
  const d=fixture();d.reportingOwners[0].identity.kind='unknown';assert.equal(assessForm4Source(d).coverage,'UNKNOWN');
  assert.notEqual(resolveForm4Party(identity('person','1'),'f','reporting_owner','a').id,resolveForm4Party(identity('institution','1'),'f','reporting_owner','a').id);
});
test('issuer and reporting owner roles remain separate, invalid role kind rejected',()=>{
  const d=fixture();validateForm4Source(d);
  assert.equal(d.issuer.kind,'company');assert.equal(d.reportingOwners[0].identity.kind,'person');
  assert.throws(()=>resolveForm4Party(d.issuer,'f','reporting_owner','x'),/identity/);
});
test('multiple owners are document participants, not automatically row beneficiaries',()=>{
  const d=fixture();d.reportingOwners.push({...structuredClone(d.reportingOwners[0]),reference:'owner2',identity:identity('institution','2')});
  const before=structuredClone(d);assert.equal(assessForm4Source(d).coverage,'KNOWN');assert.deepEqual(d,before);
  assert.deepEqual(d.transactions[0].ownerAttribution.references,['owner1']);assert.equal(d.transactions.length,1);
  d.transactions[0].ownerAttribution={references:[],status:'unknown',evidence:[]};assert.equal(assessForm4Source(d).coverage,'UNKNOWN');
});
test('unsupported row ownership cannot claim reported attribution',()=>{
  const d=fixture();d.transactions[0].ownerAttribution.evidence=[];assert.throws(()=>validateForm4Source(d),/attribution/);
  d.transactions[0].ownerAttribution={references:['missing'],status:'reported',evidence:ev()};assert.throws(()=>validateForm4Source(d),/attribution/);
});
test('acquisition/disposition preserved without buy/sell output; conflicting direction UNKNOWN',()=>{
  const d=fixture();d.transactions[0].acquisitionDisposition='D';d.transactions[0].transactionCode='S';
  assert.equal(assessForm4Source(d).coverage,'KNOWN');assert.equal(d.transactions[0].acquisitionDisposition,'D');
  assert.equal('action' in d.transactions[0],false);
  d.transactions[0].transactionCode='P';assert.ok(assessForm4Source(d).rows[0].issues.includes('conflicting_code_direction'));
});
test('direct/indirect ownership retains nature without invented beneficiary',()=>{
  const d=fixture();d.transactions[0].ownershipType='indirect';d.transactions[0].ownershipNature='As reported through a trust';
  assert.equal(assessForm4Source(d).coverage,'KNOWN');assert.equal(d.reportingOwners.length,1);assert.equal(d.transactions[0].ownershipType,'indirect');
});
test('derivative/non-derivative remain distinct and unknown category fails closed',()=>{
  const d=fixture();d.transactions[0].security.category='derivative';assert.equal(assessForm4Source(d).coverage,'KNOWN');
  d.transactions[0].security.category='unknown';assert.equal(assessForm4Source(d).coverage,'UNKNOWN');
});
test('missing price is PARTIAL, not zero or an inferred amount',()=>{
  const d=fixture();d.transactions[0].price=null;assert.equal(assessForm4Source(d).coverage,'PARTIAL');assert.equal(d.transactions[0].price,null);
});
test('unknown code preserved verbatim without interpretation',()=>{
  const d=fixture();d.transactions[0].transactionCode='FUTURE_CODE';assert.equal(assessForm4Source(d).coverage,'UNKNOWN');assert.equal(d.transactions[0].transactionCode,'FUTURE_CODE');
});
test('grant/exercise/conversion/gift/withholding never emit investment action',()=>{
  for(const code of ['A','M','C','G','F']) {
    const d=fixture();d.transactions[0].transactionCode=code;const before=structuredClone(d);
    const result=assessForm4Source(d);assert.deepEqual(d,before);assert.ok(!JSON.stringify(result).match(/BUY|SELL|BULLISH|BEARISH/));
    assert.equal(d.transactions[0].transactionCode,code);
  }
});
test('amendment metadata retained, unlinked amendment PARTIAL, self reference rejected',()=>{
  const d=fixture();d.filingType='4/A';d.amendment={kind:'correction',previousFilingId:'original-filing'};assert.equal(assessForm4Source(d).coverage,'KNOWN');
  d.amendment.previousFilingId=null;assert.equal(assessForm4Source(d).coverage,'PARTIAL');
  d.amendment.previousFilingId=d.filingId;assert.throws(()=>validateForm4Source(d),/amendment/);
});
test('provenance, dates and footnotes preserved without normalization side effects',()=>{
  const d=fixture(),before=structuredClone(d);assessForm4Source(d);assert.deepEqual(d,before);
  assert.notEqual(d.dates.filedAt,d.transactions[0].transactionDate);
  d.transactions[0].transactionDate=null;assessForm4Source(d);assert.equal(d.transactions[0].transactionDate,null);
});
test('missing ticker is PARTIAL; missing security ID is UNKNOWN with original information intact',()=>{
  const d=fixture();d.issuerTicker=null;assert.equal(assessForm4Source(d).coverage,'PARTIAL');
  d.transactions[0].security.identity.identifier=null;assert.equal(assessForm4Source(d).coverage,'UNKNOWN');assert.equal(d.transactions[0].security.title,'Common stock');
});
test('declared UNKNOWN/PARTIAL, absent evidence and mock source never gain certainty',()=>{
  const d=fixture();d.parseStatus='PARTIAL';assert.equal(assessForm4Source(d).coverage,'PARTIAL');
  d.normalizationStatus='UNKNOWN';assert.equal(assessForm4Source(d).coverage,'UNKNOWN');
  const m=fixture();m.provenance.origin='mock';assert.equal(assessForm4Source(m).coverage,'UNKNOWN');
  const e=fixture();e.provenance.evidence=[];assert.equal(assessForm4Source(e).coverage,'UNKNOWN');
});
test('missing referenced footnote or owner relationship evidence is PARTIAL',()=>{
  const d=fixture();d.footnotes=[];assert.equal(assessForm4Source(d).coverage,'PARTIAL');
  const p=fixture();p.reportingOwners[0].relationship.evidence=[];assert.equal(assessForm4Source(p).coverage,'PARTIAL');
});
test('invalid amounts, dates, URLs and duplicate local references rejected',()=>{
  const d=fixture();d.transactions[0].price=-1;assert.throws(()=>validateForm4Source(d),/price/);
  d.transactions[0].price=10;d.transactions[0].transactionDate='2026-02-30';assert.throws(()=>validateForm4Source(d),/date/);
  d.transactions[0].transactionDate=null;d.provenance.sourceUrl='https://www.sec.gov.evil.test/Archives/edgar/data/1/a';assert.throws(()=>validateForm4Source(d),/sourceUrl/);
  d.provenance.sourceUrl=null;d.reportingOwners.push(d.reportingOwners[0]);assert.throws(()=>validateForm4Source(d),/duplicate/);
});
test('Form 13F is rejected by Form 4 contract without changing existing 13F model',()=>{
  const d=fixture();(d as unknown as {form:string}).form='13F';assert.throws(()=>validateForm4Source(d),/form/);
});
