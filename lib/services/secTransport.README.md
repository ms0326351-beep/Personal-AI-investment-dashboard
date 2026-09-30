# SEC transport foundation (Stage 2C1)

Server-only, opt-in library. Nothing calls it from a route, page, job or scheduler.
No production ingestion, database writes, AI, event scoring or amendment merge.
The XML parser remains pure and unchanged.

## Configuration and API

Set `SEC_USER_AGENT` in the calling server process, with an application identity
and legitimate contact. Do not prefix it with NEXT_PUBLIC_, log it, commit it or
include it in fixtures. Missing/invalid configuration throws CONFIG_ERROR before
any fetch. The factory also accepts trusted server-side configuration for tests.
This module does not load or modify env files or Git identity.

`createSecClient()` exposes only:

- `fetchCompanySubmissions(cik)`: official data.sec.gov submissions JSON;
  validates CIK and aligned arrays, selects 4/4A metadata, deduplicates identical
  accession rows, rejects conflicting duplicates. Scope is explicitly recent_only.
  Historical files are noted but never followed. This is not complete history.
- `fetchForm4Document(metadata)`: raw SEC Archives XML and a provenance envelope.
  Requires CIK, accessionNumber, primaryDocument, formType and filingDate, normally
  from submissions. These fields are not guessed from XML or signatures.
- `fetchAndParseForm4(metadata)`: first resolves raw XML through the accession
  directory index.json, then invokes the unchanged parser. Transport errors throw typed safe errors;
  successful retrieval with unavailable/mismatched parser output returns the raw
  envelope, parsed diagnostics and a PARSE_ERROR. A partial parse remains partial.
  Consumers must check error/status before using parsed data.

CIK identifies the requested archive/submissions context, not verified ownership
or issuer identity. Filing identity is `sec:` plus exact dashed accession.
An amendment with another accession is distinct; no trade/position aggregation.
Repeated calls intentionally re-fetch: deterministic identity is not a cache or
in-flight dedupe layer. Filing date is never transactionDate, periodEnd or knownAt.
retrievedAt records completed retrieval; sourceUrl identifies the exact document.

## Request policy and boundaries

All production factory instances share one in-process FIFO gate (maximum 100
pending operations), serializing operations including retries. Request starts are
at least 1 second apart. A distributed deployment needs cross-instance limiting
before use as production ingestion; this module is not a global rate limiter.
Queue time is separate from the per-attempt network timeout.

Default timeout is 15 seconds, configurable from 1 to 60,000 ms; it covers headers
and body reading, aborts/cancels work and clears timers. Maximum attempts default
to 3 and cannot exceed 3. Network failure, timeout, 429 and 5xx retry with 1s/2s
backoff. Other 4xx, redirects, schema/body failures do not retry. Retry-After seconds
or HTTP dates can lengthen the cooldown, never shorten it. Delays over 60 seconds
return the error without early retry; the gate retains the cooldown for later
callers. Restarting the process loses this in-memory cooldown.

Endpoints are built from validated identifiers, never arbitrary URLs. Filenames
must be simple .xml basenames or have exactly one SEC xslF345XNN/ prefix.
Metadata and the request URL retain that original path without removing the prefix.
Traversal, encoded separators, queries, fragments and other subpaths are
rejected. Redirects are disabled; response URL changes,
non-200 responses, wrong MIME, invalid UTF-8, empty/non-ownership XML and oversized
bodies fail closed. Stream limits: 5 MB JSON, 2 MB XML, even without Content-Length.
Only application/json, application/xml and text/xml are supported at this stage.
This is not XSD validation, historical pagination or full SEC format coverage.

## Ownership document resolution

The independent resolver validates the accession index and every listed filename.
Only flat, safe XML names explicitly listed in this directory can be downloaded.
index.xml, filings.xml and directory.xml are excluded. A matching primaryDocument
basename is a hint, not authority: it must be listed and pass safe XML parsing.
The original primaryDocument and presentationUrl remain distinct from sourceUrl
(the resolved raw XML URL), indexUrl, resolvedDocument and resolutionMethod.

A verified exact basename match has priority. Otherwise at most five remaining
XML candidates are examined (plus the hint, if present); exactly one verified
ownershipDocument is required. Duplicate names are deduplicated, ambiguous results
fail explicitly and excessive candidates fail without claiming uniqueness.
DTD, malformed XML, wrong roots and HTML are rejected. Network/size/MIME errors
propagate rather than silently treating unread documents as non-ownership XML.
XML MIME remains required; no HTML scraping or relaxed MIME fallback is included.
Resolver parse limits are 128 levels and 100,000 elements, in addition to transport
byte limits. Well-formed ownership XML still undergoes the existing semantic parser.

No upstream exception, response body or header is copied into error messages.
Errors expose only code, status, attempts and retryAfterMs. Parser diagnostics/raw
filing envelopes are separate data, not logging payloads. Do not log full envelopes.

## Offline verification and manual smoke

`secClient.test.ts` injects fetch, clocks, timers and an isolated gate. All HTTP
responses are mocked, including the local Stage 2B XML sample. No test fetches SEC.
Trusted dependency injection is solely an internal seam, not user-request input.

A separately authorized manual smoke can use an already configured process to
fetch one submissions response and one known XML document. Use maxAttempts: 1,
do not traverse history or print configuration. Automated success does not imply
live SEC connectivity has been verified. Stage 2C1 does not supply a live runner.

Official references checked during implementation:
- https://www.sec.gov/search-filings/edgar-application-programming-interfaces
- https://www.sec.gov/about/developer-resources
