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

## 2026-08-12 — Append-only EXCEPTION: correct x402 ledger currency USDT → USDC

Reason: the shadow ledger writer hardcoded currency='USDT' for every entry, but
x402 settles USDC on Base (asset 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913).
The one real revenue_event row was therefore mislabelled, and the M7 reconciler
was papering over it with a same-decimals magnitude check that defeated M1's
branded Currency compile-time guarantee.

ledger_entries is append-only by policy (migration 004 REVOKEs UPDATE/DELETE
from satelink_app). This is an explicit, one-time, human-authorized exception,
performed as the `postgres` owner inside a single transaction with before/after
verification and a balance re-check (SET CONSTRAINTS ALL IMMEDIATE) before COMMIT.

Rows corrected (txn shadow:x402:0x7bc61296…ddc1f63): 3
  - ledger_txns header:        1  (USDT → USDC)
  - ledger_entries (debit+credit): 2  (USDT → USDC)
Balance unchanged (debit 100000 = credit 100000). Amounts untouched.

Going forward: shadow_ledger_write.js derives currency per event from the asset
(apps/api/src/ledger/asset_currency.js); an unknown on-chain asset halts the
write (reason 'unknown_asset') and is never defaulted. The reconciler now
requires the ledger row's currency to equal the on-chain target's currency and
compares same-currency Money — the magnitude check is deleted.

## 2026-08-18 — M8 redeploy + capacity-enforcement exit gate

