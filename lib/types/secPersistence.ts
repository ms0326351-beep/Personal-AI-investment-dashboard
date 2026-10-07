/** Exact non-negative decimal text. PostgreSQL adapters MUST bind as text to
 * unconstrained NUMERIC/DECIMAL (or reject out-of-range precision), never float.
 * Source-qualified amounts remain observations, not definitive monetary value.
 */
export interface SecPersistenceAmounts {
  shares: string | null;
  price: string | null;
  ownershipAfter: string | null;
  transactionValue: null;
}

/** Future retention seam only. No implementation, writes or offline claims today.
 * Content must match rawXmlHash over decoded XML UTF-8 before use.
 */
export interface SecRawXmlReference {
  accessionNumber: string;
  rawXmlHash: string;
  hashBasis: 'decoded_xml_utf8';
  rawXmlUrl: string;
  retrievedAt: string;
}
export interface SecRawXmlRetention {
  getRetainedXml(reference: SecRawXmlReference): Promise<string | null>;
}
