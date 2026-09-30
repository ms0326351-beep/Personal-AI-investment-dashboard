import 'server-only';
import { resolveOwnershipXmlDocument } from './secOwnershipResolver';
import { SecTransportError, type SecForm4Metadata, type SecSubmissionsEnvelope, type SecXmlEnvelope } from '../types/secTransport';
import { normalizeSecCik, secSubmissionsUrl, secDocumentUrl, secFilingKey, validateSecMetadata } from '../utils/secEndpoints';
import { parseForm4Xml } from '../utils/secForm4Parser';
import { secRetryAfter, sharedSecRequestGate, systemSecClock, type SecClock, type SecRequestGate } from './secRequestPolicy';

interface SecClientOptions { userAgent?: string; timeoutMs?: number; maxAttempts?: number }
/** Trusted dependency injection for offline tests, never configuration from a web request. */
export interface SecClientDependencies { fetch: typeof fetch; clock: SecClock; gate: SecRequestGate }

function readUserAgent(value: unknown): string {
  if (typeof value !== 'string' || value.length > 256 || !/^[\x20-\x7e]+$/.test(value) ||
    !/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(value) || !value.trim()) {
    throw new SecTransportError('CONFIG_ERROR');
  }
  return value;
}

/** Recent submissions only. Never follow files[]/URLs supplied by a remote response. */
function submissionsMetadata(raw: unknown, cik: string): { filings: SecForm4Metadata[]; historicalFilesAvailable: boolean } {
  const invalid = () => new SecTransportError('INVALID_RESPONSE');
  if (!raw || typeof raw !== 'object') throw invalid();
  const data = raw as { cik?: unknown; filings?: { recent?: Record<string, unknown>; files?: unknown } };
  try { if (normalizeSecCik(data.cik) !== cik) throw invalid(); } catch { throw invalid(); }
  const recent = data.filings?.recent;
  if (!recent || !Array.isArray(recent.form)) throw invalid();
  const forms = recent.form;
  const keys = ['accessionNumber','filingDate','primaryDocument'] as const;
  if (forms.length > 10000 || keys.some(k => !Array.isArray(recent[k]) || recent[k].length !== forms.length) ||
    forms.some(f => typeof f !== 'string')) throw invalid();
  const result = new Map<string, SecForm4Metadata>();
  forms.forEach((form, index) => {
    if (form !== '4' && form !== '4/A') return;
    try {
      const m = validateSecMetadata({ cik, formType: form,
        accessionNumber: (recent.accessionNumber as string[])[index],
        filingDate: (recent.filingDate as string[])[index], primaryDocument: (recent.primaryDocument as string[])[index] });
      const key = secFilingKey(m.accessionNumber), previous = result.get(key);
      if (previous && JSON.stringify(previous) !== JSON.stringify(m)) throw invalid();
      result.set(key, m);
    } catch { throw invalid(); }
  });
  if (data.filings?.files !== undefined && !Array.isArray(data.filings.files)) throw invalid();
  return { filings: [...result.values()], historicalFilesAvailable: Array.isArray(data.filings?.files) && data.filings.files.length > 0 };
}