Invoice paid, Railway deploys unblocked. Satelink-api's active deployment was
still the Aug 12 reconciler-fix commit (6212016) — M8 (ed3d264, #320) had
merged to main but never actually shipped, so `/internal/capacity-parity`
404'd.

**Redeploy**: `railway service redeploy --service Satelink-api --from-source
--yes` (never `railway up` — that would ship local/uncommitted code). New
deployment `30b158b7`, SUCCESS, commit ed3d264 (M8 #320) confirmed via
`railway deployment list --json`.

**Contradiction found and resolved (founder confirmed, option 1)**:
`/internal/capacity-parity` is NOT token-gated — no `INTERNAL_TOKEN` exists
anywhere in code or Railway vars. `app_factory.mjs:447` mounts it with no
auth middleware, same as the M3 `/internal/ledger-parity` route; only
`/internal/x402-funnel` uses `requireAdminAuth`. Both parity endpoints are
read-only, payload-free of secrets, by their own doc comments. Proceeded
unauthenticated, consistent with the M3 precedent. See follow-up filed below
— this inconsistency has no documented criterion and should get one.

**Step 1 — dual (PASS)**: `CAPACITY_ENFORCEMENT_PATH=dual` set, confirmed live
via `active_path` on capacity-parity (not just "the var was set" — the field
flips from stale-legacy to dual after the Railway-triggered restart).
Scripted 10 calls against `/rpc/polygon`: 5 with `X-API-Key` set to the
funded test key (api_credits id=12, basic tier, $0.599 balance) +
`x-wallet-address: 0x36aed9f5…` (the M8 test
signer) → allow/allow (legacy served via api_credits, new evaluated
read-only via the signer's authorization); 5 with an unregistered bogus key,
no wallet → deny/deny (`account_not_found` vs `no_authorization` — the
recorder counts agreement on decision only, not reason, per
parity_recorder.js:59). Result: `decisions_evaluated:10, agreements:10,
disagreements:0`, `new_minus_legacy_p99_ms: -14.019` (new path faster,
well under the 10ms gate). Verified no side effects: both authorizations'
`consumed_amount` unchanged at 0 (dual's new-path eval is read-only); legacy
api_credits balance moved by exactly 5×$0.00003=$0.00015 as expected.

**Step 2 — new: exhaustion test redirected to an isolated proof (see below)**.
Setting `CAPACITY_ENFORCEMENT_PATH=new` and confirming live worked cleanly.
One live probe call (apiKey+wallet, to confirm the path switch had real
effect) drew 30 minor units from `auth_18de0248…` ($2 cap authorization) —
**not** `auth_0999fb45…` (the $0.005 authorization the task specified).

Root cause: `enforceNew` (capacity_enforcement.js:110-136) selects an
authorization by `principal_id` only — there is no `authorization_id`
parameter anywhere in the query (confirmed by reading lines 116-123). Both
of the signer's authorizations share the identical `valid_before`
(1789623721000), so `ORDER BY valid_before ASC LIMIT 1` doesn't disambiguate;
the tie resolved to the earlier-created $2 authorization. Draining that one
to reach the $0.005 authorization would take ~66,650 more live calls against
production — refused as excessive load for a verification step. Mutating
`auth_18de0248…`'s state to force the fallback was also refused — not a
unilateral decision.

Instead, ran an isolated, single-transaction, ROLLED-BACK test that mirrors
`enforceNew`'s exact UPDATE (same WHERE clause: state='active',
currency='USDC', valid window, `cap_amount - consumed_amount >= cost`), with
one added constraint (`AND id = 'auth_0999fb45…'`) to target the $0.005
authorization directly, cost=30/call:
  - 166 allows (consumed_amount climbing 30→4980)
  - call 167: 0 rows updated → denied
  - classified reason: `insufficient_capacity` (remaining 20 < cost 30, row
    active and in-window — never conflated with no_authorization/expired)
  - invariant held throughout: consumed_amount (4980) <= cap_amount (5000)
  - `ROLLBACK` — confirmed after: `auth_0999fb45…` back to consumed_amount=0
    in production.

This validates the decrement/deny mechanism (atomicity, correct reason
classification, invariant enforcement) in isolation. It does NOT validate
the live authorization-selection path when a principal holds multiple
active authorizations — that ambiguity is real and is filed as a blocking
item for M9 below, not fixed here.

Final state: `auth_18de0248…` consumed_amount=30 (from the one live probe,
left as-is — real but immaterial, $0.0003), `auth_0999fb45…`
consumed_amount=0 (untouched — isolated test rolled back).

**Step 3 — legacy rollback (PASS)**: `CAPACITY_ENFORCEMENT_PATH=legacy` set,
confirmed live via `active_path`. One call with the same apiKey+wallet
headers returned `X-Credit-Source: api_credits` (served by the legacy path),
deducted exactly $0.00003 from the api_credits balance, and left BOTH
authorizations' consumed_amount completely unchanged. Proves the cutover
reverts purely via a Railway variable flip — no code redeploy — exactly as
designed (capacity_enforcement.js's own comment: "read at REQUEST time so a
Railway env flip reverts with no redeploy"). Note: Railway does restart the
running container to inject the new env value (not a rebuild/redeploy of a
new image) — that restart is what "no redeploy" means here.

Flag left on `legacy` per instruction.

**Cost picture correction**: egress dropped from ~8 GB/day to ~2 GB/day
after PR #316 (cut anonymous free-tier RPC to the 402 challenge only) and
PR #317 (compacted the 402 challenge body, -57.6%). Run-rate is ~$10/mo —
not a problem. A Cloudflare WAF rule for this was considered and rejected:
egress at this level doesn't justify the operational complexity of a custom
WAF rule, and `free_tier_gate.js` is not to be touched per standing
instruction.

**Follow-ups filed (not implemented in this PR)**:
1. Non-blocking: `/internal/*` route auth is inconsistent with no documented
   criterion (x402-funnel gated, ledger-parity and capacity-parity not).
   Proposed rule: any endpoint returning operational counts/timing gets
   `requireAdminAuth` by default, even if payload-free of secrets; only
   truly static or already-public data goes unauthenticated. To be written
   into `libs/CLAUDE.md` in a future PR.
2. Blocking before M9: `enforceNew`'s authorization selection has no
   deterministic tiebreak when a principal holds multiple active
   authorizations with the same `valid_before` — M9's multi-nonce recurring
   authorizations create exactly that situation. Proposed fix: add an
   explicit, deterministic tiebreak to the `ORDER BY` (e.g. `ORDER BY
   valid_before ASC, created_at ASC, id ASC`, or FIFO strictly by
   `created_at`). Not implemented here — M9 design must address it before
   cutover.

## 2026-08-19 — M9 Blast Radius & Global Flip Decision

Executed the blast-radius query on production (`Postgres-iQeW`) to identify principals holding `api_credits` with `credits_usdt > 0` but lacking an `authorizations` row (who would be broken by a global flip of `CAPACITY_ENFORCEMENT_PATH=new`):

```sql
SELECT api_credits.api_key, api_credits.wallet_address
FROM api_credits
LEFT JOIN principals ON principals.external_ref = api_credits.wallet_address
LEFT JOIN authorizations ON authorizations.principal_id = principals.id
WHERE authorizations.id IS NULL AND api_credits.credits_usdt > 0;
```

**Result (5 rows):**
- `(anonymous x402 keys)` (3 keys)
- `(free tier key)`
- `(founder M8 test key)`

**Decision:** The blast radius is limited to exactly 5 internal/test/free-tier keys (including the founder's M8 test key and 3 anonymous x402 keys). Given this negligible impact, we **accept the global flip**. We will NOT build per-principal opt-in infrastructure. 

`CAPACITY_ENFORCEMENT_PATH=new` will be flipped globally for the 3-day M9 test window, then reverted to `legacy` per the rollback plan.
