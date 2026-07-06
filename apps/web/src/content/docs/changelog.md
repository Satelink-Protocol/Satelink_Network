Notable platform changes, newest first. Full detail lives in the
[commit history](https://github.com/Satelink-Protocol/Satelink_Network/commits/main).

## 2026-07 — Data truth & public platform overhaul

- Audited every dashboard metric against production; corrected inflated
  traffic counters, mislabeled revenue, and a vacuous health score at the API
  layer (see `docs/DATA_TRUTH_AUDIT.md` in the repository).
- Rebuilt the design system tokens; fixed a systemic transparent-surface bug;
  new canonical Modal and CopyField components with a `/design` render-check
  route.
- Launched this documentation portal (docs.satelink.network) replacing the
  GitHub-Wiki redirect; added sitemap, robots, llms.txt, JSON-LD, and
  structured metadata across the site.
- Homepage refreshed to verified-only claims; roadmap rebuilt from repository
  truth; navigation and mobile menu fixed.

## 2026-06/07 — Onboarding & vault migration

- **RevenueVault V2** deployed (`0x577D…aCEF`) with permissionless deposits;
  deposit listener migrated.
- One-click MetaMask sign-to-create API keys; wallet-bound deposit guard;
  live deposit history.
- Self-contained HTTP 402 machine onboarding: calldata endpoint, real
  minimum, copy-paste examples; `POST /v1/machine/register`.
- Native eRPC provider adapter (`satelink://` URL scheme).

## 2026-06 — Admin command center & observer API

- 18 read-only observer endpoints for the operator NOC (executive summary,
  revenue, demand, network health, treasury, customers, observability).
- Demand radar: traffic classification (developer / machine / scanner) and a
  conversion funnel.

## 2026-05 — Machine access foundation & OS shell

- Machine Access control plane scaffold: hashed token storage, scoped auth,
  audit chaining, replay protection.
- Satelink OS console shell with realtime infrastructure views.

## Earlier

- Core economic engine: RPC gateway with per-call USDT metering, credit
  system, epoch ledger, settlement batch pipeline, and the first verified
  on-chain USDT claim on Polygon mainnet.
