# FRONTEND EXECUTION PLAN
# Generated: 2026-06-04 — Complete audit of apps/web/src/app/satelink/os/*
# Auditor: curl-verified against https://app.satelink.network and https://rpc.satelink.network

---

## AUDIT SUMMARY

All pages return HTTP 200. The problems are **data wiring, wrong contract addresses, and missing flows** — not broken builds.

### Contract address mismatch (CRITICAL)
- **RevenueVault (correct):** `0x80AFEaC3B77CbeC1f7B9f24a50319DC72785DdA3` — returned by `/credits/initiate`
- **Treasury hardcode (wrong):** `0x966E1Ae22996545015b1414B35234b10719d7Ad4` — used in plans/page.tsx and treasury/page.tsx
- Customers who deposit via the Plans page send USDT to the WRONG address.

---

## BROKEN PAGES (fix immediately — dead endpoints or wrong contract)

| Page | What is broken | File | Fix description | Effort |
|------|---------------|------|-----------------|--------|
| `/satelink/os/overview` | Calls `/dashboard-api/network/overview` → 404 and `/dashboard-api/earnings/overview` → 404. Revenue and node metrics show null | `apps/web/src/app/satelink/os/overview/page.tsx:174-176` | Replace with `/api/status` (nodes, epoch, requests) and `/api/epochs` (revenue). Both endpoints are live | 1h |
| `/satelink/os/overview` | Epoch counter shows `closed.length + 1` — wrong; real epoch is 13517 from API | `overview/page.tsx:203` | Read `current_epoch` from `/api/status` response | 30min |
| `/satelink/os/overview` | EpochRow `requests` hardcoded as `'0'` | `overview/page.tsx:318` | Wire `e.requests` from epoch data | 15min |
| `/satelink/os/plans` | Deposits sent to `TREASURY = 0x966E1...d4` — WRONG address. Should be RevenueVault `0x80AF...A3` | `plans/page.tsx:7` | Replace constant with value from `/credits/initiate` response or hardcode correct RevenueVault address | 30min |
| `/satelink/os/treasury` | Hardcoded `TREASURY_ADDRESS = 0x966E1...d4` — this is not the RevenueVault collecting customer deposits | `treasury/page.tsx:5` | Show BOTH addresses: treasury wallet and RevenueVault. Label them correctly | 1h |

---

## DATA NOT WIRED (showing fake/hardcoded data)

| Page | What data is fake | Correct API endpoint | Fix | Effort |
|------|------------------|---------------------|-----|--------|
| `analytics/page.tsx:248` | "Rate (current): $0.89/hr" is hardcoded | Compute from `/api/epochs` total / epoch count × 60 | Dynamic calculation | 30min |
| `billing/page.tsx` | This is the **Node Operator Dashboard** — uses hardcoded `DEFAULT_NODE_ID = "NODE-ap-south-1-a09becbb"`. Customer credits not shown anywhere | N/A | Rename this page to "Node Earnings". Create a real Billing page showing credit balance and transaction history | 3h |
| `withdraw/WithdrawClient.tsx:10` | `NODE = 'NODE-ap-south-1-a09becbb'` is hardcoded — operator must type their own node ID | N/A | Remove hardcoded NODE; require user to enter or derive from localStorage | 1h |
| `api-keys/page.tsx` | Static info page with "API key management coming soon" text. `setLoading(false)` immediately — no API calls at all | `POST /api/keys` | Wire actual key creation and listing. Endpoint returns 404 on GET but POST may work — test first | 4h |
| `overview/page.tsx:184` | `totalReqs` always 0 because `/rpc/metrics` returns `rpcGateway.totalRequestsToday: 0` | `/api/status` returns `total_requests_24h: 79812` | Use `/api/status` for request count | 30min |

---

## MISSING PAGES (need to be created)

| What page | Why needed | User journey | Effort |
|-----------|-----------|--------------|--------|
| Customer Credit Balance | After deposit, customer has no way to see their credit balance. No page shows `GET /credits/balance` or equivalent | Journey 1: deposit → verify | 2h |
| Node Registration Flow | Nodes page shows "No nodes registered yet" with no way to register. No link, form, or guide | Journey 2: register node | 4h |
| Node Quickstart Guide | Node operators need: download daemon, configure, start, verify heartbeat. No docs from dashboard | Journey 2: start node | 3h |

---

## NAVIGATION GAPS

| What link is missing | Where it should go | Effort |
|----------------------|-------------------|--------|
| "Deposit" CTA in top header | Add alongside "Claim USDT" button in `os-shell.tsx:264` | 20min |
| "Check balance" link on deposit confirmation | After user gets calldata instructions in `deposit/page.tsx:186` | 20min |
| "What happens next" explanation on deposit page | After instructions shown: "Credits appear in 1–3 Polygon blocks (~30s)" | 30min |
| "Register a node" button on nodes page empty state | `nodes/page.tsx:112` | 30min |
| "Get started" CTA on `/satelink` landing | New visitors land on marketing page with no clear first action | 1h |

---

## QUICK WINS (< 2 hours each, high user impact)

