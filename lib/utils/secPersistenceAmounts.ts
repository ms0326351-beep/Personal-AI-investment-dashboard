import type { Form4Transaction } from '../types/secForm4';
import type { Form4XmlResult } from '../types/secForm4Parser';
import type { SecPersistenceAmounts } from '../types/secPersistence';

/** Exact lexeme validation only: no Number(), arithmetic, unit inference or
 * conversion of previously rounded JS values. Missing/ambiguous stays null.
 */
export function secPersistenceAmounts(parsed: Form4XmlResult, row: Form4Transaction): SecPersistenceAmounts {
  const locator = row.evidence[0]?.locator;
  const read = (path: string): string | null => {
    const text = locator ? parsed.rawFields[`${locator}/${path}`] : null;
    return typeof text === 'string' && /^\d+(?:\.\d+)?$/.test(text) ? text : null;
  };
  return {
    shares: read('transactionAmounts/transactionShares/value'),
    price: read('transactionAmounts/transactionPricePerShare/value'),
    ownershipAfter: read('postTransactionAmounts/sharesOwnedFollowingTransaction/value'),
    transactionValue: null,
  };
}
