# Stage 25 — Agent-first console

**Branch:** `trading-agent/stage-25-console` (PR #480), stacked on Stage 24 (#479).

**State:** built and tested behind **`CONSOLE_AGENT_IA`** (default off; off ⇒ today's console, unchanged).

**Code** (`apps/console`):
- `src/lib/trading/`: flags, nav, states, client, guard;
- `src/components/trading/parts.tsx`;
- `src/app/(console)/trading/**` (12 pages + server actions) and `src/app/(console)/security/page.tsx`;
- small flag-guarded edits to `components/Shell.tsx`, `(console)/layout.tsx` and `(console)/page.tsx`.

**Tests:**
- `apps/console/test/trading-console.test.tsx` (vitest, new `test` script);
- `apps/console/e2e/trading-paper.spec.ts` (Playwright, paper);
- harness `apps/api/test/harness/trading_console_harness.mjs`.

**Evidence:** screenshots in `docs/trading-agent/stages/25-console/`.

**DB:** none. **API:** consumes Stage 24 `/v1/trading/*`, server-side only.

## Inspection, STOP and founder decisions

> STOP if: legacy pages are in active customer use (per audit/03) — founder decision.

**Triggered, then resolved by the founder (2026-10-06).**
- Audit 03 marks the console (`console.satelink.network`) as the **live, canonical customer UI**. Its `/rpc` and `/x402` pages are KEEP, and `/keys`, `/requests` and `/usage` are REUSE, all for the customer audience. Together they are the live RPC-gateway product.
- The founder chose **Option 1**: an agent-first nav behind a flag, with those pages **kept** under a "Developer & payments" group rather than hidden.
- The founder also asked me to **define the five-layer rule myself** (below). It isn't defined in the repo or the audits, and probably lives in the unavailable "Document A".

**Legacy surfaces:**
- **In the console:** no DePIN or marketplace item exists in today's console nav, and none is added. Every existing console page is kept; a test checks they all still exist.
- **Outside the console:** the public site's footer link "Network (run a node)" (CMS navigation) and the reachable `/node*`, `/network*`, `/builder*` and `/distributor*` pages are in `apps/web`. That is outside this stage's allowed paths (console dashboard + flagged nav config), so it is recorded as a follow-up (audit 03 L2, L3 and L7). Nothing was deleted.

**Positioning:** audit 03 open item 4 (Brokers / Positions / Orders vs "never takes custody" and "not a recommendation to trade") is respected in the copy:
- Brokers: "Satelink never holds your money — it stays with your broker";
- every trading page carries the "Not investment advice" disclosure;
- live trading is shown as off.

The legal/positioning review itself is still a founder item.

**Stage 24 dependency:** the API is **not registered** in production (founder decision, Option A). With `CONSOLE_AGENT_IA` on in production, pages would get a 404 and show "Trading Agent isn't switched on yet", never made-up data. The flag stays off.

## The five-layer rule (defined here; the founder asked me to define it)

Every agent-first screen must satisfy all five layers. Each item is tracked by a test.

| # | Layer | Rule | Tracked by |
|---|---|---|---|
| 1 | **Truth** | Every figure comes from the trading API. A missing, failing or unbuilt read (`501`) renders a designed empty/error state, never a placeholder number. Minor units are formatted exactly (no floats). | `ApiState` / `apiStateText` tests; `formatMinor` exactness; E2E "Not available yet" on Agent and Brokers; mutation "minor via float" caught |
| 2 | **Labels** | Anything not live and real says so next to the number: **Paper — simulated, no real money**, **Hypothetical — backtest on past data**; an unknown mode is treated as simulated. | `modeLabel` tests; `ModeBadge` render; E2E sees the paper badge on Home and on the order; mutation "paper label dropped" caught |
| 3 | **Plain language** | Machine states become sentences: "Confirming with Binance… We never send it twice while we check.", "Sending to Upstox…", "Cancelling with Alpaca…". Failures read as human states. Receipts name steps ("signed permission", "limit check"), never internal codes or stage numbers. State changes are announced (`role="status"`, `aria-live`). | `orderStateText` for every OMS status; `receiptText`; live-region render test; E2E watches NEW → "The simulator has your order — waiting for a fill" → "Cancelled"; mutation "unknown state raw" caught |
| 4 | **Safety & consent** | No secrets client-side: the trading client runs only on the console server and forwards the session cookie. Every mutation carries a server-generated Idempotency-Key and the CSRF header. The console can only ask for **paper** orders, and an explicit "I understand this is a paper order" box is required. Resuming trading needs a 6-digit step-up code. Every trading page shows "Not investment advice". No banned claims (truth-lint list). | static tests (no client import, no env/secrets in pages, `mode: "paper"` only, Idempotency-Key fields, banned phrases, disclosure on every page); E2E (unticked box blocks submit; wrong code refused, right code resumes); mutations "live mode from console" and "disclosure removed" caught |
| 5 | **Access** | Everything is behind `CONSOLE_AGENT_IA` (off ⇒ every `/trading/*` page and `/security` return 404, and the nav and Home are unchanged). Revenue is admin-only: hidden from the nav and a 404 for non-admins via a server-side allowlist (`CONSOLE_REVENUE_ADMIN_IDS`). Tenant scoping comes from the session (the Stage 24 API). | flag tests; every page calls `requireAgentIa()`; Shell renders today's nav when off; E2E `/trading/revenue` → 404 for a customer; **real flag-off run** (same build, flag unset): `/` 200 with today's nav, `/rpc` 200, all `/trading/*` and `/security` 404; mutations "flag default on", "page guard removed", "revenue gate removed", "revenue for everyone" and "shell ignores flag" caught |

## Information architecture

| Area | Route | Source |
|---|---|---|
| Home | `/trading` (and `/` redirects there when the flag is on; the old overview is kept) | `/status`, `/kill-switch`, `/positions` |
| Agent | `/trading/agent` | `/status` (MCP on/off); `/proposals` (501 → "Not available yet"; review queue = B-02) |
| Markets | `/trading-intelligence` (existing page, REUSE per audit 03) | existing |
| Strategies | `/trading/strategies` | no list endpoint yet → honest empty state; result labels explained |
| Risk | `/trading/risk` | `/risk/policy`, `/kill-switch`; **Pause all trading** (engage) and **Resume** (step-up code) |
| Brokers | `/trading/brokers` | static, true state of Stages 21–23 (test network / sandbox only; "Not available yet") |
| Positions | `/trading/positions` | `/positions` (exact minor units, mode badge) |
| Orders | `/trading/orders`, `/trading/orders/[id]` | place a **paper** order (`POST /orders`); order state in plain language; cancel; "Why did Satelink do this?" receipt |
| Executions | `/trading/executions` | no fills list yet → honest empty state |
| P&L | `/trading/pnl` | `/portfolio/snapshots` (unrealised result hidden when prices are incomplete; no performance claims) |
| Activity | `/trading/activity` | `/kill-switch`; full timeline not built → honest empty state |
| Billing | `/billing` (existing) | existing |
| Security | `/security` (new) | session (2-step status); links to sessions and keys |
| Settings | `/settings` (existing) | existing |
| Revenue (admin) | `/trading/revenue` | admin allowlist; shows "Revenue booking is paused" (Stage 20 stopped); no figures |
| Developer & payments | `/keys`, `/requests`, `/usage`, `/rpc`, `/x402` (existing, kept) | existing |

Mobile tabs (flag on): Home, Agent, Orders, Risk, plus More.

## Test evidence (2026-10-06)

| Suite | Result |
|---|---|
| `apps/console` vitest (`npm test`) | **14 passing**: flags, IA coverage (14 areas + admin Revenue, every link has a page, unique shortcuts), Option 1 (RPC/x402/keys/requests/usage kept; no DePIN/marketplace; legacy pages exist), page guards, every OMS state sentence, receipts, API states, labels, exact minor units, server-rendered components, Shell flag on/off, static safety and claims |
| Paper E2E (Playwright, production build + harness) | **4 passing**: (1) Home nav, paper badge, disclosure, axe; (2) paper order end to end: unticked box blocks, then accepted → "The simulator has your order — waiting for a fill" → cancel → "Cancelled", receipt complete, nav highlights Orders only, axe; (3) pause, wrong code refused, right code resumes, axe; (4) honest empty states, Revenue 404 for a customer, `/rpc` kept, phone layout with no horizontal scroll |
| Flag-off run (same build, flag unset) | `/` 200 with today's nav; `/rpc` 200; `/trading`, `/trading/orders`, `/trading/risk`, `/security` → 404 |
| Mutation checks (11) | all caught (listed in the five-layer table) |
| `next build` | passes; no TypeScript errors in `src/` (the existing `e2e/sign-in.spec.ts` duplicate-playwright-types error is pre-existing and unrelated) |
| `apps/api` trading suites | **361 passing, 3 pending** (unchanged) |
| `scripts/ci-baseline-check.sh` | clean run **869 / 746 / 2 known / 121 pending**. Flakiness, reported honestly: 2 of 3 runs failed `identity_rate_limit` cases (the timing flake noted since Stage 12; that suite passes alone, and this stage adds only an unloaded harness file to `apps/api`) |

**Screenshots** (`docs/trading-agent/stages/25-console/`):
- `01-home.png`, `02-orders-form.png`, `03-order-acknowledged.png`, `04-order-cancelled.png`;
- `05-risk-paused.png`, `06-agent.png`, `07-brokers.png`, `08-home-phone.png`.

### Running the paper E2E

```sh
(cd apps/api && PORT=3419 node test/harness/trading_console_harness.mjs) &
cd apps/console && CONSOLE_AGENT_IA=true npx next build && \
  (CONSOLE_AGENT_IA=true SATELINK_API_BASE=http://127.0.0.1:3419 npx next start -p 3418 &) && \
  TRADING_E2E=1 PW_BASE_URL=http://localhost:3418 npx playwright test e2e/trading-paper.spec.ts
```

The harness binds `127.0.0.1` only. It serves a fixed test session (`satelink.session_token=e2e-alice`) and mounts the **real** Stage 24 router over in-memory Stage 13/15/17/19 services, with the Stage 10 MockBroker as the venue. Everything is paper; nothing external is called.

## Blocker impact

| Blocker | Touched? | Why the stage stays inside the accepted isolation |
|---|---|---|
| B-03 / B-06 / B-10 | no change | the console only calls an API that stays unregistered (Option A); the flag stays off; nothing is deployed |
| B-02 (no approval UI) | yes, **not resolved** | Agent suggestions and approval show "Not available yet". Admin Revenue uses an interim server allowlist, not staff auth |
| B-09 (scope / legal) | yes, **not resolved** | broker and position copy avoids custody and advice claims; the positioning review (audit 03 item 4) remains with the founder |
| others | no | |

No blocker changes status. The Stage 25 row is added to the acceptance log in `docs/trading-agent/BLOCKERS.md`.

## Follow-ups (not in this stage)

- **Public site (`apps/web`):** hide the footer "Network (run a node)" link and gate the `/node*`, `/network*`, `/builder*` and `/distributor*` surfaces (audit 03 L2, L3, L7). Fix the node-operator earnings claims (audit 03 C1–C6, founder item).
- **Read models the console still lacks:** order list, fills, strategies list, activity timeline, proposal review queue (B-02).
- **Staff auth** for admin Revenue (replace the interim allowlist).
- **Turn the flag on per environment** only after the Stage 24 API is registered (B-03/B-06/B-10).

## Rollback

Set `CONSOLE_AGENT_IA` off (the default): the console is exactly today's. Or revert the commit; nothing was deleted or migrated.
