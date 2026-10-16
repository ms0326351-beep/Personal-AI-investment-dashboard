# Local PostgreSQL 18 provisioning rehearsal

Run `node scripts/test-sec-provisioning.mjs` for the dedicated suite, or add
`--all` to run the entire repository with PostgreSQL enabled. No env files or
external database URLs are loaded. The pinned PG18 image uses loopback-only
Docker publishing and tmpfs; the runner removes only its own named container.
There is a 180-second runner deadline and a 120-second test deadline.

The neondb database has a simulated production identity. A separate
sec_contract_test database has a test identity for the existing contract suite.
Production cleanup is refused by application guards; final Docker removal is
authorized disposal of the exact container created by this local runner.

The original 001_sec_ingestion.sql remains Local/test and is excluded from a
Production manifest. Its exact bytes are used ONLY as rehearsal migration v1
(`rehearsal_only_sec_ingestion`). Rehearsal v2 is an ordering probe; v3 is a
deliberately failing migration. None is a Production artifact. Checksums are
calculated from those exact SQL strings; historical mutation is refused.

Admin bootstraps identity and roles; the migrator owns sec_app and migration
objects. Runtime has no owner/admin membership, no DDL, no identity writes, and
no sequence grants. It has SELECT/INSERT/UPDATE on filings, SELECT/INSERT/DELETE
on transactions (failed-record retry), and SELECT/INSERT on attempts.
Future objects default to denied runtime access. A rolled-back default-ACL
probe proves migrator defaults do not apply to admin-created tables.

Local role passwords are random, process-only, and never printed. This isolated
runner uses Docker loopback trust authentication: it validates SQL authorization
under actual roles, NOT password authentication, TLS, Neon pooled transport or
production endpoint identity. Those remain separate production gates.

The local runtime pool simulation validates lazy acquisition, bounds, timeout,
release and reconnect. The production factory's TLS/config contract is checked
without connecting it to a fake TLS hostname or bypassing its production rules.

Logical backup uses pg_dump --no-owner --no-acl in memory, then psql to restore
into a second disposable database. It verifies exact filing/child/audit JSON,
identity and migration history. Ownership/ACL restoration, Neon PITR, retention
and production-scale RTO are NOT established by this drill. The restored marker
is simulated production; no application cleanup is run against it.

COMMIT uncertainty is a simulated caller error after a confirmed commit, not
real TCP acknowledgement loss. Production raw XML retention remains pending
and blocks first live ingestion, not this provisioning/schema rehearsal.
