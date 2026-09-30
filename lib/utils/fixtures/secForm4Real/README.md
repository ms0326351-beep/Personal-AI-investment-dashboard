# Stage 2B: real SEC Form 4 compatibility corpus

Eight raw XML documents (about 64 KB total), downloaded directly from SEC Archives.
This is a bounded offline test corpus, not live ingestion or a current holdings feed.
No acquisition credentials or request headers are stored here.

- `manifest.json`: issuer, accession, document type, filing date from the SEC filing
  index, original XML URL, filing index URL, actual retrieval time, selection reason,
  and SHA-256 of the downloaded bytes.
- `expected.json`: frozen field expectations extracted independently using
  PowerShell `System.Xml` and XPath, then inspected against the raw XML. It is not
  parser output and is not regenerated during tests. Numeric expectations represent
  reported scalars, not verified economic units or transaction consideration.
- `.gitattributes`: preserves raw XML bytes across platform checkouts.
- `../../secForm4Real.test.ts`: reads these local files only; no network or AI.

| Fixture | Accession | Form | Filed | Reason / observed coverage |
|---|---|---|---|---|
| oracle.xml | 0001341439-25-000016 | 4 | 2025-09-17 | M/F, officer, omitted role flags, one Table II row |
| abm-amendment.xml | 0001225208-26-000793 | 4/A | 2026-01-23 | F, officer/title, correction, transaction-coding footnote |
| ault-amendment.xml | 0001214659-26-011678 | 4/A | 2026-09-14 | Four P rows, two owners, ten-percent roles, direct/indirect, weighted-price notes, two holdings rows |
| docusign.xml | 0001796825-26-000018 | 4 | 2026-09-16 | M/F and six Table II exercise rows |
| nvidia-gift.xml | 0001045810-25-000027 | 4 | 2025-03-04 | G, zero reported price, three notes, six holdings rows |
| docusign-sale.xml | 0001796825-26-000014 | 4 | 2026-09-08 | Three S rows, weighted-price notes, officer/title |
| docusign-director-sale.xml | 0001261333-26-000101 | 4 | 2026-09-15 | S, director, absent officer title |
| victoria-amendment.xml | 0001225208-26-004410 | 4/A | 2026-04-06 | P correction to 633 shares in remarks, director-only role flags, empty containers |

## Findings and coverage boundaries

All eight parse without losing supported Table I rows. Two DocuSign sale documents
are `parsed`; the other six are `partial` for omitted role booleans and/or expressly
unsupported Table II / non-derivative holding rows. Partial is expected, not a
parser crash. Identity, security resolution and complete holdings coverage remain
UNKNOWN. Joint owner rows are not apportioned among people/institutions.

Observed schemas: X0508 and X0609, both unnamespaced. Real structures include
empty address/footnotes/derivative containers, omitted role booleans, multiple
owners/signatures, repeated Table I and II rows, numeric trailing zeros, escaped
ampersands, footnotes on coding/prices/post-transaction holdings, `remarks`,
`aff10b5One`, `issuerForeignTradingSymbol`, `rptOwnerNonUSAddressFlag` and
`notSubjectToSection16`. Extra fields survive in the raw fixture but are not added
to the normalized model. In particular remarks are not automatically interpreted
to merge amendments. Neither dateOfOriginalSubmission nor periodOfReport sets
position asOfDate/periodEnd or holdings freshness.

P/S are purchase/sale codes, not proof of open-market venue (private transactions
are also possible). M/F/G remain OTHER actions; A/D never implies market sentiment.
All 15 supported rows have unavailable transactionValue: this XML corpus supplies
no externally verified row-specific security/quantity/price unit basis. Numeric
price zero is preserved; it is not treated as missing or used to invent net cash.

NOT FOUND in this bounded corpus: non-derivative A award, unusual/debt-like security,
missing numeric price, equitySwapInvolved=true, actual namespace variants, and
alternative element ordering. Existing synthetic Stage 2 tests still cover these
relevant semantic safeguards, but do not establish real-document compatibility
for cases absent here. No synthetic mutations are labelled real SEC fixtures.

No parser changes or issuer-specific production branches were necessary. This
corpus is evidence for compatibility within its coverage, not SEC-wide/XSD
certification or permission to enable production ingestion. Transport compliance,
response validation, size/rate limits, provenance envelopes and amendment handling
still require a separately authorized ingestion stage.
