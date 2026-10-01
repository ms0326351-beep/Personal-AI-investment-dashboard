import 'server-only';
import { createHash } from 'node:crypto';
import type { SecIngestionFailure, SecIngestionProvenance, SecIngestionRecord, SecIngestionRepository, SecIngestionResult, SecIngestionSaveResult } from '../types/secIngestion';
import { SecRepositoryWriteError, type SecIngestionAudit } from '../types/secIngestion';
import { SecTransportError, type SecForm4Metadata, type SecResolvedXmlEnvelope } from '../types/secTransport';
import { secAccessionDirectoryUrl, secDocumentUrl, secFilingKey, validateSecMetadata } from '../utils/secEndpoints';
import { parseForm4Xml, SEC_FORM4_PARSER_VERSION } from '../utils/secForm4Parser';
import { secPersistenceAmounts } from '../utils/secPersistenceAmounts';
import { isIngested } from './secIngestionRepository';

/** Compatible with createSecClient(); no default client, env access or network side effects. */
export interface SecIngestionTransport {
  fetchResolvedForm4Document(metadata: SecForm4Metadata): Promise<SecResolvedXmlEnvelope>;
}
export const hashSecRawXml = (xml: string): string => createHash('sha256').update(xml,'utf8').digest('hex');

function result(outcome: SecIngestionSaveResult['outcome'], record: SecIngestionRecord): SecIngestionResult {
  return { accessionNumber:record.accessionNumber,status:outcome,created:outcome==='CREATED',existing:isIngested(record)&&outcome!=='CREATED',
    state:record.state,persistenceOutcome:'CONFIRMED',auditStatus:'NOT_CONFIGURED',parserStatus:record.parsed?.status??null,transactionCount:record.transactions.length,
    warnings:[...new Set([...(record.parsed?.issues.map(i=>i.code)??[]),
      ...(outcome.endsWith('CONFLICT')?[outcome]:[])])],provenance:record.provenance,failure:record.failure };
}
function transportFailure(error: unknown): SecIngestionFailure {
  if (!(error instanceof SecTransportError)) return {category:'TRANSPORT',code:'UNEXPECTED_TRANSPORT_ERROR',retryable:false};
  const resolution=['OWNERSHIP_DOCUMENT_NOT_FOUND','AMBIGUOUS_OWNERSHIP_DOCUMENT','RESOLUTION_LIMIT_EXCEEDED','INVALID_RESPONSE'];
  return { category:resolution.includes(error.code)?'RESOLUTION':'TRANSPORT',code:error.code,
    retryable:['TIMEOUT','NETWORK_ERROR','RATE_LIMITED','SEC_5XX'].includes(error.code) };
}

/** One explicit invocation = one attempt. Revalidation is opt-in, never scheduled.
 * Normal repeated calls do not fetch. Revalidate to observe unexpected content changes.
 * Cross-service/process correctness relies on repository atomicity, not a local promise map.
 */
