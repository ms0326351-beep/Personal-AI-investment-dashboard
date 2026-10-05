# Production migration foundation

This is a reviewed execution artifact, not authorization to touch production.
LOCAL REHEARSAL VERIFIED does not mean PRODUCTION VERIFIED. No application
route imports these tools. No startup migration, provider API, or environment
file loading is included.

## Inventory and ownership

- `production/manifest.v1.json` lists the only application migration allowed by
  the production entry: `production/001_sec_ingestion.sql`.
- `production/PRODUCTION_PROVISIONING_SQL_V1.sql` is separate ADMIN bootstrap,
  never executed by the migration runner. Replace its UUID and password
  placeholders locally only after separate approval. Generate distinct passwords.
- `../identity.sql`, `../permissions.v1.sql`, and
  `../migrations/001_sec_ingestion.sql` remain local/test/rehearsal artifacts;
  they are not automatically adopted into the production manifest.
- Test reset and logical restore SQL remain test-only. Never execute test runners
  against production. The production identity blocks destructive test tooling.

Admin owns `sec_admin` and the identity table. The dedicated migrator owns
`sec_app` and migration-created objects. Runtime owns neither and has no role
membership. Runtime gets identity SELECT, schema USAGE, filings
SELECT/INSERT/UPDATE, transactions SELECT/INSERT/DELETE (failed-retry child
replacement), and attempts SELECT/INSERT. No broad DELETE or sequence grants:
GENERATED ALWAYS identity audit insertion works without sequence privileges.
Default privileges are set for the actual migrator owner, revoke PUBLIC grants,
and do not grant blanket runtime DML on future tables. Each future migration
must specify reviewed table grants; objects created by another owner require a
new ownership review. No runtime schema CREATE or database CREATE/TEMP.

## First-touch and restore gates

1. Confirm isolated production project/branch/database and PG18 manually;
   provider project/branch cannot be proved by PostgreSQL identity alone.
2. Review exact bootstrap, manifest, artifact bytes, ownership, privilege matrix,
   restore capability, restore-point retention and forward-fix strategy.
   Verify provider PITR/branch restoration and credential/TLS handling separately.
   Local logical restore and trust auth prove neither Neon PITR nor Neon auth.
3. With separately authorized, process-scoped ADMIN Direct credentials, run
   **only** the read-only preflight. Missing identity must fail without creating
   anything. Stop and report; it does not authorize automatic bootstrap.
4. After separate write approval, administer bootstrap manually; inspect identity
   and restricted roles, then repeat read-only preflight. Do not print credentials.
5. Before migration, record a usable restore point and recovery procedure. Secure
   backups must include role/ownership recreation and identity verification. A
   restore is an explicit, separately reviewed operation, never a test cleanup.
6. Use dedicated migrator Direct credentials. Admin may temporarily GRANT CREATE
   ON DATABASE neondb TO investment_dashboard_migrator for the runner's
   CREATE SCHEMA IF NOT EXISTS operation; always REVOKE afterwards, including
   failure. Runtime never receives this permission. Grant is not done by CLI.
7. Execute the write entry only with all four approval flags YES. Verify history
   version/name/checksum, ownership and negative permissions, then revoke the
   temporary grant. Re-run read-only preflight; stop before runtime wiring.

## Tool boundaries

Read-only: `pnpm exec tsx --conditions=react-server scripts/sec-production-preflight.ts`

Write: `pnpm exec tsx --conditions=react-server scripts/sec-production-migrate.ts`

Both require process-scoped DATABASE_ENV=production, DB_EXPECTED_INSTANCE_ID,
and DATABASE_DIRECT_URL. Never use NEXT_PUBLIC variables. Direct credentials
must not be exposed to Netlify application runtime. Runtime DATABASE_URL must
be a distinct restricted pooled credential; no runtime wiring is done here.

Write entry requires SEC_MIGRATION_WRITE_APPROVED,
SEC_RESTORE_CAPABILITY_REVIEWED, SEC_RESTORE_POINT_REVIEWED and
SEC_FORWARD_FIX_REVIEWED, each exactly YES. These attestations are operator
gates, not automated proof that backup or restoration works.

Preflight uses BEGIN READ ONLY and ROLLBACK, server-enforced statement and idle
timeouts, identity checks, role flags/membership/ownership checks, and safe
metadata only. It accepts no SQL or migration path. The write entry accepts no
arbitrary migration list; files absent from the manifest never execute. There
are no force/skip-identity/ignore-checksum/destructive bypass switches.

## Artifact immutability and failure recovery

UTF-8 SQL bytes are SHA-256 checked before DB access. Preserve LF bytes in Git.
Manifest versions/orders must be contiguous; dependencies must already appear.
History must match the current manifest exactly. Never edit an applied migration;
add a reviewed forward migration and corresponding checksum/entry instead.
DDL, history and grants run atomically. A pre-COMMIT error rolls back. An
acknowledgement failure is UNKNOWN: inspect history over a fresh connection,
do not assume rollback or blindly reset/retry. No automatic down migration.

## Still blocked

Actual provisioning/migration require separate approval and proven production
restore procedures. First live ingestion additionally requires persistent,
immutable RawXmlStore and a reviewed retention policy. Production auth, role
permissions, provider restore, runtime pool sizing and actual network failure
semantics remain unverified. Amendment reconciliation/reprocessing remain out
of scope. Historical pooled hang remains NOT REPRODUCED; root cause UNKNOWN.
