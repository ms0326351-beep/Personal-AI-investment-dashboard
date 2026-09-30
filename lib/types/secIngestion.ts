import type { Form4Transaction } from './secForm4';
import type { Form4XmlResult } from './secForm4Parser';
import type { SecForm4Metadata, SecResolvedXmlEnvelope } from './secTransport';

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
 */
export interface SecIngestionRepository {
  getFilingByAccession(accessionNumber: string): Promise<SecIngestionRecord | null>;
  saveIngestion(record: SecIngestionRecord): Promise<SecIngestionSaveResult>;
}
export interface SecIngestionResult {
  accessionNumber: string;
  status: SecIngestionSaveResult['outcome'];
  created: boolean;
  existing: boolean;
  state: SecIngestionState;
  parserStatus: Form4XmlResult['status'] | null;
  transactionCount: number;
  warnings: string[];
  provenance: SecIngestionProvenance | null;
  failure: SecIngestionFailure | null;
}
