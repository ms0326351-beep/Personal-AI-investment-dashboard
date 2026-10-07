-- Specification template only. Not a bootstrap script; never auto-executed.
-- Identifiers sec_app/sec_runtime/sec_migrator are placeholders for reviewed roles.
-- Bootstrap must ensure runtime has NO owner/migrator/neon_superuser membership,
-- NOCREATEROLE NOCREATEDB and no CREATE/TEMP privilege inherited from PUBLIC.
-- sec_schema_owner is NOLOGIN; only migrator may SET ROLE to it.
ALTER ROLE sec_runtime NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
REVOKE ALL ON SCHEMA sec_app FROM PUBLIC;
REVOKE CREATE ON SCHEMA sec_app FROM sec_runtime;
GRANT USAGE ON SCHEMA sec_app TO sec_runtime;
GRANT SELECT ON sec_app.sec_schema_versions,sec_app.sec_migration_history TO sec_runtime;
GRANT SELECT,INSERT,UPDATE ON sec_app.sec_filings TO sec_runtime;
-- Failed-record retry currently deletes child rows inside the filing transaction.
GRANT SELECT,INSERT,DELETE ON sec_app.sec_transactions TO sec_runtime;
GRANT SELECT,INSERT ON sec_app.sec_ingestion_attempts TO sec_runtime;
GRANT USAGE ON SEQUENCE sec_app.sec_ingestion_attempts_id_seq TO sec_runtime;
GRANT USAGE ON SCHEMA sec_admin TO sec_runtime;
GRANT SELECT ON sec_admin.database_identity TO sec_runtime;
-- Do not grant schema ownership, CREATE EXTENSION, TRUNCATE or broad GRANT ALL.
-- Migrator owns/manages objects via sec_schema_owner; runtime never inherits it.
