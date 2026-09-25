# Console account linking — CONSOLE_ACCOUNTS_V1

_2026-09-25 · status: **built, flag OFF, FOUNDER REVIEW required** (touches the metering path
in `authorizeAndMeter` and `enforceCapacity`, and moves balances on key rotation)._
Branch `feat/console-accounts-v1`. Supersedes the 2026-09-24 proposal.

## The bug this fixes
The console kept connected API keys in a per-browser httpOnly cookie (`slc_keys`), so the same
Google account showed keys and activity in Chrome and an empty console in Brave. Now keys belong to
the **account** (Better Auth `user.id`) on the server; the console reads everything through the
session and holds no key.

## Flags
| Flag | Where | Effect when `true` |
|---|---|---|
| `CONSOLE_ACCOUNTS_V1` | Railway `Satelink-api` | mounts `/v1/me/*` (boot-time) and runs the owner-controls transaction in `authorizeAndMeter` (read per call) |
| `CONSOLE_ACCOUNTS_V1` | Vercel `satelink-console` | console reads/writes through `/v1/me/*`; offers moving browser-held keys to the account |

Both default OFF. With the API flag off, `authorizeAndMeter` runs its original single
`UPDATE … WHERE credits_usdt >= cost` — byte-for-byte the previous path — and `/v1/me` is not
mounted. **Enable the API flag first**, then the console flag. Rollback: unset either.

## Schema (additive; never alters `api_credits`)
`migrations/039_console_accounts_v1.sql`, applied idempotently on first use by
`src/console_accounts/schema.mjs` (prod has no migration runner):
`account_api_keys` (account ↔ `api_credits.id`, SHA-256 fingerprint + hint — **never the key**;
one live owner per key), `account_settings`, `agent_limits`, `account_spend_counters`,
`account_saved_queries`, `account_wallets`, `account_siwe_nonces`, `account_audit`,
`account_idempotency`, plus `idx_rev2_client_created` built `CONCURRENTLY` for the request log.

## API — `/v1/me/*` (Better Auth session cookie)
Mutations require `Content-Type: application/json`, `X-Satelink-Console: 1` and, when present, a
trusted `Origin`. `Idempotency-Key` is honoured on key create and rotate.

| Method | Path | Notes |
|---|---|---|
| GET | `/keys` | id, label, role, hint, tier, status, balance, limits — no key |
| POST | `/keys` | issue a free key bound to the account; key returned **once** |
| POST | `/keys/link` | link an existing key; possession proof = present it once; 409 if another account owns it; no existence oracle |
| PATCH | `/keys/:id` | rename |
| POST | `/keys/:id/revoke` | `api_credits.status='revoked'` → `authorizeAndMeter` refuses it immediately (403); balance stays on it |
| POST | `/keys/:id/rotate` | new key + **exact balance move** + wallet binding move + limits move + old key revoked, one locked transaction, audited. **409** when the key has an active plan entitlement, webhook subscriptions, frozen funds or a payment hold |
| PUT | `/keys/:id/limits` | `paused`, `scopes` (`rpc`, `intelligence`; null = all), `dailyCapUsdt` |
| GET/PATCH | `/settings` | monthly spend cap, credit auto-use, alert thresholds, default mode, timezone (validated against `pg_timezone_names`), notifications |
| GET | `/spend` | real spend (from `api_usage_daily`) + cap usage (from counters) |
| GET | `/usage?days=` | daily series per key, zero-filled |
| GET | `/deposits` | USDT deposits credited to the account's keys |
| GET | `/requests?keyId&product&status&from&to&limit&cursor` | per-request log over existing `revenue_events_v2` rows, keyset pagination; latency / UU are `null` (not recorded yet) |
| GET/POST/DELETE | `/saved-queries` | up to 100 per account |
| POST | `/wallets/challenge`, `/wallets/verify` | SIWE-style (EIP-4361 format) link; single-use 10-min nonce bound to the account; Polygon 137 / Base 8453 |
| GET/DELETE | `/wallets`, `/wallets/:address` | |
| GET | `/x402?wallet=` | settled payments **for this wallet** (`payment_sources.payer`) vs 402 challenges **network-wide** (a challenge is issued before the payer is known — never attributed to a wallet) |
| GET | `/export` | everything above for the account (data export) |

## Owner controls in the metering path
`authorizeAndMeter` (the single chokepoint for RPC-with-key and Trading Intelligence), when the
flag is on, replaces its deduction with **one transaction** in a fixed lock order —
agent-day counter → account-month counter → `api_credits` row:
paused → 403 · product outside scopes → 403 · credit auto-use off → 402 · per-agent daily cap →
402 · per-account monthly cap → 402 (conditional upserts) · the same conditional deduction · commit,
or roll everything back. Counters therefore always equal the sum of committed charges and never
exceed a cap. These denials are `terminal`: under `capacity_enforcement_path = new` (prod today)
`enforceCapacity` returns them instead of falling through to the authorization layer, and the RPC /
Intelligence 402 bodies omit "deposit USDT" guidance for them.

## Migration of browser-held keys
On the Keys page the console offers "Save to my account" for keys still in `slc_keys`. Each is
linked with its possession proof server-to-server; keys that link (or were already linked) leave the
cookie; the cookie is deleted once empty. A key owned by another account stays in the browser and
is reported, never dropped silently.

## Verification (2026-09-25)
- `apps/api/test/console_accounts.test.js` — **22/22** on real Postgres 14: flag-off parity; link /
  create / rename / revoke / cross-account isolation; rotation (exact balance, wallet, limits,
  refusals, 6 concurrent rotations → exactly one); pause / scope / auto-use; **daily cap under 40
  concurrent requests → exactly 3 served, counter == deducted**; monthly cap across two keys under
  60 concurrent requests → exactly 10; insufficient-credit rollback; terminal under `new` path;
  CSRF; idempotent replay; request-log pagination and isolation; SIWE link, forged signature,
  nonce replay; x402 scopes.
- Full API suite: branch and `main` both 321 passing / the same 19 pre-existing failures — **no new
  failure**.
- `apps/console/e2e/accounts-gate.spec.ts` — the production console build + real `/v1/me` router
  (local harness) in three isolated browser profiles signed in to one account: legacy cookie keys
  migrate, all three render identical keys, a create in one and a pause in another appear in all.

## Founder review checklist
1. Rotation moves `credits_usdt` between two `api_credits` rows (audited in `account_audit`); it is
   not a revenue event. Confirm this needs no Financial OS ledger entry, or name the event to emit.
2. Rotation moves `wallet_address` to the new row (wallet auth resolves the oldest row for a
   wallet; a revoked row keeping it would shadow the new key).
3. Enable order and rollback as above. `CONSOLE_ACCOUNTS_V1` on the API adds one transaction per
   paid call (BEGIN, 1 context SELECT, 0–2 counter upserts, the deduction, COMMIT).
4. Found while mapping the path (not changed here): Trading Intelligence deducts before reading
   the metric and does not refund a `warming_up` / `read_failed` 503.
