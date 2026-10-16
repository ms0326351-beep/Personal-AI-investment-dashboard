# Stage 2C3C: persistent adapter contract

No database, credentials, transport execution, migration or cloud adapter is created.
`SecIngestionRepository` still exposes accession lookup and whole-snapshot save.
Domain types do not depend on a provider SDK. This contract is not proof of a
distributed database implementation; the registered adapter is memory-only.

## Outcomes and visibility

- CREATED + PARSED: supported parsed snapshot saved atomically.
- CREATED + PARTIAL: valid supported rows saved with diagnostics/unsupported counts.
- ALREADY_EXISTS: authoritative immutable successful snapshot, ordinary retry/no-op.
- INTEGRITY_CONFLICT: observed hash differs; preserve original, record both hashes.
- METADATA_CONFLICT: form/date/CIK/document identity differs, including failed records.
- FAILED + retryable failure: explicit future retry allowed, no automatic loop.
- FAILED + PARSER category: no successful transaction rows; retain parser diagnostics.
- ACKNOWLEDGEMENT_UNKNOWN + UNKNOWN state: caller cannot know if save committed.
  Transaction count is null, not a fabricated zero; retry resolves via accession.

UNKNOWN is a request outcome, never a persisted filing state. Repository reads
must expose no record or one complete terminal snapshot. A thrown save can have
committed a complete snapshot; it cannot expose a partial one. Only a confirmed
rollback/no-write permits `SecRepositoryWriteError('NOT_COMMITTED')`. Untyped save
errors are conservatively UNKNOWN. Read failure occurs before write and returns
NOT_COMMITTED. Error messages/configuration are not returned or audited.

## Persistent database obligations

DB UNIQUE(accession) and UNIQUE(filing, table, ordinal), foreign keys, one database
transaction for the filing/rows/metadata, conflict-aware insert and locked compare
are mandatory. A preflight SELECT or process mutex is insufficient. Expected
uniqueness races return ALREADY_EXISTS or a specific conflict, never generic 500.
Same values in different accessions are separate transactions. FAILED cannot erase
success. A failed content observation retains its hash across transport-only retry.
Form 4/A is separate; no guessed parent, merge or cross-filing economic summation.

Ordinary save preserves PARSED/PARTIAL, even with a different parser version or
candidate status. Explicit reprocessing is NOT implemented. A future operation
must retain revision history, verify the same hash, reconcile deterministic rows
within the new revision, and activate it atomically. Never silently upgrade PARTIAL.

## Audit

Inject `SecIngestionAudit` and a deterministic clock when needed. No default audit
or database is silently created. Each service attempt records safe metadata,
timestamp, observed/existing hashes, outcome, parser version/status, warnings and
classified failure. Early-return conflicts and failed revalidation are included.
`auditStatus` distinguishes NOT_CONFIGURED, RECORDED and UNAVAILABLE. Audit append
failure never rewrites successful filing state; it is visible to the caller.

Memory audit is append-only and detached but not persistent. A future adapter must
define attempt IDs and durable append/transaction policy. Audit can show DB commit
completion, not prove response delivery. A complete audit across crashes is not
guaranteed by a service-level callback; deployment must not advertise that guarantee.

## Exact decimals

Existing parser number fields remain backward compatible and are NOT the source
of monetary persistence. `persistenceAmounts` selects exact validated decimal text
from parser rawFields for shares, price and ownership-after. Missing/ambiguous text
stays null; no Number round-trip, float arithmetic or invented currency/unit basis.
The repository rejects a sidecar inconsistent with original source lexemes.
Source observations retain row evidence/footnotes; they are not definitive value.
transactionValue stays null in this ingestion layer. Existing eligible position
analysis calculates a decimal-string value separately; this stage does not change it.

PostgreSQL must bind exact strings to NUMERIC/DECIMAL, not FLOAT. Do not silently
round into an insufficient fixed scale: preserve exactness or reject with a
classified failure. Round-trip tests on a real DB remain required.

## Raw XML and shared tests

`SecRawXmlRetention` is a future read seam, not storage implementation. Provenance
currently contains sourceUrl (raw XML URL), hash and retrievedAt, not retained XML.
Full offline reprocessing requires retained raw XML.

`testing/secIngestionContract.ts` registers the common offline suite. Each future
adapter supplies isolated storage, actual DB counts, independent connections,
attempt reads, cleanup and transaction fault injection. The PostgreSQL harness
must fail an actual child write inside its transaction; ACK timeout injection must
occur after actual COMMIT. Memory uses invalid-child validation before atomic
publication and a post-save acknowledgement fault. Those are memory-level proofs,
not PostgreSQL rollback/distributed proofs. This testing module is never imported
by production service code. Tests cover boundaries; reprocessing implementation
and real database guarantees are deliberately deferred.
