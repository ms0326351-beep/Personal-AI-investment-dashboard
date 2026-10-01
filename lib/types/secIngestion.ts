import type { Form4Transaction } from './secForm4';
import type { Form4XmlResult } from './secForm4Parser';
import type { SecForm4Metadata, SecResolvedXmlEnvelope } from './secTransport';
import type { SecPersistenceAmounts } from './secPersistence';

export type SecIngestionState = 'PARSED' | 'PARTIAL' | 'FAILED';
export type SecIngestionStep = 'PENDING' | 'FETCHED' | SecIngestionState;
export interface SecIngestionFailure {
  category: 'VALIDATION' | 'TRANSPORT' | 'RESOLUTION' | 'PARSER' | 'REPOSITORY';
  code: string;
  retryable: boolean;
}
export interface SecIngestionProvenance extends Omit<SecResolvedXmlEnvelope, 'rawXml'> {
  rawXmlHash: string;
  hashAlgorithm: 'sha256';
  /** Hash of the exact decoded XML string encoded as UTF-8, not compressed HTTP bytes. */
  hashBasis: 'decoded_xml_utf8';
  parserVersion: string | null;
  parserSchemaVersion: string | null;
}
export interface SecIngestedTransaction {
  id: string;
  accessionNumber: string;
  table: 'non_derivative';
  rowIndex: number;
  data: Form4Transaction;
  /** Exact source decimal text, never reconstructed from JS numbers. */
  persistenceAmounts: SecPersistenceAmounts;
}
export interface SecIngestionRecord {
  schemaVersion: 'sec-ingestion-v1';
  filingKey: string;
  accessionNumber: string;
  metadata: SecForm4Metadata;
  state: SecIngestionState;
  steps: SecIngestionStep[];
  provenance: SecIngestionProvenance | null;
  parsed: Form4XmlResult | null;
  transactions: SecIngestedTransaction[];
  amendment: { isAmendment: boolean; amendsAccessionNumber: null; lineageStatus: 'unknown' | 'not_applicable' };
  failure: SecIngestionFailure | null;
}
export interface SecIngestionSaveResult {
  outcome: 'CREATED' | 'ALREADY_EXISTS' | 'FAILED' | 'INTEGRITY_CONFLICT' | 'METADATA_CONFLICT';
  record: SecIngestionRecord;
}
/** Persistent adapters MUST implement atomic compare-and-insert by accession across workers.
 * Successful records are immutable; a failed attempt cannot replace a successful record.
 * A thrown save must not expose a partial record. No individual transaction inserts.
 * A thrown save MAY have committed the complete record: never assume rollback.
 * DB UNIQUE(accession) and UNIQUE(filing, table, ordinal), plus one transaction,
 * are required across connections. Expected uniqueness races return domain outcomes.
 * PARSED/PARTIAL are immutable under ordinary ingestion, including new parser versions.
 * Reprocessing is a separate future operation, not a saveIngestion option.
 */
export interface SecIngestionRepository {
  getFilingByAccession(accessionNumber: string): Promise<SecIngestionRecord | null>;
  saveIngestion(record: SecIngestionRecord): Promise<SecIngestionSaveResult>;
}
export interface SecIngestionResult {
  accessionNumber: string;
  status: SecIngestionSaveResult['outcome'] | 'ACKNOWLEDGEMENT_UNKNOWN';
  created: boolean;
  existing: boolean;
  state: SecIngestionState | 'UNKNOWN';
  /** UNKNOWN is an operation outcome, never a persisted filing state. */
  persistenceOutcome: 'CONFIRMED' | 'NOT_COMMITTED' | 'UNKNOWN';
  auditStatus: 'NOT_CONFIGURED' | 'RECORDED' | 'UNAVAILABLE';
  parserStatus: Form4XmlResult['status'] | null;
  transactionCount: number | null;
  warnings: string[];
  provenance: SecIngestionProvenance | null;
  failure: SecIngestionFailure | null;
}

/** Adapters may assert NOT_COMMITTED only after a confirmed rollback/no write.
 * Unknown errors during save are conservatively treated as UNKNOWN by the service.
 * No upstream exception message/configuration is copied into the domain result.
 */
export class SecRepositoryWriteError extends Error {
  constructor(readonly commitOutcome: 'NOT_COMMITTED' | 'UNKNOWN') {
    super(commitOutcome === 'UNKNOWN' ? 'ACKNOWLEDGEMENT_UNKNOWN' : 'REPOSITORY_UNAVAILABLE');
    this.name = 'SecRepositoryWriteError';
  }
}

export interface SecIngestionAttempt {
  accessionNumber: string;
  attemptedAt: string;
  operation: 'INGEST' | 'REVALIDATE';
  outcome: SecIngestionResult['status'];
  persistenceOutcome: SecIngestionResult['persistenceOutcome'];
  failure: SecIngestionFailure | null;
  retryable: boolean;
  parserStatus: SecIngestionResult['parserStatus'];
  rawXmlHash: string | null;
  existingRawXmlHash: string | null;
  parserVersion: string | null;
  metadata: SecForm4Metadata;
  warnings: string[];
}
/** One call records one logical attempt. Failure is observable via auditStatus;
 * it must never turn a committed filing into FAILED. No unfiltered error text.
 * Persistent implementation owns attempt IDs and its own atomic append policy.
 */
export interface SecIngestionAudit {
  recordAttempt(attempt: SecIngestionAttempt): Promise<void>;
}
