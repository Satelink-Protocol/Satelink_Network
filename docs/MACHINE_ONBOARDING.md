# Machine Onboarding — Autonomous Customer Flow

Last verified: 2026-07-03 (local router verification against prod Postgres + live prod curl evidence).
Status: implemented on branch `worktree-machine-revenue-activation`; **live after merge to `main`** (deploy = merge, per CLAUDE.md).

This is the complete flow for an autonomous machine (bot, agent, protocol) to discover
Satelink, create an identity, fund credits with USDT on Polygon, consume RPC, and be
billed — with zero human involvement.

## The loop

```
1. DISCOVER   GET  /.well-known/satelink.json            (no auth, cached)
2. PRICE      GET  /v1/pricing                           (no auth, cached)
3. REGISTER   POST /v1/machine/register                  {wallet_address, signature}
4. FUND       GET  /credits/deposit/initiate?amount=1.00 → sign + send 2 txs
              → DepositListener credits api_credits automatically after 25 confirmations
5. CONSUME    POST /rpc/{chain}  (X-API-Key header)      $0.00003/call, atomic deduction
6. OBSERVE    GET  /api/keys/usage, /api/keys/deposits   (X-API-Key header)
7. EXHAUST    HTTP 402 with payment block + manifest_url → goto 4
```

## 1–2. Discovery

- `GET https://rpc.satelink.network/.well-known/satelink.json` — service manifest:
  chain (Polygon 137), USDT contract, RevenueVault deposit address, price per call,
  registration + funding + consumption endpoints, error semantics.
- `GET https://rpc.satelink.network/v1/pricing` — pricing detail. **Truth source:** the
  flat `price_per_call_usdt: 0.00003` is what `creditService.authorizeAndMeter` actually
  deducts on paid tiers. Free tier bills $0 and is capped at 500 calls/day.

## 3. Identity (wallet-based, zero human fields)

```
POST /v1/machine/register
{ "wallet_address": "0x…", "signature": "<personal_sign of 'satelink:register:<lowercase wallet>'>" }
```

- The signature (EIP-191 `personal_sign`) proves control of the funding wallet. This is
  required because on-chain deposits auto-credit **by sender wallet** — without proof,
  a squatter could pre-register someone else's address and siphon their deposits.
- One account per wallet — a second registration returns `409 wallet_already_registered`.
- Returns `201` with `api_key` (free tier, 500/day). Rate-limited per IP.
- ethers.js example:
  ```js
  const wallet = new ethers.Wallet(PRIVATE_KEY);
  const sig = await wallet.signMessage(`satelink:register:${wallet.address.toLowerCase()}`);
  ```

## 4. Funding (deposit → credits, automatic)

1. `GET /credits/deposit/initiate?amount=1.00` → ready-to-sign calldata:
   - tx 1: `USDT.approve(RevenueVault, amountRaw)` on `0xc2132D05D31c914a87C6611C10748AEb04B58e8F`
   - tx 2: `RevenueVault.deposit(amountRaw)` on `0x80AFEaC3B77CbeC1f7B9f24a50319DC72785DdA3`
2. The vault emits `Deposited(from, amount)`. The DepositListener polls confirmed blocks
   (≥ 25 confirmations) and credits the `api_credits` account bound to the sender wallet
   — the **canonical** balance the serving path deducts from (`CREDIT_CANONICAL=true`).
3. A first deposit ≥ `MIN_DEPOSIT_USDT` (default **$0.50**) lifts a free account to
   `basic` (10,000 calls/day, pay-per-call) so the credits are spendable.
4. Fast path (optional): once the tx has 25 confirmations,
   `POST /api/keys/deposit` with `{"tx_hash": "0x…"}` and the `X-API-Key` header credits
   immediately. Idempotent with the listener on `tx_hash` (UNIQUE in `api_deposits`) —
   a race resolves to exactly one credit.
5. Advisory ping (optional): `POST /api/deposit/notify {wallet_address, tx_hash}`.

Deposits from **unregistered** wallets are held in the legacy `credit_balances` ledger
and logged; register the wallet, then claim with `POST /api/keys/deposit`.

## 5–7. Consumption, observation, exhaustion

```
curl -X POST https://rpc.satelink.network/rpc/polygon \
  -H "X-API-Key: sk_…" -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'
```

- Response headers: `X-Credit-Balance`, `X-RateLimit-Remaining`, `X-Credit-Source: api_credits`.
- Deduction is atomic (`UPDATE … WHERE credits_usdt >= cost`) — concurrent calls can
  never drive a balance negative.
- Exhausted credits → **HTTP 402** with `payment.vault_address`, `payment.token_address`,
  `payment.minimum_deposit_usdt`, `payment.calldata_url`, `manifest_url`, `pricing_url`.
- Tier daily limit → **HTTP 429** (resets midnight UTC).

## Evidence (2026-07-02/03)

Proven live on production (`api.satelink.network`):
- Key creation with wallet binding, zero human fields (`POST /api/keys`) → 200.
- Paid-tier metering: 2 calls deducted $0.00003 each (psql before/after:
  `credits_usdt` 0.000060 → 0.000030 → 0), `api_usage_daily` request_count 3 /
  usdt_spent 0.000060, two `revenue_events_v2` rows @ $0.00003 (flagged
  `is_test_data=true` afterwards — synthetic credits).
- Exhaustion: third call → HTTP 402 with machine-readable payment block.

Proven locally (routers mounted against prod Postgres, plus 7 mocha tests in
`apps/api/test/deposit_listener.test.js`):
- Manifest + pricing 200; register 201/409/403/400 matrix; duplicate deposit tx credits
  exactly once; unregistered wallet held; claim-route race safe; confirmation depth
  enforced; restart mid-block-range resumes from the DB cursor with no gap.

## Verifying the first real autonomous deposit (manual, after merge)

```bash
# 1. Watch the listener credit it (Railway logs)
railway logs --service Satelink-api | grep DepositListener

# 2. Confirm both ledgers picked it up
psql "$DATABASE_PUBLIC_URL" -c "SELECT * FROM api_deposits ORDER BY created_at DESC LIMIT 3;"
psql "$DATABASE_PUBLIC_URL" -c "SELECT api_key, tier, credits_usdt, total_deposited FROM api_credits ORDER BY last_used DESC NULLS LAST LIMIT 5;"

# 3. Confirm the vault received the USDT on-chain
curl -sX POST https://rpc.satelink.network/rpc/polygon -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","method":"eth_call","params":[{"to":"0xc2132D05D31c914a87C6611C10748AEb04B58e8F","data":"0x70a0823100000000000000000000000080AFEaC3B77CbeC1f7B9f24a50319DC72785DdA3"},"latest"],"id":1}'
```
