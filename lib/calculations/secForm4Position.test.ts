import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeForm4Positions, normalizeForm4TransactionCode } from './secForm4Position';
import { parseForm4Xml } from '../utils/secForm4Parser';
import { form4Context, form4Fixtures, form4Xml, transactionXml, verifiedEquityBasis } from '../utils/fixtures/secForm4Xml';

const analyze = (xml: string) => analyzeForm4Positions(parseForm4Xml(xml,form4Context));
const analyzeWithUnitEvidence = (xml: string) => analyzeForm4Positions(parseForm4Xml(xml,form4Context),[verifiedEquityBasis]);
test('P/A and S/D produce BUY/SELL, never a claim about open-market venue', () => {
  const rows = analyze(form4Fixtures.multiple).rows;
  assert.deepEqual(rows.map(r => r.action),['BUY','SELL']);
  assert.deepEqual(rows.map(r => r.normalizedType),['PURCHASE','SALE']);
  assert.equal(rows[0].marketVenue,'unknown'); assert.equal(rows[0].transactionValue,null);
  const supported = analyzeWithUnitEvidence(form4Fixtures.purchase).rows[0];
  assert.equal(supported.transactionValue?.amount,'1250');
  assert.equal(supported.transactionValue?.quality,'calculated'); assert.equal(supported.transactionValue?.currency,null);
});
test('exact decimal arithmetic avoids 0.1 * 0.2 floating-point artefacts', () => {
  assert.equal(analyzeWithUnitEvidence(form4Xml({transactions:transactionXml({shares:'0.1',price:'0.2'})})).rows[0].transactionValue?.amount,'0.02');
});
test('zero is preserved while missing price stays unavailable', () => {
  assert.equal(analyzeWithUnitEvidence(form4Fixtures.missingPrice).rows[0].transactionValue,null);
  assert.equal(analyzeWithUnitEvidence(form4Xml({transactions:transactionXml({price:'0'})})).rows[0].transactionValue?.amount,'0');
});
test('SEC non-P/S codes never become ordinary buy/sell or paid trade value', () => {
  const expected = {A:'GRANT_AWARD_OR_ACQUISITION',M:'EXERCISE_OR_CONVERSION',C:'CONVERSION',O:'EXERCISE',X:'EXERCISE',F:'EXERCISE_PRICE_OR_TAX_PAYMENT',G:'GIFT'};
  for (const [code,type] of Object.entries(expected)) {
    assert.equal(normalizeForm4TransactionCode(code),type);
    const row = analyze(form4Xml({transactions:transactionXml({code})})).rows[0];
    assert.equal(row.action,'OTHER'); assert.equal(row.transactionValue,null);
  }
  for (const code of ['V','D','I','E','H','L','W','Z','J','K','U']) assert.equal(normalizeForm4TransactionCode(code),'OTHER');
});
test('unknown and compound codes remain raw and UNKNOWN, not guessed', () => {
  for (const code of ['Q','P/K','p']) {
    const row = analyze(form4Xml({transactions:transactionXml({code})})).rows[0];
    assert.equal(row.transactionCode,code); assert.equal(row.normalizedType,'UNKNOWN'); assert.equal(row.action,'UNKNOWN');
  }
  assert.equal(normalizeForm4TransactionCode(null),'UNKNOWN');
});
test('conflicting and missing A/D cannot produce a buy/sell conclusion', () => {
  for (const [code,direction] of [['P','D'],['S','A'],['P','']]) {
    const r = analyze(form4Xml({transactions:transactionXml({code,direction})})).rows[0];
    assert.equal(r.action,'UNKNOWN'); assert.equal(r.transactionValue,null);
  }
});
test('footnoted price suppresses unconditional value even with a numeric scalar', () => {
  const xml = form4Fixtures.purchase.replace('<value>12.50</value>','<value>12.50</value><footnoteId id="F1"/>');
  assert.equal(analyzeWithUnitEvidence(xml).rows[0].transactionValue,null);
});
test('reported holdings-after is not summed; joint owners receive no allocated shares', () => {
  const r = analyze(form4Fixtures.joint);
  assert.equal(r.rows.length,1); assert.equal(r.rows[0].holdingsAfter,1100);
  assert.equal(r.reportingOwners.length,2); assert.equal(r.rows[0].ownerAttribution.status,'unknown');
  assert.equal(r.coverage,'UNKNOWN');
});
test('filing-level officer title, ownership nature and amendment stay intact', () => {
  assert.equal(analyze(form4Fixtures.officer).reportingOwners[0].relationship.officerTitle,'Chief Financial Officer');
  assert.equal(analyze(form4Fixtures.indirect).rows[0].ownershipNature,'By Synthetic Trust');
  const r = analyze(form4Fixtures.amendment);
  assert.equal(r.filingType,'4/A'); assert.equal(r.amendment?.kind,'unknown');
});
test('unavailable XML has no invented analysis; input is immutable and results deterministic', () => {
  assert.deepEqual(analyze(form4Fixtures.malformed).rows,[]);
  const parsed = parseForm4Xml(form4Fixtures.purchase,form4Context);
  const copy = structuredClone(parsed);
  assert.deepEqual(analyzeForm4Positions(parsed),analyzeForm4Positions(parsed)); assert.deepEqual(parsed,copy);
});
test('derivative rows never enter ordinary purchase/sale analysis', () => {
  const result = analyze(form4Xml({transactions:'',extra:'<derivativeTable><derivativeTransaction><transactionCoding><transactionCode>P</transactionCode></transactionCoding></derivativeTransaction></derivativeTable>'}));
  assert.deepEqual(result.rows,[]); assert.equal(result.unsupported.derivativeTransactions,1);
});
test('numeric strings retain decimal accuracy across trailing zero and fractional cases', () => {
  for (const [shares,price,value] of [['2.50','4.00','10'],['0.001','0.001','0.000001'],['0','12.5','0']]) {
    assert.equal(analyzeWithUnitEvidence(form4Xml({transactions:transactionXml({shares,price})})).rows[0].transactionValue?.amount,value);
  }
});
