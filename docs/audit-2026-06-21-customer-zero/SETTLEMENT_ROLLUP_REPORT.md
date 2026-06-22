# Settlement Rollup — Implementation Report (2026-06-21)

Implements `PHASE_5_SETTLEMENT_PROPOSAL.md`. Goal: make the first real on-chain
settlement *reachable*. No real transaction was broadcast (signer underfunded —
risk gate held, as instructed).

## What was built (PR #170, deployed, `SETTLEMENT_ROLLUP` flag OFF)

`apps/api/src/scheduler/jobs/settlement_anchor_job.js`:

| Piece | Behavior |
|---|---|
| `buildCandidates()` | Walks closed, unanchored, revenue-bearing epochs in id order; accumulates revenue until `>= SETTLEMENT_BATCH_MIN_USDT` (default 0.50) → one **rollup batch** per crossing; remainder = carry-forward. PURE READ. |
| `fundingPrecheck()` | Checks signer native-gas floor (`SETTLEMENT_SIGNER_MIN_NATIVE`, default 0.05) (+ optional USDT). Returns `ok:false` → broadcast blocked. |
| `anchorBatch()` | One 0-value **merkle-proof anchor** over an epoch RANGE. Dry-run → `status=simulated` (no broadcast). Underfunded → `status=blocked_unfunded`. Marks `epoch_ledger.tx_hash` only on a confirmed real tx. |
| `runRollup()` | Scheduler dispatch when `SETTLEMENT_ROLLUP=1`; else legacy per-epoch path. |
| `revertBatch()` | Accounting rollback — re-opens an epoch range (`tx_hash=NULL`, batch `reverted`). |
| schema | Additive `epoch_lo/epoch_hi/epoch_count/merkle_root/is_rollup` on `settlement_batches`. |

**Reversible / safe to deploy:** gated behind `SETTLEMENT_ROLLUP` (default OFF) →
deploy changed nothing. Even if enabled, the funding precheck blocks any broadcast
on the underfunded signer.

## Verification (dry-run, prod data — no broadcast)

`scripts/cz_settle_dryrun.mjs` against the production DB:

```
threshold_usdt:           0.50
total_unanchored_epochs:  27909          ← previously: 0 ever anchorable
candidates_formed:        114            ← 114 batches now anchorable
first_candidate:          epochs 2..62 (57 epochs), 0.50007 USDT,
                          platform_share 0.150021,
                          merkle_root 0x75237fb7…ed4b
carry_forward:            223 epochs, 0.4728 USDT (needs 0.0272 more)
```

| Check | Result |
|---|---|
| Create settlement candidate | ✅ 114 candidates (was 0) |
| Threshold accumulation | ✅ 0.50007 ≥ 0.50 |
| Tx generation path | ✅ batch row built (status `simulated`, `is_rollup=true`, `0xSIM_…`), then **ROLLBACK** — nothing persisted to prod |
| Merkle root generated | ✅ 32-byte keccak over epoch range |
| Settlement reachable | ✅ yes (mechanically) |

### Signer funding precheck (real signer, `Satelink-api` env)
```
signer:        0x988fb0efC0f14111511dE3481E6c066018A0cf91
nativeBalance: 0.00386 MATIC   (floor 0.05)  → BELOW
ok:            false   reasons: ["native_below_floor(0.00386<0.05)"]
```
**The precheck correctly BLOCKS broadcast** — the hot wallet cannot fund the anchor
gas. Per "stop before broadcasting if risk appears," no real tx was sent.

## First Settlement Readiness Score: **70 / 100**

| Dimension | State |
|---|---|
| Rollup mechanism implemented + deployed | ✅ |
| Candidates form from real data (114) | ✅ |
| Tx-generation path verified (dry-run) | ✅ |
| Funding precheck + risk gate | ✅ (correctly blocking) |
| Signer funded for gas | ❌ 0.00386 / 0.05 MATIC |
| Revenue being anchored is *real* cash | ⚠️ still **phantom** (Phase 6 not done — `revenue_events_v2` records list price on free traffic) |
| Real broadcast performed | ❌ (intentionally gated) |

Held below higher because two things stand between "reachable" and "first real
settlement": (1) **fund the signer** `0x988fb0…cf91` with ≥0.05 MATIC (ops), and
(2) the anchored revenue is phantom until **Phase 6** records paid-only events — so
the first anchor would prove an epoch range over notional, not collected, USDT.

## Path to first on-chain settlement (exact, gated on your go)
1. **Fund signer** `0x988fb0efC0f14111511dE3481E6c066018A0cf91` with ≥ ~0.1 MATIC (gas).
2. Set `SETTLEMENT_ROLLUP=1` (and confirm `SETTLEMENT_DRY_RUN` handling) on Satelink-api.
3. Scheduler forms batch epochs 2–62 ($0.50007), precheck passes, broadcasts ONE
   merkle anchor → first non-null `tx_hash` in `settlement_batches` + `epoch_ledger`.
4. (Recommended first) **Phase 6** paid-only billing so anchored revenue is real cash.

## Rollback
- `SETTLEMENT_ROLLUP=0` (instant) → legacy path.
- `git revert` PR #170.
- `revertBatch(batchId)` re-opens an epoch range (accounting; on-chain tx immutable).
