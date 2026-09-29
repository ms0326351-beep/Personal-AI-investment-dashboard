import type { Form4ValueBasis, Form4XmlContext } from '../../types/secForm4Parser';

/** Synthetic fixture only. No actual filer, transaction, source URL or live endpoint. */
export const form4Context: Form4XmlContext = {
  filingId: 'fixture-form4-1', sourceIdentifier: 'synthetic-xml-1', retrievedAt: '2026-01-06T12:00:00Z',
  filedAt: '2026-01-05', origin: 'mock',
};
/** Separate synthetic unit evidence; not extracted from securityTitle or XML numeric tags. */
export const verifiedEquityBasis: Form4ValueBasis = {
  filingId: form4Context.filingId, sourceIdentifier: form4Context.sourceIdentifier,
  rawSourceId: 'non-derivative-1', securityKind: 'share_based_equity', quantityUnit: 'shares', priceUnit: 'per_share',
  verified: true, evidence: [{ id:'fixture-equity-unit-evidence', locator:'fixture:security-master/TEST/class-1',
    excerpt:'Synthetic verified record: this transaction quantity is equity shares, and price is per share.' }],
};
export function transactionXml({ code = 'P', direction = 'A', shares = '100', price = '12.50', ownership = 'D' } = {}) {
  return `<nonDerivativeTransaction>
    <securityTitle><value>Common Stock</value></securityTitle>
    <transactionDate><value>2026-01-02</value></transactionDate>
    <transactionCoding><transactionFormType>4</transactionFormType><transactionCode>${code}</transactionCode><equitySwapInvolved>0</equitySwapInvolved></transactionCoding>
    <transactionAmounts><transactionShares><value>${shares}</value></transactionShares>
      <transactionPricePerShare><value>${price}</value></transactionPricePerShare>
      <transactionAcquiredDisposedCode><value>${direction}</value></transactionAcquiredDisposedCode></transactionAmounts>
    <postTransactionAmounts><sharesOwnedFollowingTransaction><value>1100</value></sharesOwnedFollowingTransaction></postTransactionAmounts>
    <ownershipNature><directOrIndirectOwnership><value>${ownership}</value></directOrIndirectOwnership>
      ${ownership === 'I' ? '<natureOfOwnership><value>By Synthetic Trust</value></natureOfOwnership>' : ''}</ownershipNature>
  </nonDerivativeTransaction>`;
}
export function ownerXml(relationship = '<isDirector>1</isDirector><isOfficer>0</isOfficer><isTenPercentOwner>0</isTenPercentOwner><isOther>0</isOther>', cik = '0000000002') {
  return `<reportingOwner><reportingOwnerId><rptOwnerCik>${cik}</rptOwnerCik><rptOwnerName>Synthetic Owner</rptOwnerName></reportingOwnerId>
    <reportingOwnerRelationship>${relationship}</reportingOwnerRelationship></reportingOwner>`;
}
export function form4Xml({ transactions = transactionXml(), owners = ownerXml(), form = '4', extra = '' } = {}) {
  return `<?xml version="1.0" encoding="UTF-8"?>
  <ownershipDocument><schemaVersion>X0508</schemaVersion><documentType>${form}</documentType><periodOfReport>2026-01-02</periodOfReport>
    <issuer><issuerCik>0000000001</issuerCik><issuerName>Synthetic &amp; Company</issuerName><issuerTradingSymbol>TEST</issuerTradingSymbol></issuer>
    ${owners}<nonDerivativeTable>${transactions}</nonDerivativeTable>${extra}
    <ownerSignature><signatureName>Synthetic Signer</signatureName><signatureDate>2026-01-04</signatureDate></ownerSignature>
  </ownershipDocument>`;
}
export const form4Fixtures = {
  purchase: form4Xml(),
  sale: form4Xml({ transactions: transactionXml({ code:'S', direction:'D' }) }),
  multiple: form4Xml({ transactions: transactionXml() + transactionXml({ code:'S', direction:'D' }) }),
  officer: form4Xml({ owners: ownerXml('<isDirector>0</isDirector><isOfficer>true</isOfficer><isTenPercentOwner>0</isTenPercentOwner><isOther>0</isOther><officerTitle>Chief Financial Officer</officerTitle>') }),
  tenPercent: form4Xml({ owners: ownerXml('<isDirector>0</isDirector><isOfficer>0</isOfficer><isTenPercentOwner>1</isTenPercentOwner><isOther>0</isOther>') }),
  indirect: form4Xml({ transactions: transactionXml({ ownership:'I' }) }),
  missingPrice: form4Xml().replace('<transactionPricePerShare><value>12.50</value></transactionPricePerShare>',''),
  amendment: form4Xml({ form:'4/A', extra:'<dateOfOriginalSubmission>2026-01-03</dateOfOriginalSubmission>' }),
  award: form4Xml({ transactions: transactionXml({ code:'A',price:'0' }) }),
  joint: form4Xml({ owners: ownerXml() + ownerXml(undefined,'0000000003') }),
  malformed: '<ownershipDocument><documentType>4</ownershipDocument>',
  incomplete: '<ownershipDocument><documentType>4</documentType></ownershipDocument>',
  swapPurchase: form4Xml().replace('<equitySwapInvolved>0</equitySwapInvolved>','<equitySwapInvolved>1</equitySwapInvolved>'),
  footnotedPrice: form4Xml({extra:'<footnotes><footnote id="F1">Synthetic price qualification; no interpretation supplied.</footnote></footnotes>'})
    .replace('<value>12.50</value>','<value>12.50</value><footnoteId id="F1"/>'),
  malformedPriceFootnote: form4Xml().replace('<value>12.50</value>','<value>12.50</value><footnoteId/>'),
  seniorNotes: form4Xml().replace('<value>Common Stock</value>','<value>Senior Notes</value>'),
};
