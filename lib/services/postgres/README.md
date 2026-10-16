# Stage 2C3D: local PostgreSQL validation

No runtime route imports this adapter. No Neon/Supabase project, credentials,
production migration, DB URL, environment file, scheduler or live SEC is needed.
The adapter accepts an explicitly supplied standard pg Pool and schema. It is
server-only and does not create connections/schema at import time.

## Run

Docker Desktop Engine must already be running. The runner finds the per-user
Windows installation or uses Docker from PATH; it never installs system software.

```
pnpm run test:postgres
pnpm run test:postgres:all
```

The first command runs shared PostgreSQL contract and integration tests. The
second runs the full repository suite with PostgreSQL enabled. Plain `pnpm test`
explicitly skips the integration entry unless invoked by the isolated runner;
do not describe that skip as a PostgreSQL pass.

Runner uses pinned official PostgreSQL 17 image digest, a randomized container
name, only 127.0.0.1 with a dynamically assigned port, tmpfs data (no persistent
volume), dedicated sec_contract_test database and trust auth solely for disposable
local testing. Never reuse trust authentication for deployed databases. Host is
not user-configurable. No production secrets or PostgreSQL ambient credentials
are used. A random runner marker is checked before any schema mutation. The
marker is an isolation identifier, not a credential. Container readiness uses TCP.

Each test creates its own sec_test_<random> schema and drops only that exact schema.
v001 setup executes transactionally, can be repeated, and records schema version.
The runner removes only its own exact container in finally. Hard process termination
can bypass finally; in that case inspect its investment-dashboard.stage=2c3d label
and exact generated name before removing that dedicated container. Never prune
other Docker resources or delete unrelated database schemas.

## Storage correctness

Database PRIMARY KEY(accession), transaction primary/unique keys and FK enforce
identity. A single acquired connection owns BEGIN/INSERT/locked compare/rows/COMMIT.
ON CONFLICT DO NOTHING plus a separate SELECT FOR UPDATE handles READ COMMITTED
visibility. Existing immutable PARSED/PARTIAL snapshots win; FAILED retries preserve
observed hashes. Snapshot JSON keeps full provenance, parser limitations, roles,
footnotes and null semantics. Child rows are stored separately and accession reads
join them in one statement snapshot. No application mutex or fake database.

Shared domain validation is reused by memory and PostgreSQL. Audit safe field
selection is also shared; actual attempt persistence is a PostgreSQL INSERT.
Audit appending remains separate from filing commit as defined in Stage 2C3C;
a crash between commit and append can omit the attempt. No stronger guarantee is
claimed. Integrity conflicts never overwrite data and service audit records both
observations. Amendment accession remains separate with unresolved parent.

Exact source decimal strings bind to unbounded NUMERIC, not float or fixed scale.
Financial columns are independently round-trip tested, including values exceeding
JS safe integer/precision. Snapshot number fields remain legacy display observations;
persistenceAmounts/rawFields retain exact text. No definitive transaction value
is invented. Parser reprocessing and raw XML retention are not implemented.

## Fault evidence

Child failure is a real PostgreSQL CHECK failure on row 2. A trigger/sequence probe
proves both child INSERTs were attempted; sequence progress survives rollback, while
filing and rows do not. Filing failure is a real CHECK failure. A separate adapter
exception test injects a JS driver-boundary exception with real BEGIN/ROLLBACK.

Ten workers use ten pools/backend PIDs and a pre-insert test barrier. They do not
share a process mutex. DB counts verify one filing/row and no orphan.

Acknowledgement test faults occur after real COMMIT. Retry reads the existing
snapshot without duplicate rows. Actual network/TCP COMMIT-response loss is
NOT FULLY VERIFIED. COMMIT errors are conservatively UNKNOWN; rollback-confirmed
pre-COMMIT errors are NOT_COMMITTED. Adapter never exposes upstream error text.

Cloud integration, production permissions, pooling limits, backups/restore and
network-loss testing are later acceptance tasks. Full offline reprocessing requires
retained raw XML. This schema is local/test validation, not production deployment.

## Pooled compatibility validation (Stage 2C3E.1)

Test-only cloud mode can select a pooled runtime endpoint while a separately
supplied Direct connection administers the isolated schema. Both require verified
TLS. No connection value is stored in the repository. After Direct migration,
the pooled connection must see the same randomly named schema/version before
running adapter contracts. Direct connection remains the migration baseline.

Transaction pooling may reuse a backend PID across different client sessions.
Concurrency validation pins ten simultaneous BEGIN transactions before checking
distinct backend PIDs; it then releases them before the ingestion race. Lifecycle
tests check client replacement/release instead of requiring a new backend PID.
Temporary NUMERIC probes stay inside one transaction and use ON COMMIT DROP.
The persistent adapter uses one acquired client through COMMIT/ROLLBACK and
transaction-local settings, with fully qualified schema names.

Recommended future strategy: Direct for migrations/schema administration; Pooled
for serverless runtime, subject to separate production permissions, pool sizing
and failure-recovery acceptance. This test mode does not wire production routes.
Reference: https://neon.com/docs/connect/connection-pooling

Cloud reliability diagnostics emit test names, SQL verbs, elapsed times and pool
counts only, never SQL parameters or driver error text. The opt-in cloud runner
streams progress rather than buffering an entire suite. It supports a test-name
filter and up to three consecutive runs using process-supplied test credentials.
Acquire timeout is 20 seconds, driver query timeout 30 seconds, per-test timeout
90 seconds, worker barrier timeout 30 seconds, shutdown timeout 30 seconds and
whole-run watchdog 8 minutes. Existing adapter transaction statement/lock
timeouts are unchanged. Timeouts fail the test; they never turn failure into PASS.
Concurrency probes wait for all acquire operations to settle before cleanup;
rollback failures cannot skip release. Pool shutdown timeout destroys only test
clients belonging to that pool and reports failure. Historical unobserved hangs
cannot be attributed to a specific SQL operation from buffered logs alone.
