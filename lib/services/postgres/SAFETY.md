# Stage 2C3G safety foundation

No production project, credential, role, route or storage provider is created.
Runtime uses DATABASE_URL (pooled), DATABASE_ENV and DB_EXPECTED_INSTANCE_ID.
Migration tooling alone uses DATABASE_DIRECT_URL (Direct). Both require verified
TLS; no fallback to validation URLs. Runtime defaults: max 2 (cap 5), acquisition
10s, query 15s, idle 10s. The existing adapter uses SET LOCAL lock_timeout 5s and
statement_timeout 10s; driver timeout never proves a COMMIT rollback.
PostgreSQL 17+ transaction_timeout 30s and idle-in-transaction timeout 15s
bound the adapter/migration transaction; older PostgreSQL is not supported by
this timeout foundation. Runtime helper destroys clients after callback failure.

The fixed sec_admin.database_identity table is bootstrapped by a separately
authorized admin, using identity.sql plus a bound environment/UUID insert.
It is not created automatically by cloud tests. UUID/database/environment must
match process-scoped expectations before bootstrap mutations and again before
cleanup. Cloud testing additionally requires exact endpoint allowlisting.
No --force-production option exists. Missing/malformed/production identity is
refused by destructive tools. Runtime must have read-only access to this marker.
Local disposable runner creates its own marker in its isolated container.

Cloud test variables: DATABASE_ENV, SEC_PG_EXPECTED_INSTANCE_ID,
SEC_PG_EXPECTED_DATABASE, SEC_PG_ALLOWED_HOSTS (exact comma-separated endpoints).
These are identity configuration, not database credentials. Existing validation
connection variable names remain supported by the caller. Never print their values.
For the first cloud marker, an operator must independently confirm the dev/test
database before the one-time administrative bootstrap. Tests cannot relabel an
unmarked database themselves. PostgreSQL cannot infer a Neon project ID locally.

Migration runner takes a caller-owned Direct pool, verifies identity, then holds
a transaction advisory lock. Ordered versions start at 1; all prior names/checksums
must match. DDL/history are atomic. COMMIT acknowledgement failure is UNKNOWN.
Never adopt an existing untracked schema as a fresh migration: production starts
empty; legacy adoption requires a separate reviewed compatibility procedure.
No migrations run at build/import time. Caller finally closes migration pool.
Production deployment must use expand/migrate/contract and a tested restore plan.

RawXmlStore is provider-neutral, immutable by accession/hash and optional for
legacy callers. Only an in-memory contract adapter exists. A future object provider
must enforce cross-instance atomic create-if-absent and the same integrity rules.
DB provenance holds reference/hash, not raw XML. Object storage and PostgreSQL
cannot share a transaction: an orphan object after DB failure is safe, while a DB
record must never pretend a failed retention write succeeded. No cloud storage yet.

Atomic terminal audit uses an optional repository capability. PostgreSQL writes
the terminal outcome before COMMIT on the same client as filing/transactions.
Operational failures outside that transaction can still be recorded best-effort.
Old adapters/wrappers retain the original save/audit behavior for compatibility.
No reprocessing, amendment merge, cron, SEC requests or production wiring.
