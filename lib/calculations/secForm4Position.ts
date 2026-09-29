import type { Form4NormalizedTransactionType, Form4PositionRow, Form4ValueBasis, Form4XmlResult } from '../types/secForm4Parser';

/** SEC Form 4 General Instructions 8. No sentiment, intent or market-venue inference.
 * https://www.sec.gov/about/forms/form4.pdf
 * A includes grants/awards/other acquisitions; M includes exercise OR conversion.
 * Compound codes (e.g. P/K) remain UNKNOWN for this initial implementation.
 */
export function normalizeForm4TransactionCode(code: string | null): Form4NormalizedTransactionType {
  switch (code) {
    case 'P': return 'PURCHASE';
    case 'S': return 'SALE';
    case 'A': return 'GRANT_AWARD_OR_ACQUISITION';
    case 'M': return 'EXERCISE_OR_CONVERSION';
    case 'C': return 'CONVERSION';
    case 'O': case 'X': return 'EXERCISE';
    case 'F': return 'EXERCISE_PRICE_OR_TAX_PAYMENT';
    case 'G': return 'GIFT';
    case 'V': case 'D': case 'I': case 'E': case 'H': case 'L': case 'W': case 'Z': case 'J': case 'K': case 'U': return 'OTHER';
    default: return 'UNKNOWN';
  }
}

function decimalProduct(a: string, b: string): string {
  const scale = (a.split('.')[1]?.length ?? 0) + (b.split('.')[1]?.length ?? 0);
  const digits = (BigInt(a.replace('.','')) * BigInt(b.replace('.',''))).toString().padStart(scale + 1,'0');
  return scale ? `${digits.slice(0,-scale)}.${digits.slice(-scale)}`.replace(/\.?0+$/, '') : digits;
}

/** Row-level source observations only: no position delta, cost basis, owner allocation or netting.
 * Reporting roles remain filing-level; amendment rows never overwrite an earlier filing.
 */
export function analyzeForm4Positions(parsed: Form4XmlResult, valueBases: readonly Form4ValueBasis[] = []) {
  const source = parsed.source;
  const rows: Form4PositionRow[] = (source?.transactions ?? []).map(row => {
    const normalizedType = normalizeForm4TransactionCode(row.transactionCode);
    const issues: string[] = [];
    const semantics = parsed.transactionSemantics?.[row.rawSourceId];
    const equitySwapInvolved = semantics?.equitySwapInvolved ?? null;
    let action: Form4PositionRow['action'] = normalizedType === 'UNKNOWN' ? 'UNKNOWN' : 'OTHER';
    const ordinary = row.security.category === 'non_derivative';
    if (normalizedType === 'PURCHASE' || normalizedType === 'SALE') {
      const expected = normalizedType === 'PURCHASE' ? 'A' : 'D';
      if (!ordinary || row.acquisitionDisposition !== expected) {
        action = 'UNKNOWN'; issues.push('unconfirmed_transaction_direction_or_category');
      } else if (equitySwapInvolved !== false) {
        action = 'UNKNOWN'; issues.push(equitySwapInvolved === true ? 'equity_swap_qualified' : 'equity_swap_unknown');
      } else action = normalizedType === 'PURCHASE' ? 'BUY' : 'SELL';
    }
    if (normalizedType === 'UNKNOWN') issues.push('unsupported_transaction_code');
    if (row.ownerAttribution.status === 'unknown') issues.push('row_owner_unresolved');
    const locator = row.evidence[0]?.locator;
    const sharesText = locator ? parsed.rawFields[`${locator}/transactionAmounts/transactionShares/value`] : null;
    const priceText = locator ? parsed.rawFields[`${locator}/transactionAmounts/transactionPricePerShare/value`] : null;
    // This stage does not interpret footnote prose, which may qualify units or consideration.
    const qualifiedAmount = semantics?.hasFootnote !== false || row.footnoteReferences.length > 0;
    const matchingBases = valueBases.filter(b => b.filingId === source!.filingId &&
      b.sourceIdentifier === source!.provenance.sourceIdentifier && b.rawSourceId === row.rawSourceId);
    const valueBasis = matchingBases.length === 1 ? matchingBases[0] : null;
    const reliableBasis = valueBasis?.verified === true && valueBasis.securityKind === 'share_based_equity' &&
      valueBasis.quantityUnit === 'shares' && valueBasis.priceUnit === 'per_share' &&
      valueBasis.evidence.length > 0 && valueBasis.evidence.every(e => e.id.trim() && e.excerpt.trim() && e.locator?.trim());
    if (!reliableBasis) issues.push('quantity_or_price_basis_unconfirmed');
    let transactionValue: Form4PositionRow['transactionValue'] = null;
    if (reliableBasis && (action === 'BUY' || action === 'SELL') && row.shares !== null && row.price !== null && sharesText && priceText &&
      /^\d+(?:\.\d+)?$/.test(sharesText) && /^\d+(?:\.\d+)?$/.test(priceText) && !qualifiedAmount) {
      transactionValue = { amount: decimalProduct(sharesText,priceText), currency: row.currency, basis: 'shares_times_reported_price', quality: 'calculated', basisEvidence: structuredClone(valueBasis!.evidence) };
    } else issues.push('transaction_value_unavailable');
    return { rawSourceId: row.rawSourceId, transactionCode: row.transactionCode, normalizedType, action, marketVenue: 'unknown', equitySwapInvolved,
      shares: row.shares, price: row.price, transactionDate: row.transactionDate, holdingsAfter: row.ownershipAfter,
      ownershipType: row.ownershipType, ownershipNature: row.ownershipNature, transactionValue,
      ownerAttribution: structuredClone(row.ownerAttribution), evidence: structuredClone(row.evidence), issues };
  });
  return {
    status: parsed.status, coverage: 'UNKNOWN' as const,
    // Successfully parsing XML does not verify provenance, identity or completeness of holdings.
    filingId: source?.filingId ?? null, filingType: source?.filingType ?? null,
    amendment: source ? structuredClone(source.amendment) : null,
    reportingOwners: source ? structuredClone(source.reportingOwners) : [],
    rows, issues: structuredClone(parsed.issues), unsupported: { ...parsed.unsupported },
  };
}
