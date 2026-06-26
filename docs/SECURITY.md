# Satelink Security
Last verified: 2026-06-26. Combines the public responsible-disclosure policy with the internal
auth/secrets/incident reference.

---

## Part 1 — Responsible Disclosure (public)

**Do NOT open a public GitHub issue for security vulnerabilities.** Email
`security@satelink.network` (48h acknowledgement, 7d triage). Include: description, repro steps,
impact, optional fix.

**In scope:** smart contracts (NodeRegistryV2, SplitEngine, RevenueVault, RevenueDistributor,
ClaimsContract, ClaimsWithdrawals, EpochAnchor, EligibilityPolicy, GovernanceTimelock), node
edge agent, API authn/authz, settlement & claims flows, epoch anchoring / Merkle verification.
**Out of scope:** social engineering, physical access, third-party deps (report upstream),
test/mock contracts (MockUSDT), gas-limit DoS.

**Severity:** Critical = direct fund loss; High = protocol disruption / RBAC bypass;
Medium = limited/conditional; Low = informational. No formal bounty yet; safe harbor for
good-faith research. Contact: `security@satelink.network` · `hello@satelink.network` · discord.gg/satelink.

---

## Part 2 — Internal Security Reference

### Authentication
- **Admin routes (`/admin/*`):** `X-Admin-Token` == `ADMIN_SECRET_TOKEN` (`requireAdminAuth`,
  `apps/api/src/admin/admin_router.js`). No token / wrong token → 401. Missing env → 503.
- **User routes:** JWT (`requireJWT` / `requireRole`).
- **Frontend → admin:** `apps/web/src/app/api/admin-proxy/route.js` injects `ADMIN_TOKEN`
  server-side; the token never reaches the browser. Only `/admin/*` is forwarded (no open relay).

### Secrets handling
- `.env` files are **not** committed (only `.env.example`). Secrets live in Railway env.
- Never hardcode secrets — use `process.env`, hard-fail if missing.
- `/admin/config` returns key **names** and non-secret values only — never secret values.
- Read the admin token from `railway variables --service Satelink-api --kv` (table view truncates).

### Fixed in this branch (Phase 9b)
- **Admin-proxy token-prefix leak (was VERIFIED):** `admin-proxy/route.js` logged
  `token?.substring(0,6)` in two `console.log` statements. **Removed.** No token/credential is
  logged anymore.

### Open hygiene items (follow-ups, NOT done here)
- `admin-proxy/route.js` still has two non-credential debug logs, incl. one that logs the full
  **upstream admin response** (`console.log('[DEBUG Proxy] Upstream data:', data)`) into server
  logs — recommend removing (logs customer/revenue data, though not secrets).
- Backend has `console.log` across ~180 files (audit §9). A blanket sweep was **deliberately
  not done** on this branch: high-risk churn on the load-bearing API, unreviewable diff. Should
  be a separate, scoped change (convert error logs → `console.error`, drop debug logs, syntax-
  check each file).

### Settlement safety (financial)
- `SETTLEMENT_DRY_RUN=1` — never flip to 0 autonomously. Requires signer funded + real revenue
  > $0.50 + explicit human decision. Settlement is currently NOT broadcasting (signerBalance null).

### Known incidents
- **INC-013** (critical, resolved): signer drain — 1,878 phantom settlement TX. The `1,878 TX`
  figure is historical and must **never** appear as a fabricated live UI metric.
- **INC-014** (high, resolved): phantom billing — test/phantom volume counted as real revenue.
  Fixed by `is_test_data` filtering + phantom-epoch (`is_phantom`) exclusion.
- **INC-012** (high, resolved): Redis OOM.

### Database safety
- Never drop/truncate any table. Never delete `agent/memory/`. Read-only psql for inspection.
