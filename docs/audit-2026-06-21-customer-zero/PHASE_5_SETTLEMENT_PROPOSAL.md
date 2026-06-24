# Phase 5 — Settlement Rollup: Architecture Proposal (NOT implemented)

> Per instruction: **return architecture proposal + evidence first; do not modify
> settlement logic** until approved.

## 1. Evidence — can the first earned dollar settle today? **No.**

Live state (2026-06-21, `apps/api/src/scheduler/jobs/settlement_anchor_job.js` +
`/api/settlement/history`):

| Fact | Value | Source |
|---|---|---|
| Anchor threshold | `MIN_ANCHOR_REVENUE_USDT` default **0.01** (was 1.0) | anchor job :37 |
| Gate | `WHERE total_revenue >= $threshold`, **per epoch** | anchor job :111 |
| Dust handling | epochs below threshold **skipped** ("not worth gas") | anchor job :129–134 |
| **Rollup of dust epochs** | **NONE** — skipped individually, never aggregated | anchor job :126–149 |
| Per-epoch revenue | ~**0.0017 USDT** (epoch 27954 = 0.00168) | settlement history |
| On-chain settlements ever | **0** — every epoch `merkleRoot:null, txHash:null` | settlement history |

**Why it can't settle:** each 60s epoch earns ~0.0017 USDT, well below the 0.01
threshold, and epochs are evaluated **individually** with no carry-forward. ~6
consecutive epochs would together exceed 0.01, but because they're never summed,
the cumulative balance never anchors. Lowering the threshold to the per-epoch
level doesn't help either — anchoring 0.0017 USDT costs far more in gas than it
settles. The math is structurally unsettleable without **aggregation**.

Compounding (out of Phase 5 scope, but blocks *real* settlement): today's
`revenue_events_v2` records **phantom** revenue (list price on free traffic), so
even a working rollup would anchor non-cash until Phase 6 records paid-only events.

## 2. Proposed architecture — carry-forward rollup batch

Replace per-epoch anchoring with a **cumulative settlement batch**:

```
closed epochs (dust)        carry-forward ledger              on-chain
 e_n  0.0017 ─┐
 e_n+1 0.0017 ─┤  Σ unanchored_revenue                       when Σ ≥ BATCH_MIN:
 e_n+2 0.0017 ─┼─►  running total ──────────────►  build ONE merkle batch over
 ...          │     (settlement_batches)            the epoch range [n..m]
 e_m  0.0017 ─┘                                     │
                                                    ├─ hot-wallet funding precheck
                                                    │    (MATIC for gas; USDT if value-transfer)
                                                    ├─ anchor tx (merkleRoot) ──► Polygon
                                                    └─ mark epochs n..m SETTLED with batch txHash
```

### Components
1. **Carry-forward total** — sum `total_revenue` of all CLOSED, unanchored epochs.
   When `Σ ≥ BATCH_MIN_USDT` (proposed 0.50–1.00, gas-amortizing), trigger a batch.
2. **Batch builder** — create one `settlement_batches` row spanning `[epoch_lo,
   epoch_hi]`, compute a single merkle root over the included epoch payouts.
3. **Funding precheck** — before broadcasting: `balanceOf(signer)` for USDT (if the
   anchor moves value) **and** native MATIC for gas ≥ estimated. If short → **skip +
   alert** (never broadcast a tx that will revert / strand funds).
4. **Atomic finalize** — on tx success, mark every epoch in the range settled with
   the batch `txHash`/`merkleRoot` in one transaction (no partial state).
5. **Idempotency / crash-safety** — a batch in `PENDING_TX` with a broadcast hash is
   reconciled on restart (check receipt) before creating a new batch — no double-spend.

### Config (env)
- `BATCH_MIN_USDT` (carry-forward trigger), `SETTLEMENT_SIGNER_MIN_MATIC` (gas
  floor), keep `settlement_dry_run` switch for staged rollout.

## 3. Evidence gate before modifying settlement logic

Before any settlement code changes, prove the chain end-to-end on staging/dry-run:
1. **Real revenue exists** — canonical credits path live (Phase 2/3 flag on) +
   paid-only billing (Phase 6) so `revenue_events_v2` reflects collected USDT.
2. **Rollup crosses threshold** — dry-run: given accrual R/epoch, cumulative reaches
   `BATCH_MIN_USDT` in `⌈BATCH_MIN/R⌉` epochs; assert a batch is formed.
3. **Funded signer anchors** — on a funded staging signer, the batch emits a **real
   txHash** and the epoch range flips to SETTLED (today this is always null).
4. **Economic check** — settled USDT per batch > gas cost (batch large enough to be
   worth anchoring).

Only when (1)–(4) hold is "the first earned dollar can actually settle" demonstrably
true. **No settlement code will be changed until this proposal is approved.**

## 4. Dependencies / sequencing
```
Phase 2/3 flag ON  ─►  Phase 4 backfill (done first)  ─►  Phase 6 paid-only billing
        └──────────────────────────────┬───────────────────────────┘
                                        ▼
                          Phase 5 rollup (this proposal)
                          + funded hot wallet
                                        ▼
                          first earned USDT settles on-chain
```
Settlement is the **last** link: it can only settle revenue that the canonical
path has actually collected. Implementing rollup before real revenue exists would
just anchor phantom value.
