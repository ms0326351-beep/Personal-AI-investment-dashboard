-- Admin-controlled identity. Bootstrap separately, never from test harness.
-- Bind environment and UUID parameters via trusted administration tooling.
CREATE SCHEMA IF NOT EXISTS sec_admin;
CREATE TABLE IF NOT EXISTS sec_admin.database_identity (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  environment text NOT NULL CHECK (environment IN ('development','test','staging','production')),
  database_instance_id uuid NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON SCHEMA sec_admin FROM PUBLIC;
REVOKE ALL ON sec_admin.database_identity FROM PUBLIC;
