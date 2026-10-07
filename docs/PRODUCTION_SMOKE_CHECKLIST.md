# Research MVP deployment readiness and smoke checklist

This checklist is reusable. It does not execute a deployment, change environment variables,
contact a database, or authorize paid AI calls. Record PASS / FAIL / NOT VERIFIED with the
deployed SHA, date and deployment context. Do not record secret values.

## Before preview / production release

- Obtain separate approval for preview, main merge and production deployment. No automatic merge.
- Clean pnpm frozen-lockfile install and build must pass without `.env.local`, Docker or untracked user files.
- Confirm Netlify adapter version, build Node 24, Functions Node runtime, function duration and bundle limits.
- Confirm account credits, Functions and Blobs availability; repository cannot establish account entitlement.
- Production Functions: `OPENAI_API_KEY`; optional `NEWS_AI_MODEL` (default gpt-4.1-mini),
  `NEWS_AI_DAILY_LIMIT` (default 50 attempted provider calls per Taipei day; set a conservative launch limit).
- `CONTEXT` is platform supplied. Only `production` uses site-wide news stores; all other contexts
  use deploy stores. Do not manually override preview context as production. A preview must not share
  production secrets or quota. Verify this on the adapter, not just in unit tests.
- Blobs SDK context is platform supplied; no personal access token is required in application code.
  Stores: `news-ai-analysis`, `news-source-snapshots`, `news-ai-requests`.
- No market/FX/RSS API key is currently used. Yahoo USD/TWD rate is indicative and may be delayed.
- No `DATABASE_URL`, `DATABASE_DIRECT_URL`, SEC contact, test DB flags or bootstrap approval is needed
  for this release. None should be supplied to the Research MVP runtime.
- No secret under `NEXT_PUBLIC_*`. Ensure OpenAI key is not provided to preview unless explicitly authorized.
- Inspect package/build security advisories before release. This is separate from source pattern scanning.

## After authorized deployment (do not run against production without release approval)

1. `/` redirects to `/dashboard`; dashboard loads without HTTP 500 or hydration errors.
2. Confirm deployed commit SHA from Netlify, not localhost. Main and published SHA must match the approved release.
3. Market cards show Yahoo source and individual quote timestamps, or explicit sample fallback. TPEX is unsupported/sample.
4. USD/TWD shows Yahoo source, quote timestamp and delayed/stale label. Failure must show Demo/Sample rate,
   never present a fixed fallback as live. Check portfolio conversion units (TWD per USD).
5. RSS list contains real sources/dates, or explicit unavailable/sample state. Reload does not fabricate news.
6. Open a headline's original-source link. New tab has noopener; no executable URL accepted.
7. Open `/news/<observed-rss-id>`; reload/deep link works while snapshot retained. Summary is not labelled full article.
8. Only after paid-test approval, expand one real article's AI panel. All summary/deep sections appear;
   title/summary analysis basis and demo portfolio are visible. No buy/sell instruction asserted as fact.
9. Reopen the same article in another session: success cache reused and provider budget does not increase.
   Verify bounded, sanitized server diagnostics/budget evidence; UI alone cannot establish cache effectiveness.
10. In a preview with test-only configuration, exercise 429/503 and disabled AI (daily limit 0).
    Verify Retry-After countdown, retry, failure classification; do not exhaust the live quota to test it.
11. Verify production shared CAS/lease/budget across function instances and cold starts. Missing Blobs
    must deny new paid requests, not switch to function-local allowance. Service-level cache reads may
    retain prior success, but an unavailable endpoint request guard returns 503 before reading analysis.
12. Portfolio/holdings say Demo/Sample and offer no actual-account persistence claim.
13. People/institution directory/detail work. Unverified/empty disclosures remain UNKNOWN/PARTIAL;
    no mock transaction is represented as a real purchase or SEC holding.
14. Follow, reload, unfollow and reload in one browser; state persists locally. No cross-device/cloud-sync claim.
15. Check 375/768/1280 viewport: navigation, cards, news detail, AI disclosure, retry button and text wrapping.
    Existing wide tables/index strip may scroll within their container; document/page must not overflow horizontally.
16. Verify nonexistent route/invalid news ID gives 404. Expired/removed RSS detail must not render invented content.
17. Bodyless same-origin AI POST includes X-News-Analysis-Request: 1. Foreign origin/missing header/body
    is rejected before RSS/provider. Oversized body rejected (413); unsupported methods return 405.
18. Check refresh/direct links to stock, people, portfolio. Record upstream failures separately from runtime failure.
19. Console has no fatal React/runtime errors; check API HTTP failures and sanitized reasons. No stack/secret in response.
20. Inspect client chunks/network for secret exposure and ensure no unexpected Neon/SEC connection.

## Deliberate limits

No background polling/cron, SEC ingestion, Neon persistence, private account system or cross-device Following.
Request-triggered news refresh uses 30-minute revalidation; Yahoo uses 5 minutes. FX older than 36 hours
is marked stale; over 7 days/invalid/future quotes become sample fallback. This is not an executable FX price.
Public AI guard is not authentication: forged headers/CLI traffic can consume the shared allowance.
Global 30 requests/minute, 2 concurrent paid calls, article lease, daily attempt cap and fail-closed shared
storage bound exposure. Operator should also set OpenAI project spending controls and platform traffic protection.
Minute rate keys are small immutable-window records; quota is not a currency-denominated billing budget.
The platform must honor the documented conditional-write semantics; verify this before enabling AI.
