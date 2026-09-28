# VERIFICATION_MATRIX

Only PROD-VERIFIED counts toward completion. Completion now: 6 / 89 = 6.7% (updated 2026-09-28 06:20 IST).

| ID | Requirement | UI | Backend | Data | Tests | PR | Deployed | Prod-verified | Evidence | Status | Blocker |
|---|---|---|---|---|---|---|---|---|---|---|---|
| A1 | Evidence-backed root cause of "merged but V1 in production". |  |  |  |  |  |  |  | root cause fixed by FG-FLAG flip | DEPLOYED | signed-in prod screenshot pending |
| A2 | Console, web, admin, docs Vercel projects serve `main` HEAD (SHA proof). | | | | | | | | | IN PROGRESS | 3 Vercel + Railway == main 4b2865f; docs/admin have no Vercel project |
| A3 | Railway `Satelink-api` serves `main` HEAD; migrations through latest applied (list proof). | | | | | | | | | IN PROGRESS | Railway == main; migrations 017–019 pending (FG-MIG) |
| A4 | Flag inventory: exact names from code, where read (build/runtime), value per environment. | | | | | | | | | IN PROGRESS | names+read sites+values captured (EXECUTION_STATE) |
| A5 | UI flags enabled in production after preview proof, rollback documented. |  |  |  |  |  |  |  | Railway+Vercel flipped 22:16Z; probes 404→401 / 404→403 | DEPLOYED | signed-in prod Playwright pass needs founder session |
| A6 | Money flags prepared as FOUNDER-GATE with ordered commands and post-flip verification scri… |  | FOUNDER_GATES 2026-09-28 (code names verified) |  |  | #451 | 0187b45 |  | FOUNDER_GATES §money flags | FOUNDER-GATE:FG-SUBS/FG-PLANV2 | needs #449 merged + allowlist set |
| B1 | `cloudflare_Example Usage` token: FOUNDER-GATE rotate → then delete variable → verify gone… |  | var absent on Satelink-api (exact-name lookup 2026-09-28) |  |  |  |  |  | CONFLICT_REGISTER C-18 | BLOCKED:founder to confirm old token revoked | old-token test impossible (no copy) |
| B2 | Exposed keys: rotate 3 funded first (FOUNDER-GATE), plan for remaining 48 active, redactio… |  | 3 funded exposed keys = founder-owned (12, 29, 132); redaction dry-run 0 rows |  |  |  |  |  | evidence/funded-exposed-keys-2026-09-28.txt, redact-dryrun-2026-09-28.txt | FOUNDER-GATE:FG-KEYROT | founder rotates own keys; 1 external email notice drafted |
| B3 | No full API key in any log path (code grep + prod log count proof). | | | | | | | | | NOT STARTED |  |
| B4 | TI charge-after-success live; past failed-call refunds confirmed (amount + key count). |  |  |  |  |  |  |  | post-flip smoke: RPC charged once on success; TI 503 uncharged (evidence/smoke-postflip-2026-09-28.txt); #429+#438 | PROD-VERIFIED |  |
| B5 | Refund ledger `kind` constraint fixed in production DB. |  |  |  |  |  |  |  | schema_migrations 19 + rolled-back refund insert (evidence/mig-017-019-after.txt); #430 merge 0547420 | PROD-VERIFIED |  |
| B6 | Dodo-funded value cannot pay RPC/x402 (negative test in prod with test key). |  |  |  |  |  |  |  | #439 35cb2b5; column live | DEPLOYED | ring-fence backfill FG-DODO-FENCE |
| B7 | Railway/Vercel env: list vars unread by code (names only) → removal proposals (gate). | | | | | | | | | NOT STARTED |  |
| B8 | Triage the 286 GitHub security alerts: fix critical/high in production deps via PRs; docum… |  | deps: fast-uri, ip-address, nanoid, immutable; web mocha→dev |  | CI | #450 |  |  | docs/execution/SECURITY_ALERTS_TRIAGE_2026-09-28.md | IN PROGRESS | axios needs coordinated x402 upgrade (founder); CodeQL JS not running on main |
| B9 | Alchemy key rotation status confirmed or gated. |  |  |  |  |  |  |  | FOUNDER_GATES FG-ALCHEMY | FOUNDER-GATE:FG-ALCHEMY | key in git history (pre-#357); dashboard check |
| B10 | x402 payTo is a founder EOA → treasury decision gated; show clearly in admin Treasury. | | | | | | | | | NOT STARTED |  |
| B11 | Admin routes: auth + role checks + rate limits + audit log on every mutation; CSRF where c… | | | | | | | | | NOT STARTED |  |
| B12 | Webhooks: signature verification + idempotency keys on Dodo v2 and deposit crediting (test… | | | | | | | | | NOT STARTED |  |
| C1 | `PRICING_TRUTH.md` + catalog as single source. | catalog-fed (web/console) | catalog rails + railPrices() |  | catalog_consistency.test.js | #452 | 60e1eef | discovery 15/15 | PRICING_TRUTH.md + evidence: ~/satelink-private/evidence/live-consistency-postdeploy-2026-09-28.txt (15/15) | DEPLOYED | PRICING_TRUTH still DRAFT (INR values = FOUNDER) |
| C2 | Console Billing: Free/Launch/Pro/Max, monthly/yearly toggle, credit packs $10/$50/$200 wit… | pack bonus labels | bonus_uu in catalog + ledger grant |  | pricing_v2 28 passing | #447 |  |  |  | IMPLEMENTED | FOUNDER-GATE:FG-PR-447 (money path) |
| C3 | Free-tier contradiction resolved everywhere (UI, API gate, docs, well-known). | web JSON-LD fixed | /api/pricing free_tier null; docs example fixed |  | free-RPC-claim scan in CI | #452 | 60e1eef | satelink.network JSON-LD verified | curl satelink.network: "No free RPC tier", 0× "500-calls/day" | DEPLOYED | Mintlify docs publish not verified |
| C4 | RPC per-rail prices labeled (USDT credits $0.00003/call vs x402 bundle $0.10/1,000 = $0.00… |  | rails labels in /v1/pricing, satelink.json, x402 |  | catalog_consistency.test.js | #452 | 60e1eef | yes | evidence: ~/satelink-private/evidence/live-consistency-postdeploy-2026-09-28.txt (15/15) | PROD-VERIFIED |  |
| C5 | x402 page: rail/status per route truthful (TI routes shown as api_credits-metered, not x40… |  | x402 listing: rail + x402_challenge per route (TI = api_credits/false) |  | catalog_consistency.test.js | #452 | 60e1eef | yes | evidence: ~/satelink-private/evidence/live-consistency-postdeploy-2026-09-28.txt (15/15) | PROD-VERIFIED |  |
| C6 | Dodo boundary enforced in code and stated in UI + docs + billing policy. |  |  |  |  |  |  |  | #439 | DEPLOYED |  |
| C7 | INR display path ready (`inr_price`); values = FOUNDER-GATE. | | | | | | | | | NOT STARTED |  |
| C8 | CI consistency test across all public surfaces. | web/console/docs copy scanned |  |  | catalog_consistency.test.js (8 cases) in CI | #452 | 60e1eef | yes | evidence: ~/satelink-private/evidence/live-consistency-postdeploy-2026-09-28.txt (15/15); caught 2 live drifts (JSON-LD free tier, /api/pricing per-method) | PROD-VERIFIED |  |
| C9 | Balances shown per asset/rail with source, timestamp, reference — never a blended "credits… | | | | | | | | | NOT STARTED |  |
| D1 | Overview passes the 10-second rule: balance per rail, plan + UU used vs session/weekly lim… | | | | | | | | | NOT STARTED |  |
| D2 | Server-side account-linked keys (V2). Migration path for V1 cookie-connected keys. Header … | | | | | | | | | NOT STARTED |  |
| D3 | Key lifecycle: create (secret shown once), label, environment, product scopes, revoke (ser… | | | | | | | | | NOT STARTED |  |
| D4 | Agents as server-side entities: create, describe, bind key(s), pause/resume (enforced at g… | | | | | | | | | NOT STARTED |  |
| D5 | Request log: reuse `revenue_events_v2`/usage tables if they hold per-call rows; otherwise … | /requests V2 page | request_log (bounded, async, 14 d) + /v1/me/requests union | migration 020 (additive, pending) | request_log 24 + console_accounts 32 | #453 |  |  |  | TESTED | FOUNDER-GATE:#453 (touches /rpc hot path); then migration 020 |
| D6 | Usage: per-product meters from Pricing V2 endpoints; 24h/7d/30d/90d/custom; requests, succ… | | | | | | | | | NOT STARTED |  |
| D7 | Alerts: thresholds stored per account (usage 70/85/95/100%, monthly spend cap, error rate,… |  | error_rate alert live in #453 |  | console_alerts 17 | #441, #453 | 1bc4558 |  |  | DEPLOYED | error-rate part in #453 |
| D8 | Spend controls: monthly cap + credit auto-use toggle, enforced in the credit gate (FOUNDER… | | | | | | | | | NOT STARTED |  |
| D9 | x402 per-wallet view: link a wallet to the account by signed message; show 402s issued vs … | | | | | | | | | NOT STARTED |  |
| D10 | Trading Intelligence: playground works end to end with correct charging; server-side saved… |  |  |  |  |  |  |  |  | NOT STARTED | TI saved-queries page has no V2 branch |
| D11 | RPC page: per-product usage (not per-key totals mislabeled), per-method error rate if data… | | | | | | | | | NOT STARTED |  |
| D12 | Settings: 2FA enrollment/disable (Better Auth two-factor; requires setting a password — bu… | | | | | | | | | NOT STARTED |  |
| D13 | Onboarding (#434) live and verified in production. |  |  |  |  |  |  |  | onboarding e2e 6/6 on harness | FOUNDER-GATE:FG-FLAG |  |
| D14 | Simple/Advanced mode (#427) live and verified. |  |  |  |  |  |  |  | simple-flows e2e 14/14 on harness | FOUNDER-GATE:FG-FLAG |  |
| D15 | Navigation covers DISCOVER → CONNECT → PRICE → PAY → EXECUTE → METER → RECEIPT. Any page w… | | | | | | | | | NOT STARTED |  |
| D16 | Service Discovery page: renders Satelink's own catalog from the live discovery endpoint; s… | | | | | | | | | NOT STARTED |  |
| D17 | Every screen: title, one-sentence purpose, primary KPI, primary action, status, data fresh… | | | | | | | | | NOT STARTED |  |
| E1 | Executive strip: external revenue (today/7d/30d/lifetime), founder/test revenue separately… | | | | | | | | | NOT STARTED |  |
| E2 | Funnel: DISCOVERED → IDENTIFIED → REGISTERED → REQUESTED → 402 → PAYMENT ATTEMPT → PAYMENT… | | | | | | | | | NOT STARTED |  |
| E3 | Demand Radar reframed: endpoint/product demand, 402 → payment conversion, abandonment, rep… | | | | | | | | | NOT STARTED |  |
| E4 | Revenue control by product × rail × day × epoch; refunds; payment fees where known; TEST/F… | | | | | | | | | NOT STARTED |  |
| E5 | Treasury: Polygon vault balance, Base x402 receipts, signer gas (POL), pending/failed sett… | | | | | | | | | NOT STARTED |  |
| E6 | Settlement: epochs with OPEN/AGGREGATING/READY/DRY-RUN/BROADCAST/CONFIRMED/FAILED; current… | | | | | | | | | NOT STARTED |  |
| E7 | Providers & nodes grouped under "Infrastructure", separating supply from demand; provider … | | | | | | | | | NOT STARTED |  |
| E8 | Customer 360: account, keys (fingerprints), agents, wallets, products, spend, deposits, re… | | | | | | | | | NOT STARTED |  |
| E9 | Agents fleet with pause/resume/revoke (audited, confirmed). | | | | | | | | | NOT STARTED |  |
| E10 | Incidents & security events with severity + lifecycle (OPEN→ACK→INVESTIGATING→MITIGATED→RE… | | | | | | | | | NOT STARTED |  |
| E11 | Observability: API, DB, workers, DepositListener last block/lag, cron/jobs last success/fa… | | | | | | | | | NOT STARTED |  |
| E12 | Self-tests: API/DB/RPC/provider/402 flow/key flow/credit flow/deposit detection/vault conn… | | | | | | | | | NOT STARTED |  |
| E13 | System config: flags, pricing catalog, rate limits, settlement mode, rails — read-only by … | | | | | | | | | NOT STARTED |  |
| E14 | Machine-commerce health scorecard (Discovery, Auth, Payment, Execution, Metering, Settleme… | | | | | | | | | NOT STARTED |  |
| E15 | `DATA_LINEAGE.md` complete for every E-tile. | | | | | | | | | NOT STARTED |  |
| E16 | Legacy RPC/DePIN tabs preserved but re-homed under Infrastructure; nothing working deleted… | | | | | | | | | NOT STARTED |  |
| F1 | `/.well-known/satelink.json` and `/.well-known/x402` match the catalog; no nonexistent end… |  | well-known read railPrices() |  | catalog_consistency.test.js | #452 | 60e1eef | yes | evidence: ~/satelink-private/evidence/live-consistency-postdeploy-2026-09-28.txt (15/15) | PROD-VERIFIED |  |
| F2 | `/v1/pricing`, `/v1/capabilities`, `/v1/compare`, `/v1/machine/register`, `/v1/intelligenc… | | | | | | | | | NOT STARTED |  |
| F3 | `docs.satelink.network` canonical; `satelink.network/docs*` → 308 to docs (path-preserving… | | | | | | | | | NOT STARTED |  |
| F4 | Web copy: Machine Commerce positioning; LIVE/BETA/DRY-RUN/PLANNED labels; zero "guaranteed… | | | | | | | | | NOT STARTED |  |
| F5 | sitemap, robots, canonical tags, OG metadata consistent; no duplicate docs indexed. | | | | | | | | | NOT STARTED |  |
| F6 | Legal/trust pages synchronized with PRICING_TRUTH; DRAFT labels preserved; no implied cert… | | | | | | | | | NOT STARTED |  |
| F7 | Docs structure: Getting Started, Machine Commerce, Discovery, Authentication, Payments, x4… | | | | | | | | | NOT STARTED |  |
| G1 | Cloudflare DNS export for both zones → `~/satelink-private/DNS_BACKUP_2026-09-27.json`. | | | | | | | | | NOT STARTED |  |
| G2 | `docs/execution/DOMAIN_SURFACE_INVENTORY.md`: every hostname → record, target, deployment,… | | | | | | | | | NOT STARTED |  |
| G3 | Cloudflare Email Routing: explicit rules (no catch-all) for careers@ business@ support@ au… | | | | | | | | | NOT STARTED |  |
| G4 | Outbound: Resend domains verified; exactly one SPF TXT per name (merge Cloudflare routing … | | | | | | | | | NOT STARTED |  |
| G5 | Reply-as-alias: configure the central inbox's "send mail as" using Resend SMTP per alias (… | | | | | | | | | NOT STARTED |  |
| G6 | Application email consolidated on one provider (Resend preferred if Brevo is redundant); t… | | | | | | | | | NOT STARTED |  |
| G7 | Test matrix, 8 aliases × (inbound received with original recipient visible · outbound deli… | | | | | | | | | NOT STARTED |  |
| H1 | `CLEANUP_INVENTORY.md` (path, type, size, tracked, referenced/imported by, relevance, reco… | | | | | | | | | NOT STARTED |  |
| H2 | Remove only proven-dead files (import graph via knip/depcheck/ts-prune + grep for dynamic … | | | | | | | | | NOT STARTED |  |
| H3 | Unused packages removed with evidence; lockfile updated; build + tests green. | | | | | | | | | NOT STARTED |  |
| H4 | Branches: delete merged, non-protected, fully-contained branches (`git branch -r --merged … | | | | | | | | | NOT STARTED |  |
| H5 | Workflows: KEEP/MERGE/REMOVE with reasons; CI green after. | | | | | | | | | NOT STARTED |  |
| H6 | Docs: one canonical Product, Architecture, Economics/Pricing, API, Deployment, Security sp… | | | | | | | | | NOT STARTED |  |
| H7 | README.md + one CLAUDE.md (consolidate with `libs/CLAUDE.md`, don't create a competing fil… | | | | | | | | | NOT STARTED |  |
| H8 | `.env.example`: every var name, purpose, required?, service, format — placeholders only. | | | | | | | | | NOT STARTED |  |
| H9 | Dependabot #399: review, merge if CI green and non-breaking. Leave #374 untouched. | | | | | | | | | NOT STARTED |  |
| H10 | Before/after metrics: repo size, files, dirs, deps, markdown count, branches, subdomains, … | | | | | | | | | NOT STARTED |  |
| I1 | Test suites: all pre-existing 19 failures listed with root cause; fixed where in touched a… | | | | | | | | | IN PROGRESS | baseline recorded; 7 failures listed |
| I2 | New tests for every new endpoint (auth, tenant isolation, happy path, error path) and ever… | | | | | | | | | NOT STARTED |  |
| I3 | Playwright production run over every console route and admin tab: HTTP 200, no console err… | | | | | | | | | IN PROGRESS | BEFORE screenshots captured (signed-in states blocked) |
| I4 | API smoke: discovery, pricing, 402 on unfunded key, 200 on funded test key, TI charge-afte… | | | | | | | | | NOT STARTED |  |
| I5 | Final report (§10) with completion % = PROD-VERIFIED rows / total rows. | | | | | | | | | NOT STARTED |  |
