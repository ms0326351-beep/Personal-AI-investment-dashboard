import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSecClient, type SecClientDependencies } from './secClient';
import { createSecRequestGate, secRetryAfter, type SecClock } from './secRequestPolicy';
import { normalizeSecCik, secAccessionPath, secDocumentUrl, secFilingKey, secPrimaryDocument, secSubmissionsUrl } from '../utils/secEndpoints';
import { SecTransportError, type SecErrorCode, type SecForm4Metadata } from '../types/secTransport';
import { form4Fixtures } from '../utils/fixtures/secForm4Xml';

// Explicitly fake contact; no environment, live SEC access or real contact used.
const userAgent = 'Offline compatibility tests <qa@example.invalid>';
const metadata: SecForm4Metadata = { cik: '12345', accessionNumber: '0000012345-26-000001',
  primaryDocument: 'form4.xml', formType: '4', filingDate: '2026-01-05' };
const start = Date.parse('2026-09-30T00:00:00Z');
const xml = (body = form4Fixtures.purchase) => new Response(body, { headers: { 'content-type': 'text/xml' } });
function submissions(rows: SecForm4Metadata[] = [metadata]) {
  return { cik: 12345, filings: { recent: {
    accessionNumber: rows.map(r => r.accessionNumber), form: rows.map(r => r.formType),
    filingDate: rows.map(r => r.filingDate), primaryDocument: rows.map(r => r.primaryDocument),
  }, files: [] as unknown[] } };
}
const json = (body: unknown = submissions()) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
test('SEC submissions stylesheet primaryDocument preserves metadata and request path', async () => {
  const row = { ...metadata, primaryDocument: 'xslF345X05/form4.xml' };
  const body = { ...submissions([row]), unrelatedOptional: null };
  const h = harness([() => json(body), () => xml()]);
  const client = h.client();
  const result = await client.fetchCompanySubmissions(12345);
  assert.equal(result.filings[0].primaryDocument, row.primaryDocument);
  const envelope = await client.fetchForm4Document(result.filings[0]);
  assert.equal(envelope.primaryDocument, row.primaryDocument);
  assert.equal(envelope.sourceUrl, secDocumentUrl(row));
  assert.equal(h.calls[1].url, secDocumentUrl(row));
});
const isError = (code: SecErrorCode, attempts?: number) => (error: unknown) => {
  assert.ok(error instanceof SecTransportError);
  assert.equal(error.code, code);
  if (attempts !== undefined) assert.equal(error.attempts, attempts);
  return true;
};
test('SEC relative document paths preserve every segment inside the accession directory', () => {
  for (const path of ['edgar.xml', 'xslF345X03/edgar.xml', 'xslF345X05/other.xml']) {
    assert.equal(secPrimaryDocument(path), path);
    assert.equal(secDocumentUrl({ ...metadata, primaryDocument: path }),
      `https://www.sec.gov/Archives/edgar/data/12345/000001234526000001/${path}`);
  }
});
test('SEC relative document URL rejects traversal and external or filesystem paths', () => {
  for (const path of ['../edgar.xml','xslF345X03/../edgar.xml','/edgar.xml',
    'https://example.com/edgar.xml','http://example.com/edgar.xml','//example.com/edgar.xml',
    'xslF345X03\\..\\edgar.xml','xslF345X03/%2e%2e/edgar.xml','%252e%252e/edgar.xml',
    'edgar.xml?x=1','xslF345X03/edgar.xml#x','C:/edgar.xml','arbitrary/edgar.xml']) {
    assert.throws(() => secDocumentUrl({ ...metadata, primaryDocument: path }), isError('INVALID_DOCUMENT'));
  }
});
type Reply = () => Response | Promise<Response>;
function harness(replies: Reply[], timeOut = false) {
  let now = start, activeTimers = 0;
  const sleeps: number[] = [];
  const calls: { url: string; init: RequestInit; at: number }[] = [];
  const clock: SecClock = {
    now: () => now,
    sleep: async ms => { sleeps.push(ms); now += ms; },
    timeout: (callback, ms) => {
      activeTimers++;
      if (timeOut) queueMicrotask(() => { now += ms; callback(); });
      return () => { activeTimers--; };
    },
  };
  const dependencies: SecClientDependencies = {
    clock, gate: createSecRequestGate(clock),
    fetch: (async (url, init) => {
      calls.push({ url: String(url), init: init!, at: now });
      const reply = replies.shift();
      if (!reply) throw new Error('Unexpected mock request; live network forbidden');
      return reply();
    }) as typeof fetch,
  };
  return { dependencies, calls, sleeps, timers: () => activeTimers,
    client: (options = {}) => createSecClient({ userAgent, ...options }, dependencies) };
}

