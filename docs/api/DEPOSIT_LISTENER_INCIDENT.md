# DepositListener cursor-resume bug — incident report

> **SUPERSEDED (2026-09-24, A2.9):** the "safety cap that logs `GAP SKIPPED` and
> jumps the cursor over the gap" described below has been **removed**. The
> listener now does **bounded catch-up**: a persisted scan cursor
> (`deposit_scan_cursor`, migration `038`) that advances only to the last
> FULLY-scanned block, at most `DEPOSIT_MAX_BLOCKS_PER_POLL` per poll, chunked by
> `DEPOSIT_LOG_CHUNK`. The cursor can never move past an unscanned block under
> any config value, so **no gap is ever skipped** — a large lag is logged loudly
> and exported as the `satelink_deposit_listener_lag_blocks` metric, and the
> listener simply takes more polls to catch up. The manual-claim recovery path
> below is therefore no longer needed to cover skipped ranges (it remains valid
> for unregistered-wallet deposits). See `fix/deposit-listener-bounded-catchup`.

**Branch:** `fix/deposit-listener-cursor-resume` (off `main`, own PR, founder approval required before merge).
**Status:** root cause found, fixed, tested. Whether any deposit was actually
missed in production is **not yet confirmed** — see "What the founder should
run" below.

## What was wrong

`src/services/deposit_listener.js`'s `DEFAULTS` had `maxLookbackBlocks: 2000`
and `initialLookbackBlocks: 2000`. Both should have been `50_000` and
`10_000` respectively — the code's own comments (`// ~1 day on Polygon`,
`// first-run window when no cursor exists`) still describe the *original*
values, which is how this was caught: the comments never matched the numbers
after commit **`ab02dd2`** ("fix(deposit-listener): eth_getLogs chunk 5000 →
env-configurable, default 500", PR #227, **2026-07-04**).

That commit's own message says only `chunkBlocks` (the per-`eth_getLogs`-call
range, correctly kept small because free RPC providers reject large ranges)
was meant to change — it explicitly says `confirmations` and `pollIntervalMs`
were "unchanged," and never mentions `maxLookbackBlocks` or
`initialLookbackBlocks` at all. The diff nonetheless dropped both from their
original `50_000` / `10_000` to `2_000` / `2_000` — almost certainly copied
from the (unrelated) `chunkBlocks` change by mistake. **This has been wrong in
production since 2026-07-04**, roughly 11 weeks before this fix.

### The two concrete effects
1. **Cold-start backfill window too short.** `initialLookbackBlocks` bounds
   how far back a *fresh* listener (no DB cursor yet) looks on its very first
   scan. At `2_000` blocks (~1 hour on Polygon), any deposit older than that
   at the moment the listener first starts scanning is never picked up — the
   cursor then only moves forward from whatever it found.
2. **Restart-gap silently skips blocks (the actual test failure).**
   `DepositListener` is re-instantiated and `.start()`ed on **every server
   boot** (`server.js` step 10b) — i.e. on every deploy. The code clamped
   `fromBlock` to `Math.max(fromBlock, toBlock - maxLookbackBlocks, 0)`
   **unconditionally**, even when a perfectly good DB cursor already existed.
   So if the server was down (or the confirmed chain tip advanced) by more
   than `maxLookbackBlocks` (`2_000` blocks, ~1 hour) between the last
   recorded cursor and the next successful poll, the listener would silently
   jump forward past the cursor — **the skipped block range was never
   scanned by anyone, and nothing was logged.** A deposit landing in that
   window would not be auto-credited, with no trace that anything was
   skipped at all.

