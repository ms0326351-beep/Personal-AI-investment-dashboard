import type { DataStatus } from './exposure';
import type { FilingDocument, FilingIdentity, FilingRow } from './publicFilings';
import type { Provenance } from './publicIntelligence';

/** Stage 1 source contract only. No transport, XML parser or activity classification. */
export interface Form4Owner {
  /** Document-local reference, not a global person ID. */
  reference: string;
  identity: FilingIdentity;
  relationship: {
    director: boolean | null;
    officer: boolean | null;
    tenPercentOwner: boolean | null;
    other: boolean | null;
    officerTitle: string | null;
    otherText: string | null;
    evidence: Provenance['evidence'];
  };
}
export interface Form4Transaction extends Pick<FilingRow,
  'rawSourceId' | 'transactionDate' | 'transactionCode' | 'shares' | 'price' |
  'currency' | 'ownershipAfter' | 'ownershipType' | 'ownershipNature' | 'evidence'> {
  security: {
    /** Issuer CIK is not a security identifier. Missing CUSIP/ISIN is allowed. */
    identity: FilingIdentity;
    title: string | null;
    category: 'derivative' | 'non_derivative' | 'unknown';
  };
  acquisitionDisposition: 'A' | 'D' | 'unknown';
  /** Only explicitly evidenced row attribution. Never distribute a joint filing's shares. */
  ownerAttribution: {
    references: string[];
    status: 'reported' | 'unknown';
    evidence: Provenance['evidence'];
  };
  footnoteReferences: { field: string; ids: string[] }[];
}
export interface Form4Source {
  schemaVersion: 'form4-source-v1';
  form: 'FORM4';
  filingType: '4' | '4/A';
  filingId: string;
  accessionNumber: string | null;
  dates: FilingDocument['dates'];
  issuer: FilingIdentity;
  /** Reported issuer symbol, not necessarily the transacted security's symbol. */
  issuerTicker: string | null;
  filers: FilingIdentity[];
  reportingOwners: Form4Owner[];
  transactions: Form4Transaction[];
  amendment: FilingDocument['amendment'];
  footnotes: { id: string; text: string }[];
  provenance: {
    sourceAuthority: 'SEC';
    sourceIdentifier: string;
    sourceUrl: string | null;
    filingUrl: string | null;
    origin: 'public' | 'mock';
    parserVersion: string | null;
    evidence: Provenance['evidence'];
  };
  /** Declared upstream status can only lower the assessed completeness. */
  parseStatus: DataStatus;
  normalizationStatus: DataStatus;
}
export interface Form4Assessment {
  coverage: DataStatus;
  issues: string[];
  rows: { rawSourceId: string; coverage: DataStatus; issues: string[] }[];
}