export function createSecIngestionService(repository: SecIngestionRepository, transport: SecIngestionTransport,
  dependencies: { audit?: SecIngestionAudit; now?: () => string } = {}) {
  return {
    async ingestForm4Filing(input: SecForm4Metadata, options: { revalidate?: boolean } = {}): Promise<SecIngestionResult> {
      // Strict canonical accession format is shared with transport; reject before repository/network.
      const metadata = validateSecMetadata(input), filingKey = secFilingKey(metadata.accessionNumber);
      const attemptedAt = (dependencies.now ?? (() => new Date().toISOString()))();
      const record: SecIngestionRecord = { schemaVersion:'sec-ingestion-v1',filingKey,accessionNumber:metadata.accessionNumber,metadata,
        state:'FAILED',steps:['PENDING'],provenance:null,parsed:null,transactions:[],failure:null,
        amendment:{isAmendment:metadata.formType==='4/A',amendsAccessionNumber:null,
          lineageStatus:metadata.formType==='4/A'?'unknown':'not_applicable'} };
      const storageFailure = (error?: unknown, duringSave = false): Promise<SecIngestionResult> => {
        record.state='FAILED';record.transactions=[];record.failure={category:'REPOSITORY',code:'REPOSITORY_UNAVAILABLE',retryable:true};
        if (record.steps.at(-1)!=='FAILED') record.steps.push('FAILED');
        const response = result('FAILED',record);
        response.persistenceOutcome='NOT_COMMITTED';
        if (duringSave && (!(error instanceof SecRepositoryWriteError) || error.commitOutcome==='UNKNOWN')) {
          response.status='ACKNOWLEDGEMENT_UNKNOWN';response.state='UNKNOWN';response.transactionCount=null;
          response.persistenceOutcome='UNKNOWN';response.failure!.code='ACKNOWLEDGEMENT_UNKNOWN';
        }
        return finish(response);
      };
      async function finish(response: SecIngestionResult): Promise<SecIngestionResult> {
        if (!dependencies.audit) return response;
        try {
          await dependencies.audit.recordAttempt({accessionNumber:metadata.accessionNumber,attemptedAt,
            operation:options.revalidate?'REVALIDATE':'INGEST',outcome:response.status,persistenceOutcome:response.persistenceOutcome,
            failure:response.failure?{...response.failure}:null,retryable:response.failure?.retryable??false,
            parserStatus:record.parsed?.status??response.parserStatus,rawXmlHash:record.provenance?.rawXmlHash??null,
            existingRawXmlHash:(response.existing||response.status.endsWith('CONFLICT'))?response.provenance?.rawXmlHash??null:previous?.provenance?.rawXmlHash??null,
            parserVersion:record.provenance?.parserVersion??response.provenance?.parserVersion??null,
            metadata:{...metadata},warnings:[...response.warnings]});
          response.auditStatus='RECORDED';
        } catch { response.auditStatus='UNAVAILABLE';response.warnings.push('AUDIT_UNAVAILABLE'); }
        return response;
      }
      let previous: SecIngestionRecord | null;
      try { previous = await repository.getFilingByAccession(metadata.accessionNumber); }
      catch { return storageFailure(); }
      if (previous && (previous.metadata.formType!==metadata.formType || previous.metadata.filingDate!==metadata.filingDate || previous.metadata.cik!==metadata.cik || previous.metadata.primaryDocument!==metadata.primaryDocument)) {
        return finish(result('METADATA_CONFLICT',previous));
      }
      if (previous && isIngested(previous)) {
        if (!options.revalidate) return finish(result('ALREADY_EXISTS',previous));
      }
      let envelope: SecResolvedXmlEnvelope;
      try { envelope = await transport.fetchResolvedForm4Document(metadata); }
      catch(error) { record.failure=transportFailure(error); return saveFailure(); }

      // Pick provenance fields explicitly; never spread transport configuration or unknown properties.
      const directory=secAccessionDirectoryUrl(metadata.cik,metadata.accessionNumber);
      if (envelope.accessionNumber!==metadata.accessionNumber || envelope.formType!==metadata.formType ||
        envelope.filingDate!==metadata.filingDate || envelope.primaryDocument!==metadata.primaryDocument ||
        envelope.cik!==metadata.cik || envelope.filingKey!==filingKey || envelope.source!=='SEC' ||
        !/^[A-Za-z0-9][A-Za-z0-9._-]*\.xml$/.test(envelope.resolvedDocument) || envelope.resolvedDocument.includes('..') ||
        envelope.sourceUrl!==directory+envelope.resolvedDocument || envelope.indexUrl!==directory+'index.json' ||
        envelope.presentationUrl!==secDocumentUrl(metadata) || !Number.isFinite(Date.parse(envelope.retrievedAt)) ||
        !['index_primary_basename','index_unique_ownership'].includes(envelope.resolutionMethod) || typeof envelope.rawXml!=='string') {
        record.failure={category:'RESOLUTION',code:'ENVELOPE_MISMATCH',retryable:false}; return saveFailure();
      }
      record.steps.push('FETCHED');
      const provenance: SecIngestionProvenance = { ...metadata,source:'SEC',filingKey,
        sourceUrl:envelope.sourceUrl,presentationUrl:envelope.presentationUrl,indexUrl:envelope.indexUrl,
        resolvedDocument:envelope.resolvedDocument,resolutionMethod:envelope.resolutionMethod,retrievedAt:envelope.retrievedAt,
        rawXmlHash:hashSecRawXml(envelope.rawXml),hashAlgorithm:'sha256',hashBasis:'decoded_xml_utf8',parserVersion:null,parserSchemaVersion:null };
      record.provenance=provenance;
      if (previous?.provenance && previous.provenance.rawXmlHash!==provenance.rawXmlHash) return finish(result('INTEGRITY_CONFLICT',previous));
      provenance.parserVersion=SEC_FORM4_PARSER_VERSION;
      const parsed = parseForm4Xml(envelope.rawXml,{filingId:metadata.accessionNumber,accessionNumber:metadata.accessionNumber,
        sourceIdentifier:envelope.sourceUrl,sourceUrl:envelope.sourceUrl,filingUrl:envelope.sourceUrl,
        retrievedAt:envelope.retrievedAt,filedAt:metadata.filingDate,origin:'public'});
      record.parsed=parsed;
      provenance.parserVersion=parsed.source?.provenance.parserVersion??SEC_FORM4_PARSER_VERSION;
      provenance.parserSchemaVersion=parsed.source?.schemaVersion??null;
      if (parsed.status==='unavailable' || !parsed.source || parsed.source.filingType!==metadata.formType) {
        record.failure={category:'PARSER',code:'PARSE_ERROR',retryable:false}; return saveFailure();
      }
      record.state=parsed.status==='partial'?'PARTIAL':'PARSED';record.steps.push(record.state);
      record.transactions=parsed.source.transactions.map((data,i)=>({id:`${filingKey}:non_derivative:${i+1}`,
        accessionNumber:metadata.accessionNumber,table:'non_derivative',rowIndex:i+1,data,persistenceAmounts:secPersistenceAmounts(parsed,data)}));
      try { const saved=await repository.saveIngestion(record);return finish(result(saved.outcome,saved.record)); }
      catch(error) { return storageFailure(error,true); }

      async function saveFailure(): Promise<SecIngestionResult> {
        record.steps.push('FAILED');
        // A failed explicit revalidation must be visible to its caller, without erasing stored success.
        if (previous && isIngested(previous)) return finish({...result('FAILED',record),persistenceOutcome:'NOT_COMMITTED'});
        try { const saved=await repository.saveIngestion(record);return finish(result(saved.outcome,saved.record)); }
        catch(error) { return storageFailure(error,true); }
      }
    },
  };
}
