import test from 'node:test';
import assert from 'node:assert/strict';
import { parseForm4Xml } from './secForm4Parser';
import { assessForm4Source, validateForm4Source } from './secForm4';
import { form4Context, form4Fixtures, form4Xml, ownerXml, transactionXml } from './fixtures/secForm4Xml';

const parse = (xml: string) => parseForm4Xml(xml, form4Context);
test('XML purchase maps issuer, owner, row fields into the unchanged Stage 1 contract', () => {
  const result = parse(form4Fixtures.purchase);
  assert.equal(result.status,'parsed');
  const d = result.source!;
  validateForm4Source(d);
  assert.equal(d.issuer.name,'Synthetic & Company');
  assert.equal(d.issuer.identifier?.value,'0000000001');
  assert.equal(d.issuerTicker,'TEST');
  assert.equal(d.reportingOwners[0].identity.name,'Synthetic Owner');
  assert.equal(d.reportingOwners[0].identity.identifier?.value,'0000000002');
  const r = d.transactions[0];
  assert.equal(r.security.title,'Common Stock'); assert.equal(r.transactionCode,'P');
  assert.equal(r.transactionDate,'2026-01-02'); assert.equal(r.shares,100);
  assert.equal(r.price,12.5); assert.equal(r.ownershipAfter,1100);
  assert.equal(r.acquisitionDisposition,'A'); assert.equal(r.ownershipType,'direct');
});
test('sale preserves S and disposition D independently of ownership D', () => {
  const r = parse(form4Fixtures.sale).source!.transactions[0];
  assert.equal(r.transactionCode,'S'); assert.equal(r.acquisitionDisposition,'D'); assert.equal(r.ownershipType,'direct');
});
test('repeated XML transactions retain order and distinct document-local row IDs', () => {
  const d = parse(form4Fixtures.multiple).source!;
  assert.deepEqual(d.transactions.map(r => r.rawSourceId),['non-derivative-1','non-derivative-2']);
  assert.deepEqual(d.transactions.map(r => r.transactionCode),['P','S']);
});
test('director, officer/title and ten-percent flags remain independent', () => {
  assert.equal(parse(form4Fixtures.purchase).source!.reportingOwners[0].relationship.director,true);
  const officer = parse(form4Fixtures.officer).source!.reportingOwners[0].relationship;
  assert.equal(officer.director,false); assert.equal(officer.officer,true); assert.equal(officer.officerTitle,'Chief Financial Officer');
  assert.equal(parse(form4Fixtures.tenPercent).source!.reportingOwners[0].relationship.tenPercentOwner,true);
});
test('other flag/text are parsed without inferring beneficial-owner or filer role', () => {
  const d = parse(form4Xml({owners:ownerXml('<isOther>1</isOther><otherText>Research fixture</otherText>')})).source!;
  assert.equal(d.reportingOwners[0].relationship.other,true);
  assert.equal(d.reportingOwners[0].relationship.otherText,'Research fixture');
  assert.equal(d.reportingOwners[0].relationship.director,null); assert.deepEqual(d.filers,[]);
});
test('indirect ownership preserves reported nature, not invented beneficiary', () => {
  const r = parse(form4Fixtures.indirect).source!.transactions[0];
  assert.equal(r.ownershipType,'indirect'); assert.equal(r.ownershipNature,'By Synthetic Trust');
});
test('missing price is null/PARTIAL, never zero', () => {
  const result = parse(form4Fixtures.missingPrice);
  assert.equal(result.status,'partial'); assert.equal(result.source!.transactions[0].price,null);
});
test('4/A retains unknown amendment kind and original date, not a fabricated parent filing', () => {
  const r = parse(form4Fixtures.amendment);
  assert.equal(r.source!.filingType,'4/A'); assert.equal(r.dateOfOriginalSubmission,'2026-01-03');
  assert.deepEqual(r.source!.amendment,{kind:'unknown',previousFilingId:null});
});
test('period, transaction, filing, publication and retrieval dates are separate; signature is not filing date', () => {
  const r = parseForm4Xml(form4Fixtures.purchase,{...form4Context,filedAt:null});
  assert.equal(r.periodOfReport,'2026-01-02'); assert.equal(r.source!.dates.periodEnd,null);
  assert.equal(r.source!.dates.filedAt,null); assert.equal(r.source!.dates.publishedAt,null);
  assert.equal(r.source!.dates.asOfDate,null); assert.equal(r.source!.dates.retrievedAt,form4Context.retrievedAt);
});
test('parse success never verifies mock identity or resolves ownership attribution', () => {
  const d = parse(form4Fixtures.joint).source!;
  assert.equal(d.reportingOwners.length,2); assert.equal(d.reportingOwners[0].identity.kind,'unknown');
  assert.equal(d.issuer.verified,false); assert.equal(d.provenance.origin,'mock');
  assert.equal(d.transactions[0].currency,null);
  assert.deepEqual(d.transactions[0].ownerAttribution,{references:[],status:'unknown',evidence:[]});
  assert.equal(assessForm4Source(d).coverage,'UNKNOWN');
});
test('source evidence records scalar values and XML paths; leading-zero identifiers stay strings', () => {
  const r = parse(form4Fixtures.purchase).source!;
  assert.match(r.transactions[0].evidence[0].excerpt,/12.50/);
  assert.match(r.transactions[0].evidence[0].locator!,/nonDerivativeTransaction\[1\]/);
  assert.equal(r.issuer.identifier?.value,'0000000001');
});
test('footnote references and text survive; footnote-only price stays null', () => {
  const xml = form4Xml({extra:'<footnotes><footnote id="F1">Price range &amp; conditions</footnote></footnotes>'})
    .replace('<transactionPricePerShare><value>12.50</value></transactionPricePerShare>','<transactionPricePerShare><footnoteId id="F1"/></transactionPricePerShare>');
  const r = parse(xml).source!;
  assert.equal(r.transactions[0].price,null); assert.equal(r.footnotes[0].text,'Price range & conditions');
  assert.deepEqual(r.transactions[0].footnoteReferences[0].ids,['F1']);
});
test('unresolved footnote is a diagnostic, never numeric recovery from prose', () => {
  const r = parse(form4Fixtures.purchase.replace('<value>12.50</value>','<footnoteId id="missing"/>'));
  assert.ok(r.issues.some(i => i.code === 'unresolved_footnote')); assert.equal(r.source!.transactions[0].price,null);
});
test('invalid optional scalars stay null/unknown with raw values and issues', () => {
  const r = parse(form4Fixtures.purchase.replace('<isDirector>1</isDirector>','<isDirector>yes</isDirector>')
    .replace('<value>12.50</value>','<value>NaN</value>').replace('<value>D</value>','<value>invalid</value>'));
  assert.equal(r.source!.reportingOwners[0].relationship.director,null);
  assert.equal(r.source!.transactions[0].price,null); assert.equal(r.source!.transactions[0].ownershipType,'unknown');
  assert.ok(Object.values(r.rawFields).includes('NaN')); assert.equal(r.status,'partial');
});
test('unsafe numeric values, negatives and scientific notation are not silently coerced', () => {
  for (const value of ['-1','1,000','1e3','Infinity','9007199254740993','0.1234567890123456789']) {
    const r = parse(form4Xml({transactions:transactionXml({shares:value})}));
    assert.equal(r.source!.transactions[0].shares,null,value);
  }
});
test('impossible/future transaction dates are null; never replaced by filing date', () => {
  for (const date of ['2026-02-30','2026-01-07','2026-01-06']) {
    const r = parse(form4Fixtures.purchase.replace('<transactionDate><value>2026-01-02','<transactionDate><value>'+date));
    assert.equal(r.source!.transactions[0].transactionDate,null,date);
  }
});
test('missing CIK remains null and missing identity name makes source unavailable', () => {
  assert.equal(parse(form4Fixtures.purchase.replace('<issuerCik>0000000001</issuerCik>','')).source!.issuer.identifier,null);
  assert.equal(parse(form4Fixtures.incomplete).status,'unavailable');
  assert.equal(parse(form4Fixtures.incomplete).source,null);
});
test('derivative and holding-only rows are explicitly unsupported, not ordinary trades', () => {
  const r = parse(form4Xml({transactions:'<nonDerivativeHolding/>',extra:'<derivativeTable><derivativeTransaction/><derivativeHolding/></derivativeTable>'}));
  assert.equal(r.status,'partial'); assert.deepEqual(r.source!.transactions,[]);
  assert.deepEqual(r.unsupported,{derivativeTransactions:1,derivativeHoldings:1,nonDerivativeHoldings:1});
});
test('malformed XML and ambiguous duplicate singleton fields fail closed', () => {
  for (const xml of [form4Fixtures.malformed,form4Fixtures.purchase.replace('<documentType>4</documentType>','<documentType>4</documentType><documentType>4/A</documentType>'),
    form4Fixtures.purchase + '<extra/>',form4Fixtures.purchase.replace('&amp;','&bogus;')]) {
    assert.equal(parse(xml).status,'unavailable'); assert.equal(parse(xml).source,null);
  }
});
test('DTD/entity expansion, foreign namespaces, HTML, oversized and deeply nested XML are rejected', () => {
  for (const xml of ['<!DOCTYPE ownershipDocument SYSTEM "https://example.invalid/test"><ownershipDocument/>',
    '<ownershipDocument xmlns="urn:untrusted"/>','<html/>','x'.repeat(2_000_001),'<a>'.repeat(34)+'</a>'.repeat(34)]) {
    assert.equal(parse(xml).status,'unavailable');
  }
});
test('CDATA and escaped characters work without HTML stripping', () => {
  const r = parse(form4Fixtures.purchase.replace('Synthetic &amp; Company','<![CDATA[Synthetic <Company>]]>'));
  assert.equal(r.source!.issuer.name,'Synthetic <Company>');
});
test('unsupported forms, unsafe envelope URL and invalid retrieval timestamp fail closed', () => {
  assert.equal(parse(form4Xml({form:'3'})).status,'unavailable');
  assert.equal(parseForm4Xml(form4Fixtures.purchase,{...form4Context,sourceUrl:'https://example.invalid/'}).status,'unavailable');
  assert.equal(parseForm4Xml(form4Fixtures.purchase,{...form4Context,retrievedAt:'2026-01-06'}).status,'unavailable');
});
test('parser is deterministic and does not mutate context', () => {
  const before = structuredClone(form4Context);
  assert.deepEqual(parse(form4Fixtures.purchase),parse(form4Fixtures.purchase)); assert.deepEqual(form4Context,before);
});
test('mixed derivative filing preserves supported rows while declaring partial coverage', () => {
  const result = parse(form4Xml({extra:'<derivativeTable><derivativeTransaction><transactionCoding><transactionCode>M</transactionCode></transactionCoding></derivativeTransaction></derivativeTable>'}));
  assert.equal(result.status,'partial'); assert.equal(result.source!.parseStatus,'PARTIAL');
  assert.equal(result.source!.transactions.length,1); assert.equal(result.unsupported.derivativeTransactions,1);
});
test('empty optional elements do not silently become false, zero or empty ownership', () => {
  const result = parse(form4Fixtures.purchase.replace('<isOfficer>0</isOfficer>','<isOfficer/>')
    .replace('<transactionPricePerShare><value>12.50</value></transactionPricePerShare>','<transactionPricePerShare><value/></transactionPricePerShare>'));
  assert.equal(result.source!.reportingOwners[0].relationship.officer,null);
  assert.equal(result.source!.transactions[0].price,null);
});
test('duplicate numeric field, duplicate footnote ID and nested scalar fail closed', () => {
  assert.equal(parse(form4Fixtures.purchase.replace('<value>12.50</value>','<value>12.50</value><value>100</value>')).status,'unavailable');
  assert.equal(parse(form4Xml({extra:'<footnotes><footnote id="F1">a</footnote><footnote id="F1">b</footnote></footnotes>'})).status,'unavailable');
  const nested = parse(form4Fixtures.purchase.replace('<value>12.50</value>','<value><unexpected>12.50</unexpected></value>'));
  assert.equal(nested.source!.transactions[0].price,null); assert.equal(nested.status,'partial');
});
test('public context still cannot verify owner kind, ticker-as-security or currency', () => {
  const d = parseForm4Xml(form4Fixtures.purchase,{...form4Context,origin:'public',
    sourceUrl:'https://www.sec.gov/Archives/edgar/data/1/fixture.xml'}).source!;
  assert.equal(d.reportingOwners[0].identity.kind,'unknown'); assert.equal(d.issuer.verified,false);
  assert.equal(d.transactions[0].security.identity.identifier,null); assert.equal(d.transactions[0].currency,null);
});
