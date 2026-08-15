# Satelink Ops Runbook

## Reconciler worker (`@satelink/reconciler`, M7)

A single Railway worker service running three jobs in one process on an internal
schedule (default every 30s): the **reconciler**, the **settlement-poller**, and
the **outbox-publisher**. Source: `workers/reconciler/`.

### What it does

- **Reconciler (ledger ⟷ chain).** For every `ledger_txns` row with
  `ref_type='revenue_event'` whose `ref_id` carries an on-chain tx hash (today:
  `x402:0x…` — USDC on Base), it verifies against chain (DB + chain only, never
  application cache):
  - the transaction exists and is confirmed (≥ `RECONCILER_MIN_CONFIRMATIONS`),
  - the USDC amount transferred to the expected payTo (`0x966E…7Ad4`) equals the
    ledger entry amount in integer minor units.
  - `drift` = signed sum over rows of `(ledger minor − confirmed chain minor)`.
    A missing/unconfirmed tx contributes its full ledger amount.
- **Settlement-poller.** Advances draws in `settling` whose rail tx has confirmed
  and counts settlements stuck past `STUCK_SETTLEMENT_AGE_MS`. `draws` is empty
  today (correct — draws become real in M8/M9), so it advances nothing now.
- **Outbox-publisher.** Drains `outbox` domain events at-least-once; consumers
  dedupe on `event_id`.

State is written to the single-row `reconciliation_state` table and served at
`GET /internal/reconciliation` (token-gated by `INTERNAL_TOKEN`).

### Endpoint

```
curl -s -H "x-internal-token: $INTERNAL_TOKEN" \
  https://<reconciler-service-domain>/internal/reconciliation
```
Returns: `last_run_at`, `drift_minor_units`, `halted`, `halt_reason`,
`stuck_settlement_count`, `reconciled_count`, `cycle_duration_ms`.
`GET /health` (unauthenticated) is the Railway healthcheck.

### Environment variables

| Var | Required | Default | Purpose |
|-----|----------|---------|---------|
| `DATABASE_URL` | yes | — | Postgres (reference the project Postgres) |
| `INTERNAL_TOKEN` | yes | — | shared secret for `/internal/*` |
| `BASE_RPC_URL` | no | `https://mainnet.base.org` | Base RPC (read-only) |
| `POLYGON_RPC_URL` | no | `https://polygon-rpc.com` | Polygon RPC (no data yet) |
| `RECONCILER_MIN_CONFIRMATIONS` | no | `5` | confirmations before "settled" |
| `RECONCILE_INTERVAL_MS` | no | `30000` | cycle interval |
| `STUCK_SETTLEMENT_AGE_MS` | no | `900000` | settling-age → stuck |
| `PORT` | no | `8080` | HTTP port (Railway sets this) |
| `OUTBOX_WEBHOOK_URL` | no | — | optional event sink; empty = ack-only |

It NEVER reads or changes `SETTLEMENT_DRY_RUN` or any settlement flag.

### Deploy (Railway)

New service in the existing project, root `workers/reconciler` (config in
`workers/reconciler/railway.json`):
1. `railway add` a service; connect this repo/branch.
2. Set the env vars above (reference the project `DATABASE_URL`; set a strong
   `INTERNAL_TOKEN`).
3. Start command: `npm start --workspace=@satelink/reconciler`. Healthcheck:
   `/health`.
4. Generate a domain; verify: `curl -H "x-internal-token: …" https://…/internal/reconciliation`.

Migrations `010`+`011` must be applied to the target DB first
(`npx tsx database/runner.ts migrate <connectionString>`).

### How to stop it (rollback)

Stop / delete the Railway service (or scale to 0 replicas). Halting is
**fail-open** at this stage — the worker only records the halt flag and a
critical event; nothing downstream is gated on it, so stopping the worker has no
effect on the money path. It is safe to stop at any time.

### What `halted` means

`halted=true` means the last cycle found `drift_minor_units != 0` — the ledger
and chain disagree about confirmed revenue. `halt_reason` is machine-readable
(`LEDGER_CHAIN_DRIFT`, or `CURRENCY_DECIMALS_MISMATCH`). A `critical`
`reconciliation.drift_detected` event is written to `outbox` with a per-row
breakdown. Halting does not (yet) block anything — it is an alarm.