test('SEC helpers normalize CIK and build only the two supported official endpoints', () => {
  for (const value of [12345,'12345','0000012345',' 12345 ']) assert.equal(normalizeSecCik(value),'0000012345');
  assert.equal(secSubmissionsUrl('12345'),'https://data.sec.gov/submissions/CIK0000012345.json');
  assert.equal(secAccessionPath(metadata.accessionNumber),'000001234526000001');
  assert.equal(secDocumentUrl(metadata),'https://www.sec.gov/Archives/edgar/data/12345/000001234526000001/form4.xml');
});
test('SEC helpers reject malformed CIK without guessing or coercing URLs', () => {
  for (const value of [0,-1,1.5,NaN,'','0000000000','12345678901','1e3','../1','https://evil.invalid',null,{}]) {
    assert.throws(() => normalizeSecCik(value),isError('INVALID_CIK'));
  }
});
test('SEC helpers require exact dashed accession and preserve original/amendment identity', () => {
  for (const a of ['000001234526000001','0000012345-2026-000001','../0000012345-26-000001',null]) {
    assert.throws(() => secAccessionPath(a),isError('INVALID_ACCESSION'));
  }
  assert.equal(secFilingKey(metadata.accessionNumber),secFilingKey(metadata.accessionNumber));
  assert.notEqual(secFilingKey(metadata.accessionNumber),secFilingKey('0000012345-26-000002'));
});
test('SEC primary document rejects traversal, encoded separators, credentials, query and fragment', () => {
  for (const name of ['../form4.xml','xslF345X05/sub/form4.xml','xslF345X05/../form4.xml','xslF345X05%2fform4.xml','other/form4.xml','https://evil.invalid/a.xml','a%2f.xml','a\\b.xml',
    'a.xml?x=1','a.xml#x','a..xml','//evil.xml','a@b.xml','form4.htm','a.xml\r\n']) {
    assert.throws(() => secPrimaryDocument(name),isError('INVALID_DOCUMENT'));
  }
});
test('SEC missing environment config fails clearly before fetch and is not exposed in errors', () => {
  const before = process.env.SEC_USER_AGENT;
  delete process.env.SEC_USER_AGENT;
  try { assert.throws(() => createSecClient(),isError('CONFIG_ERROR')); }
  finally { if (before !== undefined) process.env.SEC_USER_AGENT = before; }
  const h = harness([]);
  for (const contact of ['', 'anonymous', 'Application <qa@example.invalid>\r\nx-injected: yes']) {
    assert.throws(() => h.client({userAgent:contact}), error => {
      isError('CONFIG_ERROR')(error);
      assert.equal((error as Error).message,'SEC transport: CONFIG_ERROR'); return true;
    });
  }
  assert.equal(h.calls.length,0);
});
test('SEC policy configuration cannot disable timeout or increase max attempts', () => {
  for (const options of [{timeoutMs:0},{timeoutMs:Infinity},{timeoutMs:60001},{maxAttempts:0},{maxAttempts:4},{maxAttempts:1.5}]) {
    assert.throws(() => harness([]).client(options),isError('CONFIG_ERROR'));
  }
});
test('SEC submissions succeeds with safe headers and recent-only provenance', async () => {
  const body = submissions(); body.filings.files.push({ name:'https://evil.invalid/history.json' });
  const h = harness([() => json(body)]);
  const result = await h.client().fetchCompanySubmissions('12345');
  assert.equal(result.cik,'0000012345'); assert.equal(result.scope,'recent_only');
  assert.equal(result.historicalFilesAvailable,true); assert.equal(result.retrievedAt,new Date(start).toISOString());
  assert.deepEqual(result.filings,[{...metadata,cik:'0000012345'}]);
  assert.equal(h.calls.length,1);
  const init = h.calls[0].init;
  assert.equal((init.headers as Record<string,string>)['User-Agent'],userAgent);
  assert.equal(init.redirect,'manual'); assert.equal(init.credentials,'omit'); assert.equal(init.cache,'no-store');
  assert.ok(init.signal); assert.equal(h.timers(),0);
  assert.ok(!JSON.stringify(result).includes(userAgent));
});
test('SEC submissions retains distinct amendment and dedupes identical accession rows', async () => {
  const amended: SecForm4Metadata = {...metadata,accessionNumber:'0000012345-26-000002',formType:'4/A'};
  const h = harness([() => json(submissions([metadata,metadata,amended]))]);
  const result = await h.client().fetchCompanySubmissions(12345);
  assert.deepEqual(result.filings.map(f => f.formType),['4','4/A']);
  assert.equal(new Set(result.filings.map(f => secFilingKey(f.accessionNumber))).size,2);
});
test('SEC conflicting accession metadata fails instead of silently merging', async () => {
  const h = harness([() => json(submissions([metadata,{...metadata,formType:'4/A'}]))]);
  await assert.rejects(h.client().fetchCompanySubmissions(12345),isError('INVALID_RESPONSE'));
  assert.equal(h.calls.length,1);
});
test('SEC submissions skips unrelated forms, not treated as Form 4', async () => {
  const body = submissions(); body.filings.recent.form[0] = '10-K' as '4';
  const h = harness([() => json(body)]);
  assert.deepEqual((await h.client().fetchCompanySubmissions(12345)).filings,[]);
});
test('SEC malformed submissions shapes, column lengths, CIK and XML filenames fail closed', async () => {
  const badLength = submissions(); badLength.filings.recent.filingDate = [];
  const badDocument = submissions([{...metadata,primaryDocument:'../evil.xml'}]);
  for (const body of [null,{},[],{...submissions(),cik:55},badLength,badDocument,
    submissions([{...metadata,filingDate:'2026-02-30'}]),submissions([{...metadata,accessionNumber:'bad'}])]) {
    const h = harness([() => json(body)]);
    await assert.rejects(h.client().fetchCompanySubmissions(12345),isError('INVALID_RESPONSE'));
    assert.equal(h.calls.length,1);
  }
});
test('SEC invalid request fields cannot reach fetch', async () => {
  const h = harness([]), c = h.client();
  await assert.rejects(c.fetchCompanySubmissions('../1'),isError('INVALID_CIK'));
  await assert.rejects(c.fetchForm4Document({...metadata,accessionNumber:'bad'}),isError('INVALID_ACCESSION'));
  await assert.rejects(c.fetchForm4Document({...metadata,primaryDocument:'../a.xml'}),isError('INVALID_DOCUMENT'));
  await assert.rejects(c.fetchForm4Document({...metadata,formType:'3' as '4'}),isError('INVALID_DOCUMENT'));
  await assert.rejects(c.fetchForm4Document({...metadata,filingDate:'2099-01-01'}),isError('INVALID_DOCUMENT'));
  assert.equal(h.calls.length,0);
});
test('SEC XML envelope preserves accession, raw XML and filing date separately from retrieval', async () => {
  const h = harness([() => xml()]);
  const result = await h.client().fetchForm4Document(metadata);
  assert.equal(result.rawXml,form4Fixtures.purchase); assert.equal(result.formType,'4');
  assert.equal(result.filingDate,metadata.filingDate); assert.equal(result.filingKey,secFilingKey(metadata.accessionNumber));
  assert.equal(result.sourceUrl,secDocumentUrl(metadata)); assert.equal(result.retrievedAt,new Date(start).toISOString());
  assert.ok(!JSON.stringify(result).includes(userAgent));
});
test('SEC parser integration succeeds without inventing issuer CIK from archive CIK', async () => {
  const h = harness([() => json({directory:{item:[{name:'form4.xml'}]}}), () => xml()]);
  const result = await h.client().fetchAndParseForm4(metadata);
  assert.equal(result.error,null); assert.equal(result.parsed.status,'parsed');
  assert.equal(result.parsed.source?.issuer.identifier?.value,'0000000001');
  assert.equal(result.parsed.source?.dates.asOfDate,null); assert.equal(result.parsed.source?.dates.periodEnd,null);
});
test('SEC transport accepts a local real fixture and retains partial/amendment status', async () => {
  const body = readFileSync(new URL('../utils/fixtures/secForm4Real/abm-amendment.xml',import.meta.url),'utf8');
  const h = harness([() => json({directory:{item:[{name:'form4.xml'}]}}), () => xml(body)]);
  const result = await h.client().fetchAndParseForm4({...metadata,formType:'4/A',filingDate:'2026-01-23'});
  assert.equal(result.error,null); assert.equal(result.parsed.status,'partial');
  assert.equal(result.parsed.source?.amendment.kind,'unknown');
});
test('SEC well-formed ownership XML with missing semantics is PARSE_ERROR, not network failure', async () => {
  const h = harness([() => json({directory:{item:[{name:'form4.xml'}]}}), () => xml('<ownershipDocument></ownershipDocument>')]);
  const result = await h.client().fetchAndParseForm4(metadata);
  assert.equal(result.error?.code,'PARSE_ERROR'); assert.ok(result.envelope.rawXml);
  assert.equal(h.calls.length,2);
});
test('SEC metadata/XML form mismatch is PARSE_ERROR and cannot relabel an amendment', async () => {
  const h = harness([() => json({directory:{item:[{name:'form4.xml'}]}}), () => xml(form4Fixtures.amendment)]);
  const result = await h.client().fetchAndParseForm4(metadata);
  assert.equal(result.error?.code,'PARSE_ERROR'); assert.equal(result.parsed.source?.filingType,'4/A');
});
for (const status of [400,401,403,404]) test(`SEC ${status} does not retry or masquerade as parser error`, async () => {
  const h = harness([() => new Response('upstream private error',{status})]);
  await assert.rejects(h.client().fetchAndParseForm4(metadata),isError('SEC_4XX',1));
  assert.equal(h.calls.length,1);
});
test('SEC 500 retries with backoff then succeeds', async () => {
  const h = harness([() => new Response('',{status:500}),() => xml()]);
  await h.client().fetchForm4Document(metadata);
  assert.equal(h.calls.length,2); assert.deepEqual(h.sleeps,[1000]);
});
test('SEC repeated 5xx stops after three attempts with exponential spacing', async () => {
  const h = harness(Array.from({length:3},() => () => new Response('',{status:503})));
  await assert.rejects(h.client().fetchForm4Document(metadata),isError('SEC_5XX',3));
  assert.equal(h.calls.length,3); assert.deepEqual(h.sleeps,[1000,2000]);
});
test('SEC 429 Retry-After seconds is respected without a retry storm', async () => {
  const h = harness([() => new Response('',{status:429,headers:{'retry-after':'5'}}),() => xml()]);
  await h.client().fetchForm4Document(metadata); assert.deepEqual(h.sleeps,[5000]);
});
test('SEC Retry-After HTTP-date is respected on 503', async () => {
  const h = harness([() => new Response('',{status:503,headers:{'retry-after':new Date(start+8000).toUTCString()}}),() => xml()]);
  await h.client().fetchForm4Document(metadata); assert.deepEqual(h.sleeps,[8000]);
});
test('SEC long Retry-After returns immediately and defers subsequent requests across clients', async () => {
  const h = harness([() => new Response('',{status:429,headers:{'retry-after':'3600'}})]);
  await assert.rejects(h.client().fetchForm4Document(metadata),isError('RATE_LIMITED',1));
  await assert.rejects(h.client().fetchForm4Document(metadata),isError('RATE_LIMITED',0));
  assert.equal(h.calls.length,1); assert.deepEqual(h.sleeps,[]);
});
test('SEC repeated 429 is bounded and returns RATE_LIMITED', async () => {
  const h = harness(Array.from({length:3},() => () => new Response('',{status:429})));
  await assert.rejects(h.client().fetchForm4Document(metadata),isError('RATE_LIMITED',3));
});
test('SEC network failures retry but never echo upstream error or contact', async () => {
  const h = harness(Array.from({length:3},() => () => {throw new Error(`sensitive upstream ${userAgent}`);}));
  await assert.rejects(h.client().fetchForm4Document(metadata),error => {
    isError('NETWORK_ERROR',3)(error); assert.ok(!String(error).includes(userAgent));
    assert.ok(!JSON.stringify(error).includes(userAgent)); return true;
  });
});
test('SEC transient network failure can recover on the next attempt', async () => {
  const h = harness([() => {throw new TypeError('network');},() => xml()]);
  await h.client().fetchForm4Document(metadata); assert.equal(h.calls.length,2);
});
test('SEC timeout aborts even a fetch that never settles, clears timers and stays bounded', async () => {
  const h = harness(Array.from({length:3},() => () => new Promise<Response>(() => {})),true);
  await assert.rejects(h.client({timeoutMs:10}).fetchForm4Document(metadata),isError('TIMEOUT',3));
  assert.equal(h.calls.length,3); assert.ok(h.calls.every(c => c.init.signal?.aborted)); assert.equal(h.timers(),0);
});
test('SEC timeout also covers stalled response body consumption', async () => {
  let timeout!: () => void, bodyRead = false, bodyCancelled = false;
  const h = harness([() => new Response(new ReadableStream({
    pull() { bodyRead = true; queueMicrotask(timeout); },
    cancel() { bodyCancelled = true; },
  },{highWaterMark:0}),{headers:{'content-type':'text/xml'}})]);
  h.dependencies.clock.timeout = callback => { timeout = callback; return () => {}; };
  await assert.rejects(h.client({timeoutMs:10,maxAttempts:1}).fetchForm4Document(metadata),isError('TIMEOUT',1));
  assert.equal(bodyRead,true); assert.equal(bodyCancelled,true);
});
test('SEC shared gate spaces concurrent operations from multiple clients at one second', async () => {
  const h = harness([() => xml(),() => xml(),() => json()]);
  await Promise.all([h.client().fetchForm4Document(metadata),h.client().fetchForm4Document(metadata),h.client().fetchCompanySubmissions(12345)]);
  assert.deepEqual(h.calls.map(c => c.at-start),[0,1000,2000]);
});
test('SEC failure releases shared gate for the next caller', async () => {
  const h = harness([() => new Response('',{status:404}),() => xml()]);
  await assert.rejects(h.client().fetchForm4Document(metadata));
  await h.client().fetchForm4Document(metadata); assert.equal(h.calls.length,2);
});
test('SEC Retry-After malformed headers cannot remove minimum backoff', () => {
  for (const input of [null,'','-1','junk','1.5','999999999999999999999999999999999999999'.repeat(10)]) {
    assert.equal(secRetryAfter(input,start),null);
  }
  assert.equal(secRetryAfter('0',start),0);
  assert.equal(secRetryAfter(new Date(start-1000).toUTCString(),start),0);
});
test('SEC redirects never follow arbitrary Location URLs', async () => {
  const h = harness([() => new Response('',{status:302,headers:{location:'http://127.0.0.1/private'}})]);
  await assert.rejects(h.client().fetchForm4Document(metadata),isError('INVALID_RESPONSE',1));
  assert.equal(h.calls.length,1); assert.equal(h.calls[0].init.redirect,'manual');
});
test('SEC mismatched final response URL fails closed', async () => {
  const r = xml(); Object.defineProperty(r,'url',{value:'https://evil.invalid/body'});
  const h = harness([() => r]);
  await assert.rejects(h.client().fetchForm4Document(metadata),isError('INVALID_RESPONSE'));
});
test('SEC HTML blocks, wrong MIME, empty XML and unexpected root are INVALID_RESPONSE', async () => {
  for (const reply of [() => new Response('<html>block</html>',{headers:{'content-type':'text/html'}}),
    () => xml('<html>block</html>'),() => xml(''),() => new Response(form4Fixtures.purchase),
    () => new Response(null,{status:204})]) {
    const h = harness([reply]);
    await assert.rejects(h.client().fetchForm4Document(metadata),isError('INVALID_RESPONSE'));
    assert.equal(h.calls.length,1);
  }
});
test('SEC malformed JSON body is INVALID_RESPONSE without retry', async () => {
  const h = harness([() => new Response('{broken',{headers:{'content-type':'application/json'}})]);
  await assert.rejects(h.client().fetchCompanySubmissions(12345),isError('INVALID_RESPONSE'));
  assert.equal(h.calls.length,1);
});
test('SEC declared and streamed oversized bodies are rejected before parser', async () => {
  for (const reply of [() => new Response('x',{headers:{'content-type':'text/xml','content-length':'2000001'}}),
    () => xml('x'.repeat(2_000_001))]) {
    const h = harness([reply]);
    await assert.rejects(h.client().fetchForm4Document(metadata),isError('INVALID_RESPONSE'));
    assert.equal(h.calls.length,1);
  }
});
test('SEC invalid UTF-8 is INVALID_RESPONSE, not retried network failure', async () => {
  const h = harness([() => new Response(new Uint8Array([0xff]),{headers:{'content-type':'text/xml'}})]);
  await assert.rejects(h.client().fetchForm4Document(metadata),isError('INVALID_RESPONSE',1));
  assert.equal(h.calls.length,1);
});
test('SEC future filing metadata is invalid, never a current observation', async () => {
  const h = harness([() => json(submissions([{...metadata,filingDate:'2099-01-01'}]))]);
  await assert.rejects(h.client().fetchCompanySubmissions(12345),isError('INVALID_RESPONSE'));
});
test('SEC shared gate bounds its pending queue instead of creating unbounded work', async () => {
  const clock = harness([]).dependencies.clock, gate = createSecRequestGate(clock);
  let release!: () => void;
  const first = gate.run(() => new Promise<void>(resolve => {release=resolve;}));
  await Promise.resolve();
  const queued = Array.from({length:99},() => gate.run(async () => 1));
  await assert.rejects(gate.run(async () => 1),isError('RATE_LIMITED'));
  release(); await first; await Promise.all(queued);
});
test('SEC options are captured before requests and never returned as enumerable client config', async () => {
  const h = harness([() => xml()]);
  const options = {userAgent}; const client = h.client(options);
  options.userAgent = 'changed';
  await client.fetchForm4Document(metadata);
  assert.equal((h.calls[0].init.headers as Record<string,string>)['User-Agent'],userAgent);
  assert.equal(JSON.stringify(client),'{}');
});
