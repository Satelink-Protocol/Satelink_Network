# Customer Zero Readiness Audit — 2026-06-21

**Scope:** end-to-end revenue path — API Key → Deposit → Credits → Usage → Billing → Settlement.
**Method:** source trace (file:line) + live production probes against `rpc.satelink.network` + ran the new security test suite.
**Goal:** identify every remaining blocker before the first external paying user.

---

## TL;DR

A developer can create a key and make RPC calls in production today. **They cannot
become a paying customer.** The entire deposit/credits/usage surface the customer
UI depends on **404s in production** (it is uncommitted working-tree code), and even
once deployed, the customer-facing billing system (**Postgres `api_credits`**) is
**architecturally disconnected** from the request-serving path (which enforces
**Redis `rpc:apikey:*`** + wallet `credit_balances`). Paying changes nothing:
deposited credits are never consumed, paid daily limits are never enforced, usage
always reads zero, and no epoch has ever settled on-chain.

| Score | /100 | One-line |
|---|---|---|
| **Revenue Readiness** | **15** | Can verify a deposit, but credits are never consumed and nothing settles on-chain |
| **Developer Experience** | **40** | Clean UI + working key creation, but deposit/usage 404 in prod and usage always shows 0 |
| **Production Readiness** | **30** | Live deposit-hijack/reorg risk in deployed deposit flow; critical fixes uncommitted |
| **Customer Zero Readiness** | **20** | First paying user cannot complete the flow end-to-end |

---

## The three disconnected systems (root cause)

| # | System | Written by | Read by serving path? | Tables/keys |
|---|---|---|---|---|
| A | **API-key tier model** | `/api/keys` (`api_keys_route.mjs` → `credit_system.mjs`) — **the customer UI path** | **NO** | Postgres `api_credits`, `api_usage_daily`, `api_deposits` |
| B | **Redis rate-limit keys** | `rate_limiter.js` / `gateway/routes/api_keys.js` (admin `POST /rpc/keys`) | **YES** (`checkRateLimit`) | Redis `rpc:apikey:*`, `rpc:usage:*` |
| C | **Wallet micro-credits** | `/credits` + DepositListener | **YES** (`credit_gate`) | Postgres `credit_balances` |

The customer onboards into **A**. The RPC gateway only knows **B** and **C**.
`credit_system.mjs` is imported by exactly one file — `api_keys_route.mjs` — and
never by anything on the serving path (verified by grep). This single fact produces
P0-2, P0-3, and P0-4 below.

---

## Live production evidence (probed 2026-06-21)

```
POST /api/keys (tier=free, wallet=0x…dEaD)        → 200  sk_free_e7f775…   ✅ key creation live
POST /rpc/polygon  -H X-API-Key: sk_free_e7f775…  → 200  {"result":"0x54c4a4b"}  ✅ serving works
GET  /api/keys/tiers                              → 200  (old route, deployed)
GET  /api/keys/usage                              → 404  ❌ undeployed
GET  /api/keys/deposit-info                       → 404  ❌ undeployed
GET  /api/keys/deposits                           → 404  ❌ undeployed
POST /api/keys/deposit                            → 404  ❌ undeployed (header-style)
```

The deployed router (`HEAD`) still uses **key-in-URL** routes (`/:key/deposit`,
`/:key/usage`) with **no ownership binding and no confirmation depth**. The
hardened, header-based rewrite + `deposit_validation.mjs` + 19-test suite + the
`keys/`, `usage/`, deposit-page frontend are all **working-tree only** (`git status`:
` M` / `??`), not committed, not deployed.

---

## P0 — BLOCKERS (must fix before first paying user)

### P0-1 — Customer deposit/usage surface is 404 in production (undeployed + uncommitted)
`/api/keys/deposit`, `/deposit-info`, `/usage`, `/deposits`, `/usage-history` return
404 in prod. The customer UI (`/satelink/os/deposit`, `/usage`, `/keys`) calls these
header-style endpoints → every customer page is broken. The code exists only in the
working tree and is **not committed to any branch** (risk of loss).
**Fix:** commit → merge to `main` (per memory: `railway up` does not ship app code;
merge does) → redeploy `apps/web`. Verify the five endpoints return 200.

### P0-2 — API key not honored on the serving path (paid limits never enforced)
Keys created via `/api/keys` live in Postgres `api_credits`; the RPC gateway's
`checkRateLimit(apiKey, ip)` (`rate_limiter.js:113-123`) looks the key up in **Redis**
`rpc:apikey:*`. A Postgres key is absent from Redis → falls through to anonymous
**IP free-tier (500/day)**. A customer who pays for `pro` (100k/day) is still capped
at 500/day-by-IP (or unlimited across rotating IPs). **Authorization for paid tiers
does not exist on the hot path.**
**Fix:** serving path must resolve the key against `api_credits` (or sync
`api_credits` → Redis on create/deposit) and enforce `daily_limit` from there.

### P0-3 — Deposited credits are never consumed (paying buys nothing functional)
`/api/keys/deposit` credits `api_credits.credits_usdt`. The serving `creditGate`
(`credit_gate.js:46-47`) only acts on `x-wallet-address` requests and deducts from a
**different** table (`credit_balances`). An API-key caller's balance never decreases
and is never checked. A customer can deposit $199 and it changes nothing.
**Fix:** deduct per call from `api_credits.credits_usdt` keyed by API key; return 402
when exhausted.

