# ACTIVE EVENTS
# Status: Shadow mode mirror
# Updated: 2026-06-03 (EVT-ENG-002 added)

Each open event has one accountable owner.

| Event ID | Type | Severity | Owner | Status | Subject | Source | Dedupe Key | Notes |
|----------|------|----------|-------|--------|---------|--------|------------|-------|
| EVT-REV-001 | `revenue.validation.required` | `REV-1` | `ECONOMY_COMMANDER` | `NEW` | `revenue_truth` | `enterprise_os.phase0` | `phase0-revenue-truth` | Phase 0 gate remains open until collected-cash metrics are validated from current sources. |
| EVT-OPS-001 | `incident.local_diagnostic_failure` | `OPS-2` | `ENGINEERING_COMMANDER` | `ACTIVE` | `local_api_and_diagnostic` | `ALERTS.md` | `better-sqlite3-local-api` | Mirrors repeated local `better-sqlite3` diagnostic failure and local API unreachable alert chain. |
| EVT-REV-002 | `revenue.payment_flow_verification` | `REV-2` | `ECONOMY_COMMANDER` | `ACKED` | `usdt_payment_flow` | `PROGRESS.md` | `c4-1-usdt-payment-flow` | Mirrors legacy `C4-1` payment-flow verification work while queue compatibility remains active. |
| EVT-CUST-001 | `customer.zero.definition_required` | `REV-2` | `ECONOMY_COMMANDER` | `NEW` | `customer_zero` | `enterprise_os.customer_zero_program` | `customer-zero-definition` | Customer Zero program defined but not yet proven with a retained paying machine or protocol customer. |
| EVT-AUTO-001 | `founder.action_taken` | `OPS-3` | `AUTONOMY_COMMANDER` | `NEW` | `daily_revenue_truth_summary` | `enterprise_os.automation_backlog` | `founder-daily-revenue-summary` | Founder still performs revenue-truth synthesis manually; automation candidate must be captured. |
| EVT-TEST-001 | `revenue.test_trigger` | `REV-4` | `ECONOMY_COMMANDER` | `NEW` | `cascade_test` | `manual` | `cascade-test-001` | Test event to validate routing |
| EVT-ENG-002 | `engineering.p0_revenue_blockers` | `ENG-1` | `ENGINEERING_COMMANDER` | `NEW` | `rpc_deposit_frontend_p0` | `p0_audit_2026-06-03` | `eng-p0-revenue-blockers` | 3 P0 blockers: (1) app_factory.mjs staged for deletion but still required for /rpc mount — if committed server crashes; (2) /credits/deposit/initiate exists (SAT-228) but needs end-to-end smoke test to confirm machines can complete deposit; (3) billing/page.tsx is node-operator earnings UI not a customer deposit flow — no customer USDT top-up page exists. See EVT-ENG-002 detail block below. |

---

## EVT-ENG-002 — Engineering P0 Revenue Blockers (2026-06-03)

**Owner:** ENGINEERING_COMMANDER
**Severity:** ENG-1 (P0 — blocks revenue)
**Escalated from:** EVT-REV-001 via ECONOMY_COMMANDER audit

### BLOCKER 1 — RPC Endpoint: `app_factory.mjs` staged for deletion (CRITICAL)

**Finding:** The `/rpc` route is mounted exclusively inside `app_factory.mjs` at line 241:
```
app.use("/rpc", freeTierGate, express.json({ limit: '1mb' }), createRpcGateway(pool));
app.use("/rpc/mev", createMevRelayRouter(pool, redis));
```
`server.js` line 12 imports `createApp` from `./app_factory.mjs`. The file **exists on disk** but is **staged for deletion** (`D app_factory.mjs` in git status). If that staged deletion is committed, the server will crash on import and `/rpc/*` will go 404/500.

**Real RPC endpoint URL (currently):** `https://rpc.satelink.network/rpc/polygon`
(not the root — root has no JSON-RPC handler)

**Fix required:** Before deleting `app_factory.mjs`, migrate all route registrations it contains into `server.js`. Do NOT commit the staged deletion until migration is verified. The `/rpc` routes, `/api/keys`, `/v1` (AI gateway), `/api/bandwidth`, `/v1/tools`, `.well-known`, `/openapi.json`, `/api/oracle`, `/api/webhooks`, `/api/settlement` are all mounted there.

**Files:** `apps/api/app_factory.mjs`, `apps/api/server.js:12`

---

### BLOCKER 2 — `/credits/deposit/initiate`: Endpoint exists, needs smoke test

**Finding:** Endpoint WAS missing (prompted SAT-228). Commit `2c6b780` added it. It is now mounted:
- Handler: `apps/api/src/routes/credits.js:149` — `GET /deposit/initiate?amount=<usdt>`
- Mounted: `apps/api/server.js:239` — `app.use("/credits", createCreditsRouter(pool, console))`
- Returns: `approveCalldata` + `depositCalldata` (ABI-encoded) for Polygon Mainnet USDT vault

**Risk:** Endpoint exists but has never been smoke-tested against production. Machines hitting 402 may not retry correctly; the response contract (field names, chain_id, gas estimates) hasn't been verified against the M2M client SDK.

**Fix required:**
1. `curl https://rpc.satelink.network/credits/deposit/initiate?amount=1.00` — confirm 200 + correct JSON shape
2. Verify `REVENUE_VAULT_ADDRESS` env var is set in production (fallback is `0x80AFEaC3B77CbeC1f7B9f24a50319DC72785DdA3`)
3. Confirm M2M client SDK parses `approveCalldata` / `depositCalldata` field names

**Files:** `apps/api/src/routes/credits.js:146-230`, `apps/api/server.js:239`

---

### BLOCKER 3 — Deposit Frontend: No customer USDT top-up page

**Finding:** `apps/web/src/app/satelink/os/billing/page.tsx` exists but is a **Node Operator Dashboard** (shows `getNodeEarnings`, `claimEarnings`, epoch countdown). It has zero deposit/top-up functionality. There is no page in `apps/web/src/app/` that lets a machine or human customer call `/credits/deposit/initiate` and submit the resulting calldata.

**Fix required:** Create `apps/web/src/app/satelink/os/billing/deposit/page.tsx` with:
- Input: USDT amount
- Calls `GET /credits/deposit/initiate?amount=<n>` 
- Displays `approveCalldata` and `depositCalldata` with copy buttons
- Shows vault address, chain (Polygon Mainnet 137), gas estimates
- Secondary: wallet-connect flow to sign+submit directly (nice-to-have, not P0)

**Files:** `apps/web/src/app/satelink/os/billing/page.tsx` (wrong content), missing deposit subpage
