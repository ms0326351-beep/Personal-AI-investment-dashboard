# SEC ingestion foundation (Stage 2C2)

Server-only and opt-in. No route, database, scheduler or network is started here.
Pass a `SecIngestionRepository` and a compatible `createSecClient()` instance to
`createSecIngestionService`. Tests use deterministic fixtures and injected transport.

Accession is the strict canonical dashed SEC identity, shared with Stage 2C1.
Filing keys are `sec:{accession}`; rows are `{filingKey}:non_derivative:{ordinal}`.
Ordinal matches the pure parser's original non-derivative transaction order.
Equal row values do not collapse distinct rows or different accessions. Parsed
identities remain unverified; no new global person/security identity is inferred.

`ingestForm4Filing(metadata)` checks existing PARSED/PARTIAL records before fetching.
Successful records return ALREADY_EXISTS, without another download. To explicitly
verify content, call with `{ revalidate: true }`. This reuses existing transport
limits; ingestion itself has no automatic retry loop. Only explicit invocation
retries failure. Retryability is classification for a future caller, not scheduling.

Raw XML is hashed as the exact decoded string encoded as UTF-8 (SHA-256), including
whitespace. Neither hash nor issuer/owner/date replaces accession as the identity.
Revalidation or concurrent saves with a different hash return INTEGRITY_CONFLICT;
the original stored snapshot is returned and not overwritten. Same hash preserves
the first observation, parser result and timestamp. Form/date conflicts also fail
closed. A default NO_OP cannot detect upstream content changes without fetching.

PENDING/FETCHED are in-process steps, not partially visible database records.
The terminal PARSED, PARTIAL or FAILED snapshot is saved atomically. PARTIAL retains
all supported transactions, complete parser diagnostics/raw fields/unsupported
counts, and never claims full coverage. Failed parsing stores no transaction
records. Failed revalidation does not overwrite an existing successful filing.
Failures expose categories/codes, never upstream exception text or configuration.

The memory adapter is local/test-only. It clones inputs and outputs and atomically
compares/inserts the full filing plus rows using one synchronous Map replacement.
There are no separately committed rows. Failed attempts can be replaced by retry;
success is immutable. Future persistent adapters must provide a unique accession
constraint and transactional compare-and-insert across workers. Multiple workers
may still download the same filing; repository atomicity prevents duplicate data.
The memory adapter does not survive restarts and is not a distributed database.

Form 4/A retains a separate accession/provenance and isAmendment=true. Its parent
accession stays null/unknown even if issuer, owner or dates match. No amendment merge,
reconciliation or cross-filing trade aggregation exists. Consumers must not sum
original and amendment rows as independent economic trades without reconciliation.

Provenance keeps source SEC, metadata, presentation/index/raw URLs, retrieval time,
hash basis and parser/schema versions. Raw XML is not persisted; parsed source
fields and evidence are preserved. Failure before retrieval has null provenance.
No SEC contact, request configuration or environment is copied into storage.

Known limits: latest failed attempt only (no audit-history store), no leases or
crash recovery, no parser-version reprocessing, no raw blob storage, no verified
entity resolution, no derivative/holding-only expansion. Existing filing dates
remain distinct from transaction dates; periodOfReport is never a holdings date.