### P0-4 — Usage tracking is dead end-to-end
`incrementDailyUsage()` / `api_usage_daily` is never called by the serving path
(`credit_system.mjs` is imported only by `api_keys_route.mjs`). `/api/keys/usage`
will always show `requests_today: 0`, regardless of real traffic. The customer's
usage dashboard is permanently empty.
**Fix:** increment `api_usage_daily` (and `total_spent`) from the RPC handler per
served call.

### P0-5 — Settlement is mathematically incapable of firing
`settlement_anchor_job.js` anchors only epochs with `total_revenue_usdt >= 1.0`
(`MIN_ANCHOR_REVENUE_USDT`); each ~60s epoch is ~0.0025 USDT, and there is **no
dust-rollup code** (confirmed in the 2026-06-13 audit; still unaddressed). Result:
**0 on-chain settlements ever** (`/api/settlement/history`: every `txHash:null`).
Earned USDT never reaches the chain.
**Fix:** implement dust-epoch rollup into a batched anchor, or lower/aggregate the
threshold; verify the hot wallet holds USDT + MATIC for the anchor tx.

### P0-6 — Live deposit-hijacking + reorg risk in the DEPLOYED deposit flow
The deployed `/:key/deposit` has **no sender↔wallet ownership binding** (only a
`tx_hash` UNIQUE de-dup) and **no confirmation-depth check**. Any free key can claim
any USDT→treasury transaction it observes (front-run the real depositor and steal the
tier upgrade), and a credited deposit can be reorged out. (The working-tree rewrite
fixes both — ownership binding + 25-confirmation gate, all 19 tests green — but it is
undeployed.) Until P0-1 ships, the insecure flow is what's live.
**Fix:** ship the hardened router (resolves with P0-1).

---

## P1 — ISSUES (fix before scaling past Customer Zero)

- **P1-1 Phantom billing.** `recordRpcRevenue` writes `revenue_events_v2` at list
  price (0.00003 USDT) on **every** served call including free/unpaid traffic
  (`rpc_billing.js`, unconditional). Recorded "revenue" is the notional value of
  free traffic, not cash — it pollutes epochs and any settlement math.
- **P1-2 Three parallel key/credit systems** (A/B/C above). Even after P0 fixes,
  this fragmentation will keep drifting. Converge on one source of truth
  (recommend Postgres `api_credits` as canonical; Redis as a read-through cache).
- **P1-3 No wallet-update endpoint.** Ownership binding requires `wallet_address`
  on the key, but `POST /api/keys` makes it optional and there is no PATCH. A user
  who created a key without a wallet can **never** deposit and must mint a new key.
- **P1-4 Invalid/revoked keys are silently served**, not rejected. An unknown `sk_`
  key is downgraded to anonymous IP tier rather than returning 401 — no
  authentication failure is surfaced; revocation has no effect on the hot path.
- **P1-5 Hot-wallet funding for settlement unverified** — even if an epoch crosses
  threshold, the anchor needs USDT balance or MATIC for gas (unconfirmed).
- **P1-6 Key-in-URL transport** in the deployed router leaks the bearer secret to
  logs/proxies/history (fixed in working tree).

## P2 — IMPROVEMENTS

- **P2-1** Tier model conflates one-time deposit-as-credit with monthly
  subscription pricing ($9/$49/$199) — no expiry or renewal semantics; depositing
  $9 once grants `basic` indefinitely.
- **P2-2** `creditGate` fail-opens on DB error (serves the call) — acceptable for
  uptime but should alert, not just log.
- **P2-3** Wire the mocha security suite into CI so the P0-6 hardening can't regress
  (`npm test` runs it; gate merges on it).
- **P2-4** Two deposit ingestion paths (DepositListener for wallets, `/api/keys/deposit`
  for keys) — consolidate to one verified pipeline.
- **P2-5** Per-key revenue/usage observability once A is canonical (ties into the
  Grafana Option B work).

---

## Verdict per stage

| Stage | Auth | Authz | Works in prod? | Blocker |
|---|---|---|---|---|
| API Key | ✅ create live, format-checked, rate-limited | ⚠️ unknown key silently anonymous | ✅ create only | P1-4 |
| Deposit | ✅ header (new) / ⚠️ URL (deployed) | ❌ no ownership binding deployed | ❌ 404 in prod | P0-1, P0-6 |
| Credits | n/a | ❌ never consumed on serving | ❌ disconnected | P0-3 |
| Usage | ✅ key-scoped | n/a | ❌ always 0 | P0-4 |
| Billing | n/a | ❌ bills free traffic | ⚠️ phantom | P1-1 |
| Settlement | n/a | n/a | ❌ never fires | P0-5 |

**Minimum path to a real first dollar:** ship P0-1 (deploy the surface) → P0-2/P0-3/P0-4
(make `api_credits` the canonical store the serving path reads, deducts, and meters
against) → P0-5 (let earned USDT settle on-chain). P0-6 resolves with P0-1.
