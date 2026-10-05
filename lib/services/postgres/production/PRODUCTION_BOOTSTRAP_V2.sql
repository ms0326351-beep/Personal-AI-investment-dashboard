-- PRODUCTION_BOOTSTRAP_V2: ADMIN-only reviewed bootstrap, never auto-executed.
-- Replace only the password placeholders and locally generated UUID after approval.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='10s';
SET LOCAL idle_in_transaction_session_timeout='15s';
SET LOCAL transaction_timeout='30s';
SELECT pg_advisory_xact_lock(hashtext('sec-production-bootstrap'));
DO $$ BEGIN
 IF current_database() <> 'neondb' OR current_setting('server_version_num')::integer / 10000 <> 18 THEN
 RAISE EXCEPTION 'Production bootstrap target refused'; END IF; END $$;
-- Admin-controlled identity. Bootstrap separately, never from test harness.
-- Bind environment and UUID parameters via trusted administration tooling.
CREATE SCHEMA sec_admin;
CREATE TABLE sec_admin.database_identity (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  environment text NOT NULL CHECK (environment IN ('development','test','staging','production')),
  database_instance_id uuid NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON SCHEMA sec_admin FROM PUBLIC;
REVOKE ALL ON sec_admin.database_identity FROM PUBLIC;

INSERT INTO sec_admin.database_identity(environment,database_instance_id)
VALUES ('production','<LOCALLY_GENERATED_INSTANCE_UUID>'::uuid);
CREATE ROLE investment_dashboard_migrator LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '<GENERATE_MIGRATOR_PASSWORD_LOCALLY>';
CREATE ROLE investment_dashboard_runtime LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '<GENERATE_RUNTIME_PASSWORD_LOCALLY>';
REVOKE ALL ON DATABASE neondb FROM PUBLIC;
GRANT CONNECT ON DATABASE neondb TO investment_dashboard_migrator,investment_dashboard_runtime;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
CREATE SCHEMA sec_app AUTHORIZATION investment_dashboard_migrator;
REVOKE ALL ON SCHEMA sec_app FROM PUBLIC;
GRANT USAGE ON SCHEMA sec_app TO investment_dashboard_runtime;
GRANT USAGE ON SCHEMA sec_admin TO investment_dashboard_migrator,investment_dashboard_runtime;
GRANT SELECT ON sec_admin.database_identity TO investment_dashboard_migrator,investment_dashboard_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE investment_dashboard_migrator REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE investment_dashboard_migrator REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE investment_dashboard_migrator REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
CREATE TABLE sec_admin.bootstrap_history (
  version integer PRIMARY KEY CHECK (version=2),
  template_sha256 text NOT NULL CHECK (template_sha256 ~ '^[a-f0-9]{64}$'),
  status text NOT NULL CHECK (status='COMPLETE'),
  completed_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON sec_admin.bootstrap_history FROM PUBLIC;
INSERT INTO sec_admin.bootstrap_history(version,template_sha256,status)
VALUES (2,'<BOOTSTRAP_TEMPLATE_SHA256>','COMPLETE');
COMMIT;
