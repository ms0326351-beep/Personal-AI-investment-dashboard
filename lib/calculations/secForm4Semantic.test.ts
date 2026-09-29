import test from 'node:test';
import assert from 'node:assert/strict';
import { parseForm4Xml } from '../utils/secForm4Parser';
import { analyzeForm4Positions } from './secForm4Position';
import { filingFreshness } from '../services/publicFilingNormalization';
import type { FilingDocument } from '../types/publicFilings';
import type { Form4ValueBasis } from '../types/secForm4Parser';
import { form4Context, form4Fixtures, form4Xml, transactionXml, verifiedEquityBasis } from '../utils/fixtures/secForm4Xml';

const parse = (xml: string) => parseForm4Xml(xml,form4Context);
const analyze = (xml: string, bases: readonly Form4ValueBasis[] = [verifiedEquityBasis]) => analyzeForm4Positions(parse(xml),bases);

test('H1: swap true retains SEC P/S but never produces an unqualified BUY/SELL or value', () => {
  for (const [code,direction] of [['P','A'],['S','D']]) {
    const xml = form4Xml({transactions:transactionXml({code,direction})})
      .replace('<equitySwapInvolved>0</equitySwapInvolved>','<equitySwapInvolved>1</equitySwapInvolved>');
    const parsed = parse(xml), row = analyzeForm4Positions(parsed,[verifiedEquityBasis]).rows[0];
    assert.equal(parsed.source!.transactions[0].transactionCode,code);
    assert.equal(row.normalizedType,code === 'P' ? 'PURCHASE' : 'SALE');
    assert.equal(row.equitySwapInvolved,true); assert.equal(row.action,'UNKNOWN'); assert.equal(row.transactionValue,null);
    assert.ok(Object.entries(parsed.rawFields).some(([k,v]) => k.endsWith('/equitySwapInvolved') && v === '1'));
    assert.ok(row.issues.includes('equity_swap_qualified'));
  }
});
test('H1: missing, invalid and empty swap flags fail closed without replacing raw input', () => {
  for (const flag of ['', '<equitySwapInvolved/>','<equitySwapInvolved>perhaps</equitySwapInvolved>']) {
    const parsed = parse(form4Fixtures.purchase.replace('<equitySwapInvolved>0</equitySwapInvolved>',flag));
    const row = analyzeForm4Positions(parsed,[verifiedEquityBasis]).rows[0];
    assert.equal(row.equitySwapInvolved,null); assert.equal(row.action,'UNKNOWN'); assert.equal(row.transactionValue,null);
    assert.equal(parsed.status,'partial');
  }
});
test('H1: explicit false preserves P/S and true lexical form suppresses ordinary action', () => {
  for (const value of ['0','false','1','true']) {
    const row = analyze(form4Fixtures.purchase.replace('<equitySwapInvolved>0</equitySwapInvolved>',`<equitySwapInvolved>${value}</equitySwapInvolved>`)).rows[0];
    assert.equal(row.action,['0','false'].includes(value) ? 'BUY' : 'UNKNOWN');
  }
});
test('H1: award, exercise, withholding, gift and amendment/ownership semantics stay unchanged', () => {
  for (const code of ['A','M','F','G','C','D','J','K','U','W','Z']) {
    const row = analyze(form4Xml({transactions:transactionXml({code})})).rows[0];
    assert.equal(row.action,'OTHER'); assert.equal(row.transactionValue,null);
  }
  assert.equal(analyze(form4Fixtures.amendment).filingType,'4/A');
  assert.equal(analyze(form4Fixtures.amendment).amendment?.kind,'unknown');
  assert.equal(analyze(form4Fixtures.purchase).rows[0].ownershipType,'direct');
  assert.equal(analyze(form4Fixtures.indirect).rows[0].ownershipType,'indirect');
});
test('M1: valid price footnote preserves numeric price/reference but suppresses transactionValue', () => {
  const parsed = parse(form4Fixtures.footnotedPrice), row = parsed.source!.transactions[0];
  assert.equal(row.price,12.5); assert.equal(row.shares,100);
  assert.deepEqual(row.footnoteReferences[0].ids,['F1']);
  assert.equal(parsed.source!.footnotes[0].id,'F1');
  assert.ok(Object.values(parsed.rawFields).includes('12.50'));
  assert.equal(analyzeForm4Positions(parsed,[verifiedEquityBasis]).rows[0].transactionValue,null);
});
test('M1: malformed footnote with missing or blank id cannot bypass value suppression', () => {
  for (const note of ['<footnoteId/>','<footnoteId id=""/>']) {
    const parsed = parse(form4Fixtures.malformedPriceFootnote.replace('<footnoteId/>',note));
    assert.equal(parsed.source!.transactions[0].price,12.5);
    assert.ok(parsed.issues.some(i => i.code === 'missing_footnote_id'));
    assert.equal(parsed.transactionSemantics['non-derivative-1'].hasFootnote,true);
    assert.ok(Object.keys(parsed.rawFields).some(k => k.endsWith('/@id')));
    assert.equal(analyzeForm4Positions(parsed,[verifiedEquityBasis]).rows[0].transactionValue,null);
  }
});
test('M1: unresolved reference and footnote-only price remain unavailable without parsing prose', () => {
  for (const replacement of ['<value>12.50</value><footnoteId id="missing"/>','<footnoteId id="missing"/>']) {
    const parsed = parse(form4Fixtures.purchase.replace('<value>12.50</value>',replacement));
    assert.ok(parsed.issues.some(i => i.code === 'unresolved_footnote'));
    assert.deepEqual(parsed.source!.transactions[0].footnoteReferences[0].ids,['missing']);
    assert.equal(analyzeForm4Positions(parsed,[verifiedEquityBasis]).rows[0].transactionValue,null);
  }
});
test('M2: Senior Notes 100 x 12.50 is not eligible merely because two numbers exist', () => {
  const parsed = parse(form4Fixtures.seniorNotes);
  assert.equal(parsed.source!.transactions[0].shares,100); assert.equal(parsed.source!.transactions[0].price,12.5);
  assert.equal(analyzeForm4Positions(parsed).rows[0].transactionValue,null);
  assert.equal(analyzeForm4Positions(parsed,[{...verifiedEquityBasis,securityKind:'debt',quantityUnit:'principal',priceUnit:'aggregate'}]).rows[0].transactionValue,null);
});
test('M2: even Common Stock requires explicit unit evidence; arbitrary title is not a classifier', () => {
  for (const title of ['Common Stock','Ordinary Shares','Unclassified Security']) {
    assert.equal(analyze(form4Fixtures.purchase.replace('Common Stock',title),[]).rows[0].transactionValue,null);
  }
  const supported = analyze(form4Fixtures.purchase).rows[0].transactionValue!;
  assert.equal(supported.amount,'1250'); assert.equal(supported.quality,'calculated');
  assert.deepEqual(supported.basisEvidence,verifiedEquityBasis.evidence);
});
test('M2: missing/unknown/unverified/conflicting or mismatched unit evidence fails closed', () => {
  const invalid: Form4ValueBasis[] = [
    {...verifiedEquityBasis,verified:false}, {...verifiedEquityBasis,evidence:[]},
    {...verifiedEquityBasis,securityKind:'unknown'}, {...verifiedEquityBasis,quantityUnit:'unknown'},
    {...verifiedEquityBasis,priceUnit:'aggregate'}, {...verifiedEquityBasis,filingId:'other'},
    {...verifiedEquityBasis,sourceIdentifier:'other'}, {...verifiedEquityBasis,rawSourceId:'non-derivative-2'},
    {...verifiedEquityBasis,evidence:[{id:'empty',excerpt:'',locator:null}]},
  ];
  for (const basis of invalid) assert.equal(analyze(form4Fixtures.purchase,[basis]).rows[0].transactionValue,null);
  assert.equal(analyze(form4Fixtures.purchase,[verifiedEquityBasis,{...verifiedEquityBasis,priceUnit:'aggregate'}]).rows[0].transactionValue,null);
});
test('M2: proven units cannot override swap, footnote, missing numbers or conflicting direction', () => {
  for (const xml of [form4Fixtures.swapPurchase,form4Fixtures.footnotedPrice,form4Fixtures.missingPrice,
    form4Xml({transactions:transactionXml({direction:'D'})}), form4Xml({transactions:transactionXml({shares:''})})]) {
    assert.equal(analyze(xml).rows[0].transactionValue,null);
  }
  assert.equal(analyze(form4Xml({transactions:transactionXml({shares:'0.1',price:'0.2'})})).rows[0].transactionValue?.amount,'0.02');
});
test('M3: periodOfReport remains separate from transaction/filing dates and never sets periodEnd/asOfDate', () => {
  const parsed = parse(form4Fixtures.purchase.replace('<periodOfReport>2026-01-02</periodOfReport>','<periodOfReport>2026-01-01</periodOfReport>'));
  assert.equal(parsed.periodOfReport,'2026-01-01');
  assert.equal(parsed.source!.transactions[0].transactionDate,'2026-01-02');
  assert.equal(parsed.source!.dates.filedAt,'2026-01-05');
  assert.equal(parsed.source!.dates.periodEnd,null); assert.equal(parsed.source!.dates.asOfDate,null);
});
test('M3: periodOfReport cannot fill missing transaction date or create holdings freshness', () => {
  const parsed = parse(form4Fixtures.purchase.replace('<transactionDate><value>2026-01-02</value></transactionDate>',''));
  assert.equal(parsed.source!.transactions[0].transactionDate,null);
  assert.equal(parsed.periodOfReport,'2026-01-02');
  // Existing freshness function consumes only this documented subset; make the
  // surrounding filing complete to prove periodOfReport cannot masquerade as asOf.
  const freshnessInput = {dates:parsed.source!.dates,coverage:'KNOWN',publicTableComplete:true} as FilingDocument;
  assert.equal(filingFreshness(freshnessInput,'2026-01-06T12:00:00Z',30),'unknown');
});