## Is double-crediting possible? **No — confirmed.**
This bug is exclusively about *missed scans*, never re-processing. Every
credit path is independently idempotent on `tx_hash`:
- `credit_deposits` has `UNIQUE(tx_hash)` (the scan-idempotency ledger; see
  `_handleDeposit`'s upfront `SELECT id FROM credit_deposits WHERE tx_hash =
  $1` short-circuit).
- `api_deposits` has its own `UNIQUE(tx_hash)` in `credit_service.mjs`'s
  `creditAccount()` (the canonical, spendable-balance write).
- The new "duplicate block processing" test in this PR explicitly re-scans an
  overlapping range and confirms the balance is unaffected.

## Is a missed deposit possible? **Structurally yes; not confirmed either way.**
Two scenarios could have triggered it since 2026-07-04:
- A cold start (or a `credit_deposits` chain-id row set that was ever
  effectively empty) where a real deposit sat more than ~2,000 blocks in the
  past at listener-start time.
- Any process restart where the gap between the last recorded cursor and the
  next successful poll's confirmed tip exceeded ~2,000 blocks (~1 hour) — for
  example a longer-than-usual outage, a stuck deploy, or a crash-loop.

**The `credit_deposits` table alone cannot prove or disprove this.** A skipped
range and a genuinely quiet period with no real deposits look identical in
that table — nothing is inserted either way. Confirming requires comparing
against the vault's actual on-chain event log.

## What the founder should run

### 1. Read-only SQL — surfaces the listener's own scan/restart history
Run against production Postgres (read-only; inspects `credit_deposits` only):

```sql
-- Every recorded deposit for the live vault chain, in scan order, with the
-- block-number gap since the previous one. A gap much larger than what a
-- single ~60s poll interval could produce under normal (bug-free) running
-- is the signature of either a real quiet period OR a skipped range — this
-- query cannot tell the two apart, but it tells you WHERE to look with the
-- on-chain diff below.
SELECT
  tx_hash,
  block_number,
  amount_usdt,
  wallet_address,
  confirmed_at,
  block_number - LAG(block_number) OVER (ORDER BY block_number) AS block_gap_since_prev
FROM credit_deposits
WHERE chain_id = 137
ORDER BY block_number;
```

```sql
-- Quick summary: the single largest gap on record, and how many rows exist
-- (an empty or near-empty table for a vault that's been live for months is
-- itself a signal worth checking).
SELECT COUNT(*) AS total_deposits,
       MIN(block_number) AS earliest_block,
       MAX(block_number) AS latest_block,
       MAX(confirmed_at) AS most_recent_scan
FROM credit_deposits
WHERE chain_id = 137;
```

### 2. The definitive check — on-chain diff (read-only, no writes, no keys)
`apps/api/scripts/verify_deposit_backfill.mjs` (added in this PR) re-scans the
RevenueVault's real `Deposited` event log directly from chain — the only
source that can prove a negative — and diffs every `tx_hash` found on-chain
against `credit_deposits`. It needs only `POLYGON_RPC_URL` and
`DATABASE_URL`; it writes nothing anywhere.

```bash
POLYGON_RPC_URL=<a Polygon mainnet RPC> DATABASE_URL=<prod, read access is enough> \
  node apps/api/scripts/verify_deposit_backfill.mjs --from <block near 2026-07-04> --to <current - 25>
```

If it reports nothing missing, no deposit was lost. If it lists any
transactions, each one is a genuinely missed deposit — recover it via the
**already-existing, verified path**: the wallet's owner (if registered) calls
`POST /api/keys/deposit` with that `tx_hash`, which independently re-verifies
the deposit on-chain before crediting — never credit it by hand.

## The fix (this PR)
- Restored `maxLookbackBlocks` → `50_000` and `initialLookbackBlocks` →
  `10_000` (matching the code's own long-standing comments and the original
  pre-regression values).
- The `maxLookbackBlocks` safety cap is kept (a single poll should never try
  to scan an unbounded range — that's still correct, rate-limit-conscious
  behavior) — but it is no longer **silent**. When it forces `fromBlock` past
  a real, existing DB cursor, `_pollOnce()` now logs a loud `GAP SKIPPED`
  error naming the exact skipped block range and pointing at Polygonscan +
  the manual-claim recovery path.
- `apps/api/scripts/verify_deposit_backfill.mjs`: read-only on-chain
  reconciliation script (see above).

## Tests added (`test/deposit_listener.test.js`)
- **restart mid-range** (pre-existing, now passes): resumes from the DB
  cursor with no gap and no re-credit.
- **duplicate block processing** (new): an overlapping re-scan of an
  already-processed block never double-credits (proves the `tx_hash`
  idempotency, independent of cursor math).
- **reorg-safe confirmation depth** (new): a deposit shallower than
  `MIN_CONFIRMATIONS` is deferred, then credited exactly once once it reaches
  depth, and a further poll never re-credits it.
- **missed-block backfill** (new): a gap larger than `maxLookbackBlocks` is
  loudly logged (`GAP SKIPPED`, with the exact block range) rather than
  silently dropped.

Full suite: **277 passing / 21 failing (pre-existing, unrelated — see
`docs/api/TEST_TRIAGE.md`) / 3 pending** — this is the last of the original 22
pre-existing failures, now fixed. No other file changed.
