# Ops Log

## 2026-08-06 — M6.5 production fixture cleanup

Deleted 20 integration-fixture rows from production.

Cause: integration suite read DATABASE_URL instead of TEST_DATABASE_URL,
writing fixture data into the production database.

Rows deleted:
- ledger_entries: 2 (txn_id = 'txn_uow_1')
- settlements: 4 (draw_id IN draw_uow_1, draw_s1, draw_s2, draw_s3)
- draws: 4 (draw_uow_1, draw_s1, draw_s2, draw_s3)
- authorization_nonces: 0 (none existed for fixture auths)
- authorizations: 2 (auth_uow, auth_d)
- funding_sources: 2 (fs_uow, fs_d)
- accounts: 3 (acct_d, acct_uow, acct_revenue)
- principals: 3 (prn_d, prn_uow, sys_root)

Real x402 txn 0x7bc61296168bbd5ef3f8e1ca9b86ce845d73f15219f915680dd58d6e6ddc1f63
unaffected. Two shadow ledger entries on acct_platform_suspense (debit 100000)
and acct_platform_revenue (credit 100000) confirmed intact.

Ledger append-only is absolute from this point.

## 2026-08-10 — Cloudflare rate-limit auth-exclusion attempt (blocked)

Attempted to add auth-signal exclusions to satelink-rate-limit.
BLOCKED: Cloudflare free plan forbids http.request.headers and
http.request.uri.args in rate-limiting expressions (Advanced Rate Limiting
required). Rule unchanged, version 5. Known defect: throttles ALL callers
at 10 req/10s including authenticated ones. Deferred — no external
customers to affect. Free workaround when needed: WAF Custom Rule
(http_request_firewall_custom phase) with a skip action. Backup at
scripts/ops/cloudflare-ratelimit-rule-backup-20260810.json.

## 2026-08-10 — Shrink x402 402 challenge (alternativePayment compaction)

Compacted the `alternativePayment` block embedded in the anonymous x402 402
(payments/x402/middleware.js). It carried the full ~4.1 KB legacy USDT-rail
body — human-readable curl `examples`, a verbose `register` block, deposit
prose, and fields duplicated inside `error.data.payment`. The @x402/core
client never reads `alternativePayment` (verified against createPaymentPayload,
dist/cjs/client/index.js:257-303 — it reads only x402Version/accepts/
extensions/resource), so this does NOT touch the payment path. Kept the
machine-actionable USDT fields (vault_address, usdt_contract, chain_id,
minimum_usdt, calldata_url), register_url, docs, and the -32005 JSON-RPC
`error` envelope verbatim; dropped the ~3.4 KB of prose/duplication.

Byte sizes (real production challenge, subnet-402 variant):
  alternativePayment  4,081 B -> 710 B
  full 402 challenge  5,866 B -> 2,477 B  (-57.6%, uncompressed)
Payment params decode byte-identical via @x402/core client (test:
x402_challenge_shrink.test.js); x402_rail.test.js passes 16/16 unchanged.

Projected egress (402 body only):
  at 991k 402s/day:  ~174 GB/mo -> ~74 GB/mo   (~100 GB/mo saved)
  at measured ~1.19M/day (35.67M/mo): ~209 GB/mo -> ~88 GB/mo
Total Railway egress was 238 GB/mo; ~92% is these 402s.

Compression finding (NOT fixed here): the app DOES gzip this 402 to ~2.5 KB
when Accept-Encoding: gzip is present (compression@1.8, verified against the
Railway origin directly). But the 402 is Cache-Control: no-store, so
Cloudflare forwards the visitor's Accept-Encoding to origin — and the ~1.19M/
day anonymous scrapers send none, so Railway egress is UNCOMPRESSED (confirmed:
238 GB / 38.88M req = 6,578 B/req avg). No clean Cloudflare rule fixes this:
CF's gzip-to-origin override is coupled to caching (no-store excludes it), and
Accept-Encoding is a forbidden header in Request Header Transform Rules. The
reliable compression lever would be app-side forced gzip on the 402 (safe in
the all-CF-fronted topology) or a CF Snippet/Worker — both deferred pending a
decision, since the body shrink already removes most of the egress.