### What to do when drift is non-zero

1. Read the critical event: `SELECT payload FROM outbox WHERE severity='critical'
   ORDER BY created_at DESC LIMIT 5;` — it lists the anomalous txns with
   `status` (`not_found`, `unconfirmed`, `recipient_missing`, `amount_mismatch`,
   `currency_error`), `ledgerMinor`, `chainMinor`, `driftMinor`.
2. Take the tx hash from the `refId` and inspect it on-chain (Basescan for
   `x402:` rows). Confirm the real transferred amount and recipient.
3. Classify:
   - **`not_found` / `unconfirmed`**: the ledger credited revenue the chain has
     not settled — a settle-before-credit regression (invariant #4). Do NOT
     "fix" the ledger; find why the credit was posted early.
   - **`amount_mismatch`**: the ledger amount and the confirmed transfer differ —
     a crediting bug. Reconcile the source event.
   - **`recipient_missing`**: funds went to an address other than the expected
     payTo. Investigate the payTo/config and the payment.
   - **`currency_error`**: a ledger row's currency decimals ≠ the token's —
     a data/config error; the amount is unverifiable until fixed.
4. The ledger is append-only (invariant #5): any correction is a NEW reversing
   entry, never an UPDATE/DELETE. Drift clears automatically on the next cycle
   once ledger and chain agree.

## Capacity enforcement cutover (M8)

The RPC gateway's authorize-and-meter step (`rpc_gateway.js`, the
`authorizeAndMeter` call site) is wrapped by `enforceCapacity`
(`apps/api/src/capacity/capacity_enforcement.js`). Behaviour is chosen by the
env var **`CAPACITY_ENFORCEMENT_PATH`**, read at REQUEST time — a Railway env
change reverts instantly with NO redeploy.

| value | behaviour |
|-------|-----------|
| `legacy` (default) | api_credits `authorizeAndMeter`, unchanged. |
| `dual` | evaluate BOTH paths, **serve legacy**, record both, log disagreements. The new-path eval is read-only (never decrements). |
| `new` | the atomic `consumed_amount` draw against the caller's Authorization IS the decision. |

- **Rollback**: set `CAPACITY_ENFORCEMENT_PATH=legacy` on the `Satelink-api`
  Railway service. Takes effect on the next request; no deploy.
- **Denial reasons** (machine-readable, never conflated): `no_authorization`,
  `insufficient_capacity`, `authorization_expired`.
- **Per-call cost**: `CAPACITY_CALL_COST_MINOR` (USDC minor units, default `30`
  = $0.00003).
- **Parity/latency**: `GET /internal/capacity-parity` → decisions evaluated,
  agreements, disagreements by reason, p50/p99 per path, and the new−legacy p99
  delta (gate: < 10ms). New-path query is a single index scan on
  `idx_authorizations_principal` (~0.05ms observed on prod).
- **Nonces are settlement events, not call events** (frozen, libs/CLAUDE.md M8):
  per-call metering compares `consumed_amount + cost` vs `cap_amount` and touches
  no nonce. `Authorization.consume(nonce, …)` runs only at settlement.

### Creating an Authorization (funds capacity)

Capacity requires ONE real signed authorization per caller. There is no backfill
(a backfill would forge a signature). A wallet signs an x402 "exact"
(EIP-3009 `TransferWithAuthorization`) envelope on USDC/Base; the signature is
verified (recovered signer == claimed signer == `message.from`) before anything
is persisted.

```
# 1) Sign OFFLINE (no network, no files; key read from env only, never echoed):
M8_SIGNER_PRIVATE_KEY=0x<64hex> node scripts/ops/m8-sign-authorization.mjs > /secure/tmp/env.json
#    → { main: $2 authorization, exhaustion: $0.005 } — BEARER INSTRUMENTS, never commit/log.

# 2) Verify + persist (idempotent on the EIP-3009 nonce; signature redacted in output):
DATABASE_URL=<sanctioned> npx tsx scripts/ops/m8-create-authorization.ts < /secure/tmp/env.json
```

Creates FundingSource + Authorization + a USDC capacity `accounts` row in one
transaction. Re-running the same envelope creates nothing new. A tampered
envelope is rejected and nothing is persisted.
