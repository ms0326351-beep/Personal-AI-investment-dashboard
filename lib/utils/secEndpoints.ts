import { SecTransportError, type SecForm4Metadata } from '../types/secTransport';
import { validFilingDate } from './publicFilingValidation';

export function normalizeSecCik(value: unknown): string {
  const text = typeof value === 'number' && Number.isSafeInteger(value) ? String(value)
    : typeof value === 'string' ? value.trim() : '';
  if (!/^\d{1,10}$/.test(text) || !/[1-9]/.test(text)) throw new SecTransportError('INVALID_CIK');
  return text.padStart(10, '0');
}
export function secAccessionPath(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{10}-\d{2}-\d{6}$/.test(value)) throw new SecTransportError('INVALID_ACCESSION');
  return value.replaceAll('-', '');
}
export function secFilingKey(accession: string): string {
  secAccessionPath(accession);
  return `sec:${accession}`;
}
export function secPrimaryDocument(value: unknown): string {
  if (typeof value !== 'string' || !/^(?:xslF345X\d{2}\/)?[A-Za-z0-9][A-Za-z0-9._-]{0,199}\.xml$/.test(value) || value.includes('..')) {
    throw new SecTransportError('INVALID_DOCUMENT');
  }
  return value;
}
export function secSubmissionsUrl(cik: unknown): string {
  return `https://data.sec.gov/submissions/CIK${normalizeSecCik(cik)}.json`;
}
export function secDocumentUrl(input: Pick<SecForm4Metadata, 'cik' | 'accessionNumber' | 'primaryDocument'>): string {
  return `${secAccessionDirectoryUrl(input.cik, input.accessionNumber)}${secPrimaryDocument(input.primaryDocument)}`;
}
export function secAccessionDirectoryUrl(cik: unknown, accessionNumber: unknown): string {
  return `https://www.sec.gov/Archives/edgar/data/${Number(normalizeSecCik(cik))}/${secAccessionPath(accessionNumber)}/`;
}
export function validateSecMetadata(input: SecForm4Metadata): SecForm4Metadata {
  if (!input || typeof input !== 'object') throw new SecTransportError('INVALID_DOCUMENT');
  const cik = normalizeSecCik(input.cik);
  secAccessionPath(input.accessionNumber);
  const primaryDocument = secPrimaryDocument(input.primaryDocument);
  if (!['4','4/A'].includes(input.formType) || !validFilingDate(input.filingDate) || input.filingDate.length !== 10) {
    throw new SecTransportError('INVALID_DOCUMENT');
  }
  return { cik, accessionNumber: input.accessionNumber, primaryDocument, formType: input.formType, filingDate: input.filingDate };
}
