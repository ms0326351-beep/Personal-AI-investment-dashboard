-- Production SEC ingestion v1. Immutable; execute only through the reviewed manifest.
-- sec_app is owned by investment_dashboard_migrator; identity is admin-bootstrapped separately.
CREATE TABLE sec_schema_versions (
  version integer PRIMARY KEY, installed_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sec_filings (
  accession_number text PRIMARY KEY CHECK (accession_number ~ '^[0-9]{10}-[0-9]{2}-[0-9]{6}$'),
  cik text NOT NULL CHECK (cik ~ '^[0-9]{10}$'),
  form_type text NOT NULL CHECK (form_type IN ('4','4/A')),
  filing_date date NOT NULL,
  is_amendment boolean NOT NULL,
  primary_document text NOT NULL,
  presentation_url text,
  accession_index_url text,
  raw_xml_url text,
  raw_xml_hash text CHECK (raw_xml_hash IS NULL OR raw_xml_hash ~ '^[a-f0-9]{64}$'),
  retrieved_at timestamptz,
  parser_status text NOT NULL CHECK (parser_status IN ('PARSED','PARTIAL','FAILED')),
  parser_version text,
  source text NOT NULL DEFAULT 'SEC' CHECK (source = 'SEC'),
  snapshot jsonb NOT NULL,
  amended_filing_accession text REFERENCES sec_filings(accession_number),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (is_amendment = (form_type = '4/A')),
  CHECK (parser_status = 'FAILED' OR (raw_xml_hash IS NOT NULL AND parser_version IS NOT NULL))
);
CREATE TABLE sec_transactions (
  filing_accession text NOT NULL REFERENCES sec_filings(accession_number),
  transaction_identity text NOT NULL,
  table_kind text NOT NULL CHECK (table_kind = 'non_derivative'),
  row_ordinal integer NOT NULL CHECK (row_ordinal > 0),
  shares numeric CHECK (shares IS NULL OR shares >= 0),
  price numeric CHECK (price IS NULL OR price >= 0),
  ownership_after numeric CHECK (ownership_after IS NULL OR ownership_after >= 0),
  transaction_value numeric CHECK (transaction_value IS NULL),
  row_data jsonb NOT NULL,
  PRIMARY KEY (filing_accession, transaction_identity),
  UNIQUE (filing_accession, table_kind, row_ordinal),
  CHECK (transaction_identity = 'sec:' || filing_accession || ':' || table_kind || ':' || row_ordinal::text)
);
CREATE TABLE sec_ingestion_attempts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  accession_number text NOT NULL CHECK (accession_number ~ '^[0-9]{10}-[0-9]{2}-[0-9]{6}$'),
  attempted_at timestamptz NOT NULL,
  outcome text NOT NULL,
  persistence_outcome text NOT NULL CHECK (persistence_outcome IN ('CONFIRMED','NOT_COMMITTED','UNKNOWN')),
  attempt jsonb NOT NULL
);
CREATE INDEX sec_attempt_accession_time ON sec_ingestion_attempts(accession_number, attempted_at);
INSERT INTO sec_schema_versions(version) VALUES (1) ON CONFLICT DO NOTHING;

GRANT SELECT, INSERT, UPDATE ON sec_filings TO investment_dashboard_runtime;
GRANT SELECT, INSERT, DELETE ON sec_transactions TO investment_dashboard_runtime;
GRANT SELECT, INSERT ON sec_ingestion_attempts TO investment_dashboard_runtime;
-- Identity-generated audit IDs require no sequence grants.
