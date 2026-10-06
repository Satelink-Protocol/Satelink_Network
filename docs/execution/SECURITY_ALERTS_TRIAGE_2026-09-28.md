# Security alerts triage — 2026-09-28 (B8)

Source: GitHub Dependabot, code scanning and secret scanning APIs, open alerts on `main` @ 7b402f9.
Read-only triage; fixes in PR `fix/deps-security-high`.

## Counts (286)
| Tool | Critical | High | Medium | Low | Total |
|---|---|---|---|---|---|
| Dependabot | 2 | 54 | 62 | 12 | 130 |
| CodeQL | 2 | 143 | 10 | 0 | 155 |
| Secret scanning | – | – | – | – | 1 |

## Headlines
1. **No critical alert affects production.** Dependabot criticals = `next` in `apps/cms` (not a workspace, not deployed;
   production web/console/corporate already run `next` 15.5.24). CodeQL criticals (`js/code-injection`) are in EJS views
   rendered only by `createUIRouter`/`createDashboardRouter`, which nothing mounts (dead code).
2. **The 148 JavaScript CodeQL alerts are a frozen snapshot** (last seen at `1b2d0ca`, 2026-04-05): the JS/TS CodeQL
   analysis no longer runs on `main` (recent analyses cover `/language:actions` only); 58 point at deleted files.
   → Re-enable JS/TS CodeQL on `main`, then re-triage. Not a live signal today.
3. **Real production exposure = high transitive alerts in the root lockfile.** Fixed in this PR except where noted.

## Fixed in `fix/deps-security-high` (lockfile + overrides, all patch/minor)
| Alerts | Package | Before → after | Reached from (production) |
|---|---|---|---|
| 675, 678, 721, 737, 739, 740 | fast-uri | 3.1.2 → 3.1.8 | api `@x402/extensions` → ajv; mcp-server |
| 725 | ip-address | 10.2.0 → 10.7.2 | api `express-rate-limit` (in front of /rpc) |
| 735 | nanoid | 3.3.16 → 3.3.19 | `next` → postcss |
| 741, 763 | immutable | 3.8.3 → 3.8.4 | web `swagger-ui-react` |
| 589, 593, 594, 8, 690, 731, 757, 11 (web part) | minimatch / js-yaml / serialize-javascript via mocha 8.1.3 | `mocha` moved from web `dependencies` → `devDependencies` (never imported or run by web) | web |

`npm ls --all --package-lock-only` shows **no new** invalid/missing entries vs main (both carry the same pre-existing set).

## Not fixed — needs a decision or a full lockfile regeneration
| Alert | Package | Why not in this PR | Proposal |
|---|---|---|---|
| 663 (high) | axios 1.16.0 nested exact pin in `@coinbase/cdp-sdk` 1.51.2 (x402) | the fixing cdp-sdk (1.57.0) requires `@x402/*` ^2.25.0; api pins `@x402/evm` **2.18.0 exactly** (#332, guarded by `x402_dependency_skew.test.js`) → bumping would skew the live x402 rail | coordinated x402 upgrade PR (all `@x402/*` + cdp-sdk) with a mainnet paid-call smoke — **money path, founder merge** |
| 636 (high) | ws 8.18.0 nested exact pin in `@ethersproject/providers` (via `@openzeppelin/defender-sdk`) | root override `ws ^8.21.0` exists but lock-only regeneration does not re-resolve exact nested pins | full `npm install` regeneration in a clean checkout, or drop defender-sdk if unused |
| 700, 701 (high) | postcss 8.4.31 nested exact pin in `next` | same; build-time only (not in the served runtime) | wait for `next` to bump, or full regen with `overrides.next.postcss` |
| 679, 754 (high) | sharp 0.34.5 (optional, next image optimizer) | 0.35 is a 0.x minor = breaking; native binary | separate PR with a Vercel preview check |
| brace-expansion ×10, js-yaml 691/730/760 | via yamljs/glob, ejs→jake, stale `apps/dashboard` lock entry | patterns are fixed strings in code (low real risk); stale workspace entries (`apps/dashboard`, `apps/docs`, `apps/status`) remain in the lock | full lockfile regeneration PR |
| 707, 708, 710 | undici | dev-only (`services/financial` → testcontainers) | none |

## Code scanning — critical/high worth acting on
| Rule | Where | Action |
|---|---|---|
| js/code-injection (C ×2) | `apps/api/src/gateway/views/distributor.ejs:15`, `operator.ejs:23` — dead views | delete dead views + routers (H2 cleanup) |
| js/insufficient-password-hash (H) | `apps/api/src/gateway/routes/auth_v2.js:112` — **mounted**, `PASSWORD_SALT` + fast hash | scrypt/argon2 if this route still issues logins; else unmount |
| js/clear-text-logging (H ×8) | `server.js`, `pg_adapter.js`, `job_producer.js`, `validateEnv.js` (April line numbers) | re-check on current code after re-enabling CodeQL |
| js/insecure-randomness (H) | `core/operations_engine.js:270` | `crypto.randomUUID()` |
| js/missing-rate-limiting (H ×117) | mostly unmounted route files | rate-limit mounted auth/admin routers; dismiss dead |
| actions/missing-workflow-permissions (M ×7) | `ci.yml`, `architecture.yml` | add `permissions: contents: read` |

## Secret scanning
1 open: **Slack Incoming Webhook URL**, opened 2026-05-17, validity unknown, in `SATELINK_ECOSYSTEM_SETUP_PROMPT.md:208`
(commit `3d4a547`). → FOUNDER: revoke the webhook in Slack, then resolve the alert as "revoked" (it stays in git history).

## Everything else
`apps/cms` (not deployed): 17 critical/high + 20 medium/low — one `next` bump clears most if cms is ever deployed.
Production medium/low: 30 medium (hono, @hono/node-server, axios, dompurify, ip-address, js-yaml, postcss, qs, uuid, ws)
+ 5 low (body-parser, debug, diff, elliptic, hono) — most close with the full lockfile regeneration above.
