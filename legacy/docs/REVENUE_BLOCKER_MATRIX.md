# Revenue Blocker Matrix

Date: 2026-07-03. Every claim below is backed by curl/psql/on-chain evidence gathered on
2026-07-02/03 (see `docs/MACHINE_ONBOARDING.md` § Evidence and the PR description).

**Autonomous Revenue Readiness: FAIL (until this branch deploys), then CONDITIONAL PASS.**
> The first machine can pay us without a human when **this branch is merged to `main`
> (deploying discovery, registration, and canonical deposit-crediting) and one funded
> machine wallet completes the manifest → register → deposit ≥ $0.50 USDT loop.**

## Fixed in this PR

| # | Blocker | Evidence | Fix |
|---|---------|----------|-----|
| F1 | **Deposit → credit disconnect** (was BLOCKER #1). DepositListener credited only legacy `credit_balances`; the serving path reads `api_credits` (`CREDIT_CANONICAL=true`). `creditAccount()` — the canonical crediting function — had **zero production callers**. An on-chain deposit never became spendable credits. | `deposit_listener.js` (old) L156–167 wrote `credit_balances`; `grep creditAccount` → tests only; psql: `credit_balances` $0.59993 stranded | Listener now credits `api_credits` via `creditAccount`, idempotent on `tx_hash` |
| F2 | **No confirmation threshold, no restart backfill.** Old listener credited at inclusion (reorg risk) via `contract.on`; any downtime lost deposits forever. | old `deposit_listener.js` L66 (`contract.on`), no cursor | Poll-based: ≥ 25 confirmations, cursor = `MAX(block_number)` in `credit_deposits`, bounded lookback |
| F3 | **No machine discovery.** `/.well-known/satelink.json` → 404, `/v1/pricing` → 404 on prod. | `curl -w %{http_code}` → 404/404 | Both endpoints added, cached, no auth |
| F4 | **No keyless machine registration with wallet proof.** `/api/keys` worked but bound wallets without ownership proof → deposit-siphoning squat risk once auto-credit ships. | code review `api_keys_route.mjs` L62 | `POST /v1/machine/register` requires EIP-191 signature; one account per wallet |
| F5 | **$0.50 advertised / $9 enforced minimum.** Every 402 advertised `minimum_deposit_usdt: 0.50`; `POST /api/keys/deposit` rejected anything under $9 — after the machine already paid on-chain. | `credit_gate.js` L111 vs `api_keys_route.mjs` L344 | Pay-as-you-go ≥ $0.50 credits; free→basic lift so credits are spendable |
| F6 | **402 was a dead end.** Exhaustion response had a deposit address but no pointer to pricing/manifest/registration. | live 402 body (Phase 1 test) | `manifest_url` + `pricing_url` + `calldata_url` in every 402 |
| F7 | **Pool-level BEGIN/COMMIT.** Listener "transaction" ran each statement on a random pooled connection — not atomic at all. | old `deposit_listener.js` L144 | Dedicated client via `pool.connect()` |

## Remaining blockers (ranked)

| # | Severity | Blocker | Impact | Effort | Dependency |
|---|----------|---------|--------|--------|------------|
| R1 | **P0** | **This branch is not deployed.** Deploy = merge to `main` (Railway/Vercel auto-deploy). Until then prod still has F1–F7. | No autonomous funding path in prod | Review + merge | Human review of this PR |
| R2 | **P0** | **Demand converts at ~0%.** ~14.8k req/day, 5,957 IPs — `api_usage_daily` had **zero rows in 7 days** (nothing keyed, nothing billed; 1 real revenue event ever, $0.00003). Traffic is anonymous free-tier. | $0 revenue despite real demand | Product/growth: make 402/429 nudges reach the manifest (shipped here), then measure conversion; consider x402 header adoption | R1 first; then observation |
| R3 | P1 | **No paying machine exists.** The loop is (will be) open but unexercised — first real deposit still requires an external actor with a funded wallet. | Revenue = $0 until first depositor | Zero code; distribution/integration work (SDK snippets, agent-framework listings) | R1 |
| R4 | P1 | **Settlement chain frozen (deliberately).** `SETTLEMENT_DRY_RUN=1`; 1,954 `blocked_unfunded` batches ($294.29, phantom-era) clog `settlement_batches`; 98 confirmed. NOTE: signer `0x988f…` holds **1.41 POL** on-chain (CLAUDE.md's `signerBalance=null` is stale). | Collected credits can't settle to treasury | Human decision + phantom-batch cleanup + guarded enable (per CLAUDE.md rules) | Real revenue > $0.50; explicit human decision — **out of scope for automation** |
| R5 | P1 | **Legacy `credit_balances` double-ledger.** $0.59993 sits in `credit_balances` (1 wallet) duplicating the same historical $0.60 deposit recorded in `api_credits`. Old deposits were double-recorded across systems; only `api_credits` is spendable. | Reconciliation confusion; audit drift | Small: one-time reconciliation decision (migrate-or-annotate), then deprecate reads | Human sign-off (money data) |
| R6 | P2 | **Historical revenue drift $0.00003.** `api_credits.total_spent` $0.000060 vs real `revenue_events_v2` $0.000030 (pre-Phase-6 deduction without event). | Cosmetic at current scale; matters at 1000× | Annotate in audit docs | none |
| R7 | P2 | **`/api/pricing` per-method prices are fiction.** It advertises per-method rates (e.g. eth_blockNumber $0.000001) but `authorizeAndMeter` bills flat $0.00003 (no `methodPrice` passed). `/v1/pricing` (new) is truthful. | Machine mistrust on reconciliation | Either pass methodPrice or align `/api/pricing` | Pricing decision |
| R8 | P2 | **`Satelink_Paperclip` Railway service FAILED** (agents.satelink.network offline). | No effect on RPC revenue path | Restart in Railway dashboard | Human (Railway access) |

## Verdicts

- **Production readiness (RPC + billing core): PASS** — metering, atomic deduction,
  402/429, key issuance all proven live on prod.
- **Autonomous revenue readiness: FAIL → PASS on merge** (see sentence above). The single
  remaining *manual* step before first real autonomous USDT: **merge this PR**, then a
  machine (or Pradeep acting as Customer Zero with any funded wallet) deposits ≥ $0.50.
  Settlement to treasury additionally awaits R4 — a deliberate human gate, not a bug.