Ordered by impact/effort ratio — do these first:

1. **Fix Plans page contract address** (30min) — Change TREASURY constant to RevenueVault address. Stops sending customer money to wrong address. **MONEY RISK.**
2. **Fix Overview API endpoints** (1h) — `/dashboard-api/*` → `/api/status` + `/api/epochs`. Makes primary dashboard show real data immediately.
3. **Fix epoch counter on Overview** (30min) — Use `status.current_epoch` from `/api/status`.
4. **Wire RPC request count on Overview** (30min) — Use `/api/status` → `total_requests_24h`.
5. **Add "Deposit" button to top header** (20min) — `os-shell.tsx` already has "Claim USDT" button; add "Deposit" next to it.
6. **Add "What happens next" to deposit page** (30min) — After calldata shown, explain: "Credits appear in ~30s after TX confirms. Use header `X-Wallet-Address: <your-wallet>` on RPC calls."
7. **Add "Check my balance" link after deposit** (20min) — Link to billing page (once billing shows credit balance).
8. **Fix analytics hardcoded rate** (30min) — Calculate dynamically from epoch history.

---

## EXECUTION ORDER

### P0: Must fix before any customer outreach (broken flows / money risk)

| # | Item | File | Why P0 |
|---|------|------|--------|
| P0-1 | Fix Plans page deposits to correct RevenueVault address | `plans/page.tsx:7` | Customers sending USDT to wrong address |
| P0-2 | Fix Overview page broken API endpoints | `overview/page.tsx:174-176` | Primary dashboard shows nothing |
| P0-3 | Fix Treasury page to show RevenueVault address | `treasury/page.tsx:5` | Misleads operators about where deposits go |
| P0-4 | Fix epoch counter and request count on Overview | `overview/page.tsx:203, 318` | Core metrics are wrong |

### P1: Must fix for first paying customer journey

| # | Item | File | Why P1 |
|---|------|------|--------|
| P1-1 | Add "Deposit" to top header nav | `os-shell.tsx:264` | Deposit is the money-in action; must be instantly visible |
| P1-2 | Add "What happens next" + balance link to deposit page | `deposit/page.tsx:186` | Customer has no confirmation path after submitting TX |
| P1-3 | Build real Billing page (credit balance + tx history) | `billing/page.tsx` (rewrite) | Customer cannot verify their deposit worked |
| P1-4 | Wire API Keys page to actual key creation | `api-keys/page.tsx` | Customer cannot get a key after depositing |
| P1-5 | Fix analytics hardcoded rate | `analytics/page.tsx:248` | Shows wrong revenue rate |

### P2: Must fix for node operator journey

| # | Item | File | Why P2 |
|---|------|------|--------|
| P2-1 | Add node registration flow to nodes page | `nodes/page.tsx` | No way to register a node from dashboard |
| P2-2 | Remove hardcoded NODE_ID from withdraw page | `withdraw/WithdrawClient.tsx:10` | Only works for one hardcoded node |
| P2-3 | Create Node Quickstart Guide page | New page or `/satelink/os/docs` | Operators need setup instructions |

### P3: Polish

| # | Item |
|---|------|
| P3-1 | Add "Get started" CTA on `/satelink` landing page |
| P3-2 | Add node registration CTA to empty state on nodes page |
| P3-3 | Remove "coming soon" from API Keys page |

---

## USER JOURNEY BREAKS (exact step where each breaks)

### Journey 1 — New machine customer
```
Visit site ✓
Understand what Satelink is ✓ (basic)
Get RPC endpoint URL ✓ (shown on api-keys page)
Hit free tier limit ⚠ (no UX feedback when limit hit)
Deposit USDT ✓ (deposit page works and returns correct RevenueVault address)
Check credits ✗ BREAKS — no page shows customer credit balance
Add wallet header ✓ (deposit page explains X-Wallet-Address header)
Start paid calls ✓ (if credits loaded)
```

### Journey 2 — New node operator
```
Visit site ✓
Understand earning model ⚠ (no docs from dashboard, only README)
Register node ✗ BREAKS — nodes page has no registration form
Start node ✗ BREAKS — no quickstart guide linked from dashboard
See earnings ✓ (billing page works if node ID entered manually)
Withdraw USDT ✓ (withdraw page has wallet connect)
```

### Journey 3 — Developer
```
Visit site ✓
Get API key ✗ BREAKS — api-keys page says "API key management coming soon"
Read docs ✓ (/satelink/os/docs exists)
Integrate ✓ (example curl on api-keys page)
Monitor usage ✗ BREAKS — no per-key analytics
Upgrade plan ✓ (plans page exists and works)
```

---

## PAPERCLIP ISSUE SPECS (P0 and P1)

