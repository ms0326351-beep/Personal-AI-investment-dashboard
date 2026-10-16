import 'server-only';
import type { SecIngestionRecord, SecIngestionRepository, SecIngestionSaveResult } from '../types/secIngestion';
import { secFilingKey, validateSecMetadata } from '../utils/secEndpoints';
import { secPersistenceAmounts } from '../utils/secPersistenceAmounts';

export const isIngested = (record: SecIngestionRecord): boolean => record.state === 'PARSED' || record.state === 'PARTIAL';

/** Shared domain validation, independent of storage implementation. */
export function validateSecIngestionSnapshot(input: SecIngestionRecord): SecIngestionRecord {
    const record = structuredClone(input);
    const key = secFilingKey(record.accessionNumber);
    validateSecMetadata(record.metadata);
    if (!['PARSED','PARTIAL','FAILED'].includes(record.state) || record.filingKey !== key || record.metadata.accessionNumber !== record.accessionNumber ||
      (record.state === 'FAILED' && (record.transactions.length !== 0 || !record.failure)) ||
      (isIngested(record) && (!record.provenance || !record.parsed?.source || record.failure ||
        record.parsed.status !== (record.state === 'PARTIAL' ? 'partial' : 'parsed') ||
        record.transactions.length !== record.parsed.source.transactions.length ||
        record.parsed.source.accessionNumber !== record.accessionNumber || record.provenance.accessionNumber !== record.accessionNumber ||
        !record.provenance.parserVersion?.trim() || !record.provenance.parserSchemaVersion?.trim() ||
        record.provenance.parserVersion !== record.parsed.source.provenance.parserVersion ||
        record.provenance.parserSchemaVersion !== record.parsed.source.schemaVersion ||
        !/^[a-f0-9]{64}$/.test(record.provenance.rawXmlHash)))) throw new Error('Invalid ingestion snapshot');
    for (const [i, row] of record.transactions.entries()) {
      if (row.id !== `${key}:non_derivative:${i+1}` || row.accessionNumber !== record.accessionNumber ||
        row.table !== 'non_derivative' || row.rowIndex !== i+1 || row.data.rawSourceId !== `non-derivative-${i+1}`) throw new Error('Invalid transaction identity');
      const expected=secPersistenceAmounts(record.parsed!,row.data);
      if (!row.persistenceAmounts || row.persistenceAmounts.shares!==expected.shares ||
        row.persistenceAmounts.price!==expected.price || row.persistenceAmounts.ownershipAfter!==expected.ownershipAfter ||
        row.persistenceAmounts.transactionValue!==null) throw new Error('Invalid persistence decimal boundary');
    }
    return record;
}

/** Local/test storage only. One synchronous map replacement publishes the whole snapshot.
 * No mutable references escape the adapter, and no await separates comparison from insert.
 */
export class InMemorySecIngestionRepository implements SecIngestionRepository {
  private readonly records = new Map<string, SecIngestionRecord>();
  async getFilingByAccession(accessionNumber: string): Promise<SecIngestionRecord | null> {
    const record = this.records.get(secFilingKey(accessionNumber));
    return record ? structuredClone(record) : null;
  }
  async saveIngestion(input: SecIngestionRecord): Promise<SecIngestionSaveResult> {
    const record = validateSecIngestionSnapshot(input);
    const key = secFilingKey(record.accessionNumber);
    const previous = this.records.get(key);
    if (previous && (previous.metadata.formType!==record.metadata.formType || previous.metadata.filingDate!==record.metadata.filingDate ||
      previous.metadata.cik!==record.metadata.cik || previous.metadata.primaryDocument!==record.metadata.primaryDocument)) {
      return {outcome:'METADATA_CONFLICT',record:structuredClone(previous)};
    }
    // Even a failed parse establishes a content observation for this accession.
    if (previous?.provenance && record.provenance && previous.provenance.rawXmlHash !== record.provenance.rawXmlHash) {
      return {outcome:'INTEGRITY_CONFLICT',record:structuredClone(previous)};
    }
    if (previous && isIngested(previous)) {
      let outcome: SecIngestionSaveResult['outcome'] = 'ALREADY_EXISTS';
      if (record.provenance && previous.provenance?.rawXmlHash !== record.provenance.rawXmlHash) outcome = 'INTEGRITY_CONFLICT';
      else if (record.metadata.formType !== previous.metadata.formType || record.metadata.filingDate !== previous.metadata.filingDate) outcome = 'METADATA_CONFLICT';
      return {outcome,record:structuredClone(previous)};
    }
    if (previous?.provenance && !record.provenance) {
      record.provenance=structuredClone(previous.provenance);
      record.parsed=structuredClone(previous.parsed);
    }
    // Clone return value before publication too: failure cannot leave a half-successful write.
    const result: SecIngestionSaveResult = {outcome:record.state === 'FAILED' ? 'FAILED' : 'CREATED',record:structuredClone(record)};
    this.records.set(key,record);
    return result;
  }
}
