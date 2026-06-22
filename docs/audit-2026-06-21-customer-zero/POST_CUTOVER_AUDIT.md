# Post-Cutover Audit — Customer Zero (2026-06-21)

Re-score after the `api_credits`-canonical cutover went live. Evidence-based only.

## What is now true in production (verified live)

- `CREDIT_CANONICAL=true` is **live** on Satelink-api (Railway var confirmed).
- Keyed RPC requests run the canonical path (`x-credit-source: api_credits`).
- End-to-end HTTP validation passed: deposit→credit increase, per-request
  deduction, usage metering, **402 at depletion**, no Redis/credit_balances
  dependency (`scripts/cz_live.mjs`):

  | balance before | balance after | served | usage rows | deduction | 402 at depletion |
  |---|---|---|---|---|---|
  | 0.00009 | 0 | 3 | 1 (count=3) | 0.00009 ($0.00003/req) | yes |

- Phase 4 backfill committed: 1 funded orphan wallet ($0.59993) migrated into a
  minted `api_credits` account; `credit_balances` left intact; reversible (tag
  `tx_hash LIKE 'migration_%'`).
- Anonymous public traffic still served (free path preserved).

## Scores

| Dimension | Previous (audit) | **Now** | Why |
|---|---|---|---|
| **Customer Zero Readiness** | 20 | **78** | A paying user can now: create key → deposit → credits increase → make RPC calls that **deduct per request** → see usage increment → get **402 when out**. Verified live end-to-end. Held below ~90 by: no wallet-update endpoint (P1-3), operator-side settlement still not firing, no *retained* external paying customer yet. |
| **Revenue Readiness** | 15 | **45** | Collection (deposit→balance) and **real metering** (credits consumed per call) now work — revenue is recognized against a real paid balance, not phantom. Held down by: **0 on-chain settlements** (dust gate, Phase 5 proposal-only) and **phantom billing** still records list price on free/anonymous traffic in `revenue_events_v2` (Phase 6 not done). |
| **Production Readiness** | 30 | **60** | Deposit-hijack + reorg fixed and deployed; key-in-URL fixed; canonical cutover behind a **reversible flag** with a tagged, reversible migration and intact legacy ledger; 36 money-path tests green (19 api_keys + 17 creditService) + live e2e. Held down by: settlement broken, phantom billing, creditService fail-open on DB error, 159 repo dependabot vulns, local dev broken, 1 node online. |

## Audit P0 status after cutover

| P0 | Status |
|---|---|
| P0-1 deposit/usage surface 404 | ✅ fixed + deployed (#166/#167) |
| P0-2 key not honored on serving | ✅ fixed — canonical resolves api_credits; unknown key → 401 (verified) |
| P0-3 credits never consumed | ✅ fixed — per-request deduction (verified live, 0.00009→0) |
| P0-4 usage never metered | ✅ fixed — `api_usage_daily` increments per request (verified, count=3) |
| P0-5 settlement can't settle | ⏳ **proposal delivered, not implemented** (per your decision) — still 0 on-chain settlements |
| P0-6 deposit hijack/reorg | ✅ fixed (shipped with #166) |

## Remaining before "first dollar settles on-chain"
1. **Phase 6** — record paid-only revenue in `revenue_events_v2` (stop phantom).
2. **Phase 5** — implement the approved dust-rollup + signer funding precheck
   (proposal in `PHASE_5_SETTLEMENT_PROPOSAL.md`).
3. Fund the settlement hot wallet (MATIC for gas).

## Possible real Customer Zero
The migrated wallet `0x966e…7ad4` ($0.59993) is the only externally-funded balance
in the system — the closest thing to a real first paying customer. It is now on the
canonical path and will be metered/deducted on use.

## Rollback (still available)
- `CREDIT_CANONICAL=false` → instant revert to legacy path.
- `git revert` PR #169 → remove canonical wiring.
- Backfill reversal: rows tagged `tx_hash LIKE 'migration_%'`; `credit_balances`
  intact as fallback.