### P0-1: Fix wrong contract address in Plans page
- **Issue title:** `fix(plans): send deposits to RevenueVault not treasury wallet`
- **Assigned to:** ENGINEERING_COMMANDER
- **File:** `apps/web/src/app/satelink/os/plans/page.tsx:7`
- **Change:** Replace `const TREASURY = '0x966E1Ae22996545015b1414B35234b10719d7Ad4'` with `const REVENUE_VAULT = '0x80AFEaC3B77CbeC1f7B9f24a50319DC72785DdA3'` and update all references in the file
- **Success criteria:** Plans page shows `0x80AF...` as deposit address (matches `/credits/initiate` response)
- **Verify:** `curl https://rpc.satelink.network/credits/initiate?amount=1 | jq .revenueVaultAddress` must match address shown in Plans deposit modal

### P0-2: Fix Overview page broken API endpoints
- **Issue title:** `fix(overview): replace dead dashboard-api/* calls with working endpoints`
- **Assigned to:** ENGINEERING_COMMANDER
- **File:** `apps/web/src/app/satelink/os/overview/page.tsx:174-176`
- **Change:**
  - Replace `useSWR('/dashboard-api/network/overview', ...)` → `useSWR('/api/status', ...)`
  - Replace `useSWR('/dashboard-api/earnings/overview', ...)` → `useSWR('/api/epochs', ...)`
  - Map: `networkStats.active_nodes` → `status.nodes_online`, `networkStats.total_revenue` → sum of epoch revenues, `totalReqs` → `status.total_requests_24h`
- **Success criteria:** Overview shows real epoch number (~13517), real 24h request count (~79K), revenue from epochs
- **Verify:** `curl https://rpc.satelink.network/api/status` data appears on overview dashboard

### P0-3: Fix Treasury page address
- **Issue title:** `fix(treasury): show RevenueVault address alongside treasury wallet`
- **Assigned to:** ENGINEERING_COMMANDER
- **File:** `apps/web/src/app/satelink/os/treasury/page.tsx:5-6`
- **Change:** Add `REVENUE_VAULT_ADDRESS = '0x80AFEaC3B77CbeC1f7B9f24a50319DC72785DdA3'` constant. Show as primary "Customer Deposits" address. Rename existing address to "Platform Treasury". Fetch USDT balance for RevenueVault.
- **Success criteria:** Treasury page shows RevenueVault with Polygonscan link to `0x80AF...`
- **Verify:** `https://polygonscan.com/address/0x80AFEaC3B77CbeC1f7B9f24a50319DC72785DdA3` — must be linked

### P1-1: Add Deposit button to header
- **Issue title:** `feat(shell): add Deposit CTA button to top navigation header`
- **Assigned to:** ENGINEERING_COMMANDER
- **File:** `apps/web/src/components/satelink/os-shell.tsx:264`
- **Change:** Add `<Link href="/satelink/os/deposit"><button>Deposit USDT</button></Link>` next to existing "Claim USDT" button. Use green border style to differentiate from Claim.
- **Success criteria:** Deposit button visible in top header on all OS pages
- **Verify:** `curl -o /dev/null -w "%{http_code}" https://app.satelink.network/satelink/os/overview` → 200; button present

### P1-2: Add post-deposit guidance
- **Issue title:** `feat(deposit): add balance check link and tx confirmation guidance`
- **Assigned to:** ENGINEERING_COMMANDER
- **File:** `apps/web/src/app/satelink/os/deposit/page.tsx:186`
- **Change:** After Polygonscan link, add panel: "After both transactions confirm (~30 seconds / 2 Polygon blocks), your credits are available. [View your credit balance →]"
- **Success criteria:** After getting deposit instructions, user sees next-step guidance with link to /satelink/os/billing
- **Verify:** Visit deposit page, enter amount, click get instructions — guidance appears below Polygonscan link

### P1-3: Build real Billing page
- **Issue title:** `feat(billing): replace node operator dashboard with customer credit balance page`
- **Assigned to:** ENGINEERING_COMMANDER
- **File:** `apps/web/src/app/satelink/os/billing/page.tsx` (full rewrite)
- **Change:** Remove node operator dashboard. Add: wallet address input → credit balance lookup via API → deposit transaction history → "Top up" link to deposit page. Keep node earnings as a separate section or move to withdraw page.
- **Success criteria:** Billing page shows credit balance for a given wallet address. "Top up" button links to deposit page.
- **Verify:** Enter a wallet address that has deposited → balance shown (even if $0 shows correctly)

---

## LIVE API ENDPOINTS (curl-verified 2026-06-04)

```
GET /api/status          → { status, nodes_online: 0, current_epoch: 13517, total_requests_24h: 79812 }
GET /api/epochs          → { epochs: [...20 epochs...] } (most with $0 revenue, some with small amounts)
GET /api/nodes           → { nodes: [] } (0 nodes registered)
GET /rpc/metrics         → { chains: { polygon: {latency: 23ms}, ethereum, arbitrum, base, solana, polygon-amoy } }
GET /credits/initiate?amount=1 → { revenueVaultAddress: "0x80AFEaC3B77CbeC1f7B9f24a50319DC72785DdA3", ... }
GET /dashboard-api/*     → 404 (ALL dead — overview page depends on these)
GET /api/keys            → 404
```

---

*Written by frontend audit agent 2026-06-04. Source of truth for P0/P1 fixes.*
