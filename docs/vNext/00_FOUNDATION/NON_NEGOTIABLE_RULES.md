# Non-Negotiable Rules

> These bind every vNext contributor, human or agent. Operational rules carried over from the live system remain in force — vNext does not suspend production safety.

## Financial safety

1. **Outbound payments are capped in code, not in policy.** Per-request cap, rolling per-hour cap, per-day cap, and a total-wallet-balance floor. Caps live in config with safe defaults; raising them is a human decision recorded as an ADR.
2. **Spread non-negativity by construction.** The pricing engine may never quote a downstream price below (upstream cost + minimum margin). Floor: the CDP facilitator rejects amounts below $0.001 [measured 2026-07-09, `apps/api/src/payments/x402/config.js` comment].
3. **`SETTLEMENT_DRY_RUN=1` stays** for the legacy Polygon anchor path. Never set to 0 autonomously. Unchanged from legacy rules; vNext outbound x402 payments are a *separate, new* path with its own caps and its own kill switch (`VNEXT_OUTBOUND_ENABLED`, default `false`).
4. **Every ledger row carries `is_test_data`** correctly [code: enforced since PR #268]. Founder wallets are always flagged [code: `apps/api/src/payments/founder_wallets.js`]. No fabricated numbers anywhere, ever — no exceptions for demos.

## Scope

5. **Never modify `contracts/`** or any `.sol` without explicit human instruction. vNext requires zero new contracts (see ADR-003).
6. **Never touch Railway env vars autonomously.** New env vars ship with defaults-off and are enabled by a human.
7. **Never drop or truncate Postgres tables.** vNext tables are new tables; legacy tables are left in place.
8. **Never edit, rename, or delete legacy docs.** vNext lives entirely under `docs/vNext/`. Legacy docs are referenced (read-only) via `../archive-index/LEGACY_MAP.md`.

## Engineering

9. **Additive mounting only.** New routers mount in `apps/api/app_factory.mjs` alongside existing ones. Deleting or refactoring existing mounts requires the migration checklist in `../03_ENGINEERING/MIGRATION_PLAN.md`.
10. **No new failure in the test baseline.** Baseline: 128 passing / 9 known-failing [measured 2026-07-16; run `npx mocha --no-config --exit 'test/**/*.test.js'` in `apps/api`]. Any new failure is a regression and blocks merge.
11. **Deploy = merge to `main`.** `railway up`/`redeploy` do not ship local code [measured, memory: railway-api-deploy-mechanism]. Never push to `main` directly; PRs only.
12. **Stage files individually** (never `git add -A`); never commit to `add-satelink-polygon-rpc`.

## Ecosystem conduct

13. **Join without changing economics.** Satelink pays suppliers their listed price via their chosen rail. No renegotiation, no custom deals, no terms-of-service violations. If an upstream forbids resale, that supplier is excluded (recorded in `../02_MARKET_VALIDATION/MARKET_REJECTION_LOG.md`).
14. **Degrade honestly.** If no supplier passes health checks, return the rail's native failure (HTTP 502 with no charge), never a silent fallback that charges for nothing.

## Truth

15. **Every claim tagged** `[code]`, `[measured <date>]`, `[protocol]`, or `UNKNOWN`. "UNKNOWN" is an acceptable, permanent answer; a guess is not.
16. **`1,878 TX` is a historical fact (INC-013)** and must never appear as a live metric. Kept here because rules only die when the repo dies.
