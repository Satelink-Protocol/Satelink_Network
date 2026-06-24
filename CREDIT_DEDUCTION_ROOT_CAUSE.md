# SATELINK — CREDIT DEDUCTION ROOT CAUSE

Date: 2026-06-21 · Code: `origin/main` (production lineage, PRs #168–#171) ·
Data: production DB (Postgres-iQeW, read-only). No assumptions — every claim is
backed by code line or production row.

---

## ROOT CAUSE (one sentence)

`freeTierGate` bypasses the per-IP free-tier limit **only** for the
`x-wallet-address` header, **not** for `x-api-key` — but the entire canonical
credit system (`api_credits` / creditService) is **API-key-keyed**, so a funded
`X-API-Key` caller is treated as anonymous free-tier traffic, IP-rate-limited,
and returned `402 FREE_TIER_LIMIT_REACHED` **before** the request reaches
`authorizeAndMeter`, where deduction happens.

---

## Request lifecycle (Task 1 & 2) — exact order

Mount: `apps/api/app_factory.mjs:345`
```
app.use("/rpc", freeTierGate, express.json({limit:'1mb'}), createRpcGateway(pool));
```
1. **`freeTierGate`** — `apps/api/src/middleware/free_tier_gate.js:62`
   - L64–65: `const walletHeader = req.headers['x-wallet-address']; if (walletHeader) return next();`
   - No `x-api-key` check. Anonymous/keyed-without-wallet → per-IP counter (`ft:<ip>`).
   - L140: `if (count > FREE_TIER_LIMIT) …` → **L156–185 returns 402 `FREE_TIER_LIMIT_REACHED` (L163)**. **Request stops here.**
2. **`createRpcGateway` → `router.post('/:chain', creditGate, handler)`** (only if gate passed)
   - `creditGate` — `apps/api/src/middleware/credit_gate.js:48`: `if (CREDIT_CANONICAL==='true') return next();` (steps aside)
   - `handler` — `rpc_gateway.js:38`: reads `apiKey = req.headers['x-api-key']` (L41), `canonical = CREDIT_CANONICAL()` (L44)
   - **L69:** `if (canonical && (apiKey || walletHdr)) { verdict = await authorizeAndMeter(db, {apiKey, wallet}) }` ← **deduction + metering + revenue**
3. **`authorizeAndMeter`** — `apps/api/src/billing/credit_service.mjs:93`
   - resolveAccount → daily-limit gate (429) → **atomic balance deduct (L120–131, 402 if insufficient)** → usage metering (`api_usage_daily`, L148) → returns `cost` → revenue event (`recordRpcRevenue`, only when cost>0).

**Branch actually taken for `sk_live_f6d9…` (Task 2):** step 1 → 402. Steps 2–3 never execute.

---

## Bypass condition (Task 3) — verified, not speculated

| Caller | `freeTierGate` outcome | Reaches deduction? |
|---|---|---|
| Anonymous (no key, no wallet) | IP-counted → 402 at 500/day | n/a (correct) |
| `x-wallet-address` present | **bypass** (L65) → gateway | yes |
| **`X-API-Key` present (funded)** | **NOT bypassed** → IP-counted → **402 FREE_TIER_LIMIT_REACHED** | **NO ← BUG** |

The candidate "free-tier executes before credit path" + "account linkage by api-key not honored at the gate" are **both** confirmed true; the others (key not resolved, wallet lookup, flag ignored, metadata mismatch) are **ruled out** — see Task 5.

---

## Exact code (Task 4)

**File:** `apps/api/src/middleware/free_tier_gate.js`
**Lines:** 64–65
**Condition:**
```js
const walletHeader = req.headers['x-wallet-address'];
if (walletHeader) return next();   // ← only wallet bypasses; x-api-key falls through to the IP 402
```
The 402 is emitted at **L156–185** (`error_code: 'FREE_TIER_LIMIT_REACHED'`, L163) when the per-IP `count > FREE_TIER_LIMIT` (L140). Funded API-key callers never reach `rpc_gateway.js:69` (`authorizeAndMeter`).

---

## Production data mapping (Task 5) — all correct

`sk_live_f6d9… (key redacted)`:

| Layer | Value | Source |
|---|---|---|
| `api_credits` row | `tier=basic, daily_limit=10000, credits_usdt=0.599930, status=active` | live DB |
| `resolveAccount({apiKey})` | matches `WHERE api_key = $1` (key starts `sk_`) → returns the row | `credit_service.mjs:44–53` |
| `costFor(account)` | tier≠free → **0.00003 USDT** (paid) | `credit_service.mjs:81–84` |
| daily count today | **0** (< 10000) → rate gate passes | `getDailyCount` |
| balance vs cost | `0.599930 ≥ 0.00003` → deduct succeeds | — |
| `api_usage_daily` today | **0 rows** | live DB |

The account, wallet binding, tier, limit, and balance **all map correctly**. The
empty `api_usage_daily` row for today is the proof that the request never reached
`authorizeAndMeter` (which always inserts a usage row) — it was killed at the gate.
**Account resolution is NOT the problem; gate ordering is.**

---

## Minimum fix (Task 6)

**File:** `apps/api/src/middleware/free_tier_gate.js` — **2-line change at L64–65:**
```js
// before
const walletHeader = req.headers['x-wallet-address'];
if (walletHeader) return next();

// after — keyed callers are handled by creditService, exactly like wallet callers
const walletHeader = req.headers['x-wallet-address'];
const apiKeyHeader = req.headers['x-api-key'];
if (walletHeader || apiKeyHeader) return next();
```
This routes any `X-API-Key` caller past the per-IP free-tier gate into the gateway,
where `authorizeAndMeter` enforces the **per-key** daily limit, balance, and
deduction. No redesign, no refactor, no change to mount order or the gateway.

**Free-tier preserved for unfunded users:**
- Anonymous (no key, no wallet) → unchanged: per-IP 402 at 500/day.
- Free-tier **key** users (`sk_free_…`, tier free) → metered per-key by creditService (daily_limit 500 → 429), cost 0 → still free.
- Unknown/garbage key → `resolveAccount` returns null → **401** (`credit_service.mjs:9`), never free RPC.

---

## Proof (Task 7) — before/after execution flow

**BEFORE (current production):**
```
POST /rpc/polygon  X-API-Key: sk_live_f6d9…
└─ freeTierGate: no x-wallet-address → IP count > 500 → 402 FREE_TIER_LIMIT_REACHED   [STOP]
   authorizeAndMeter: NEVER CALLED → 0 deduction, 0 usage, 0 revenue event
```

**AFTER (with the 2-line fix):**
```
POST /rpc/polygon  X-API-Key: sk_live_f6d9…
└─ freeTierGate: x-api-key present → return next()        [bypass IP gate]
└─ creditGate: CREDIT_CANONICAL=true → next()
└─ handler: canonical && apiKey → authorizeAndMeter(db,{apiKey})
     ├─ resolveAccount → {basic, limit 10000, credits 0.599930, active}
     ├─ daily gate: used 0 < 10000 → pass
     ├─ cost 0.00003 → atomic deduct: 0.599930 → 0.599900, total_spent += 0.00003
     ├─ meter: api_usage_daily (request_count 1, usdt_spent 0.00003)
     └─ billedUsdt 0.00003 → recordRpcRevenue → revenue_events_v2 (== deduction)
   → 200 OK · X-Credit-Source: api_credits · X-Credit-Balance: 0.599900
```

**Verified against the real account** (deduction logic run inside a ROLLED-BACK
transaction — production left unchanged):
```
before:           credits 0.59993000 · spent 0.00000000
atomic deduct:    UPDATE 1 → credits 0.59990000          (balance >= cost guard passed)
meter:            INSERT 1 → request_count 1 · usdt_spent 0.00003000
ROLLBACK;         production unchanged: 0.59993000 / 0.00000000
```
Accounting identity holds: deduction 0.00003 == usage 0.00003 == revenue event 0.00003.

---

## Affected files / conditions

| File | Line | Role |
|---|---|---|
| `apps/api/src/middleware/free_tier_gate.js` | **64–65** | **THE BUG** — bypass omits `x-api-key` |
| `apps/api/src/middleware/free_tier_gate.js` | 140, 156–185 | emits 402 `FREE_TIER_LIMIT_REACHED` |
| `apps/api/app_factory.mjs` | 345 | mount order: gate before gateway (context) |
| `apps/api/src/workloads/rpc_gateway/rpc_gateway.js` | 69, 75 | deduction branch, never reached (context) |
| `apps/api/src/billing/credit_service.mjs` | 93–166 | `authorizeAndMeter` — correct, never invoked |

## Risk level: **LOW**

- 2-line additive bypass; no refactor; no mount/order change.
- Unfunded/anonymous free-tier behavior unchanged; unknown keys → 401 (no free service).
- Minor: a junk-key flood forces a `resolveAccount` DB lookup per request instead of a
  Redis IP counter, and keyed traffic no longer hits the gate's `ABUSE_THRESHOLD` 429.
  If that surface matters, keep counting the IP for keyed requests but skip only the 402
  (larger change — not the minimum). Not required for correctness.

## Verification method

1. **Unit:** `apps/api/test/credit_service.test.js` already covers `authorizeAndMeter`
   (free 429, paid deduct, 402 on empty balance). Add one gate test: a request carrying
   `x-api-key` calls `next()` regardless of IP count.
2. **Production (post-deploy):** `POST /rpc/polygon` with `X-API-Key: sk_live_f6d9…` from
   any IP → expect `200` + `X-Credit-Source: api_credits` + `X-Credit-Balance`; confirm in
   DB `credits_usdt` drops by 0.00003, an `api_usage_daily` row appears, and one
   `revenue_events_v2` row is created (== the deduction).