export function createSecClient(options: SecClientOptions = {}, dependencies?: SecClientDependencies) {
  // Never log options, request headers, environment or upstream error objects.
  const userAgent = readUserAgent(options.userAgent ?? process.env.SEC_USER_AGENT);
  const timeoutMs = options.timeoutMs ?? 15_000, maxAttempts = options.maxAttempts ?? 3;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000 ||
    !Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 3) throw new SecTransportError('CONFIG_ERROR');
  const runtime = dependencies ?? { fetch: globalThis.fetch, clock: systemSecClock, gate: sharedSecRequestGate };

  async function attempt(url: string, kind: 'json' | 'xml' | 'ownershipCandidate', count: number): Promise<string> {
    const controller = new AbortController();
    let cancel = () => {};
    const deadline = new Promise<never>((_, reject) => {
      cancel = runtime.clock.timeout(() => {
        reject(new SecTransportError('TIMEOUT', null, count));
        controller.abort();
      }, timeoutMs);
    });
    const work = async () => {
      try {
        const response = await runtime.fetch(url, { method: 'GET', redirect: 'manual', credentials: 'omit',
          referrerPolicy: 'no-referrer', cache: 'no-store', signal: controller.signal,
          headers: { 'User-Agent': userAgent, Accept: kind === 'json' ? 'application/json' : 'application/xml, text/xml' } });
        const fail = (error: SecTransportError): never => {
          void response.body?.cancel().catch(() => {});
          throw error;
        };
        if (response.redirected || (response.url && response.url !== url) || (response.status >= 300 && response.status < 400)) {
          return fail(new SecTransportError('INVALID_RESPONSE', response.status, count));
        }
        if (response.status !== 200) {
          const code = response.status === 429 ? 'RATE_LIMITED' : response.status >= 500 ? 'SEC_5XX'
            : response.status >= 400 ? 'SEC_4XX' : 'INVALID_RESPONSE';
          return fail(new SecTransportError(code, response.status, count,
            secRetryAfter(response.headers.get('retry-after'), runtime.clock.now())));
        }
        const mime = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
        const allowed = kind === 'json' ? ['application/json'] : ['application/xml','text/xml'];
        const limit = kind === 'json' ? 5_000_000 : 2_000_000;
        const length = response.headers.get('content-length');
        if (!mime || !allowed.includes(mime) || !response.body ||
          (length !== null && (!/^\d+$/.test(length) || Number(length) > limit))) {
          return fail(new SecTransportError('INVALID_RESPONSE', response.status, count));
        }
        const reader = response.body.getReader();
        const abortBody = () => { void reader.cancel().catch(() => {}); };
        controller.signal.addEventListener('abort', abortBody, { once: true });
        const decoder = new TextDecoder('utf-8', { fatal: true });
        let bytes = 0, text = '';
        try {
          while (true) {
            const chunk = await reader.read();
            if (controller.signal.aborted) throw new SecTransportError('TIMEOUT', null, count);
            if (chunk.done) break;
            bytes += chunk.value.byteLength;
            if (bytes > limit) throw new SecTransportError('INVALID_RESPONSE', 200, count);
            try { text += decoder.decode(chunk.value, { stream: true }); }
            catch { throw new SecTransportError('INVALID_RESPONSE', 200, count); }
          }
          try { text += decoder.decode(); } catch { throw new SecTransportError('INVALID_RESPONSE', 200, count); }
          if (!text.trim() || (kind === 'xml' && !/^\s*(?:<\?xml[^?]*\?>\s*)?<ownershipDocument(?:\s|>)/.test(text))) {
            throw new SecTransportError('INVALID_RESPONSE', 200, count);
          }
          return text;
        } finally {
          controller.signal.removeEventListener('abort', abortBody);
          void reader.cancel().catch(() => {});
        }
      } catch (error) {
        if (error instanceof SecTransportError) throw error;
        throw new SecTransportError(controller.signal.aborted ? 'TIMEOUT' : 'NETWORK_ERROR', null, count);
      }
    };
    try { return await Promise.race([work(), deadline]); }
    finally { cancel(); controller.abort(); }
  }

  async function request(url: string, kind: 'json' | 'xml' | 'ownershipCandidate') {
    return runtime.gate.run(async () => {
      for (let count = 1; count <= maxAttempts; count++) {
        await runtime.gate.beforeAttempt();
        try { return await attempt(url, kind, count); }
        catch (error) {
          if (!(error instanceof SecTransportError)) throw new SecTransportError('NETWORK_ERROR', null, count);
          const retryable = ['RATE_LIMITED','SEC_5XX','TIMEOUT','NETWORK_ERROR'].includes(error.code);
          const delay = Math.max(1000 * 2 ** (count - 1), error.retryAfterMs ?? 0);
          if (retryable) runtime.gate.defer(delay);
          if (!retryable || count === maxAttempts || delay > 60_000) throw error;
          // The shared gate applies this cooldown before the next attempt/client.
        }
      }
      throw new SecTransportError('NETWORK_ERROR');
    });
  }

  async function fetchCompanySubmissions(input: string | number): Promise<SecSubmissionsEnvelope> {
    const cik = normalizeSecCik(input), sourceUrl = secSubmissionsUrl(cik);
    const body = await request(sourceUrl, 'json');
    let raw: unknown;
    try { raw = JSON.parse(body); } catch { throw new SecTransportError('INVALID_RESPONSE'); }
    const metadata = submissionsMetadata(raw, cik);
    if (metadata.filings.some(f => Date.parse(f.filingDate) > runtime.clock.now())) {
      throw new SecTransportError('INVALID_RESPONSE');
    }
    return { source: 'SEC', cik, sourceUrl, retrievedAt: new Date(runtime.clock.now()).toISOString(),
      scope: 'recent_only', ...metadata };
  }
  async function fetchForm4Document(input: SecForm4Metadata): Promise<SecXmlEnvelope> {
    const metadata = validateSecMetadata(input);
    if (Date.parse(metadata.filingDate) > runtime.clock.now()) throw new SecTransportError('INVALID_DOCUMENT');
    const sourceUrl = secDocumentUrl(metadata), rawXml = await request(sourceUrl, 'xml');
    return { ...metadata, source: 'SEC', filingKey: secFilingKey(metadata.accessionNumber), sourceUrl,
      retrievedAt: new Date(runtime.clock.now()).toISOString(), rawXml };
  }
  async function fetchAndParseForm4(input: SecForm4Metadata) {
    const envelope = await resolveOwnershipXmlDocument(input, request, runtime.clock.now);
    const parsed = parseForm4Xml(envelope.rawXml, {
      filingId: envelope.accessionNumber, accessionNumber: envelope.accessionNumber,
      sourceIdentifier: envelope.sourceUrl, sourceUrl: envelope.sourceUrl, filingUrl: envelope.sourceUrl,
      retrievedAt: envelope.retrievedAt, filedAt: envelope.filingDate, origin: 'public',
    });
    if (!parsed.source || parsed.status === 'unavailable' || parsed.source.filingType !== envelope.formType) {
      // Retain the successful transport envelope without echoing raw parser messages.
      return { envelope, parsed, error: new SecTransportError('PARSE_ERROR') };
    }
    return { envelope, parsed, error: null };
  }
  return { fetchCompanySubmissions, fetchForm4Document, fetchAndParseForm4 };
}
