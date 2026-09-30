export type SecErrorCode = 'CONFIG_ERROR' | 'INVALID_CIK' | 'INVALID_ACCESSION' |
  'INVALID_DOCUMENT' | 'RATE_LIMITED' | 'TIMEOUT' | 'NETWORK_ERROR' | 'SEC_4XX' |
  'SEC_5XX' | 'INVALID_RESPONSE' | 'PARSE_ERROR' | 'OWNERSHIP_DOCUMENT_NOT_FOUND' |
  'AMBIGUOUS_OWNERSHIP_DOCUMENT' | 'RESOLUTION_LIMIT_EXCEEDED';

/** Safe to report: never includes headers, response bodies, contact or fetch causes. */
export class SecTransportError extends Error {
  constructor(public readonly code: SecErrorCode, public readonly status: number | null = null,
    public readonly attempts = 0, public readonly retryAfterMs: number | null = null) {
    super(`SEC transport: ${code}`);
    this.name = 'SecTransportError';
  }
}

export interface SecForm4Metadata {
  /** Archive/submissions CIK, not necessarily the issuer or reporting owner's CIK. */
  cik: string;
  accessionNumber: string;
  primaryDocument: string;
  formType: '4' | '4/A';
  filingDate: string;
}
export interface SecSubmissionsEnvelope {
  source: 'SEC';
  cik: string;
  sourceUrl: string;
  retrievedAt: string;
  scope: 'recent_only';
  historicalFilesAvailable: boolean;
  filings: SecForm4Metadata[];
}
export interface SecXmlEnvelope extends SecForm4Metadata {
  source: 'SEC';
  filingKey: string;
  sourceUrl: string;
  retrievedAt: string;
  rawXml: string;
}
export interface SecResolvedXmlEnvelope extends SecXmlEnvelope {
  presentationUrl: string;
  indexUrl: string;
  resolvedDocument: string;
  resolutionMethod: 'index_primary_basename' | 'index_unique_ownership';
}
