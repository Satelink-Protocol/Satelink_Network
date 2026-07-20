# Phase 1 — First Autonomous Spread

> Objective: one real, chain-verifiable spread event with zero humans in the transaction (Autonomy Test T3), on architecture that survives to Phase 3 unchanged. Duration target: weeks, not months. Budget: outbound wallet ≤ $25 USDC; infra $0 incremental (existing Railway).

## Milestone M1 (the first executable milestone)

**"Resell one external x402 resource at a spread, autonomously, on mainnet."**

Definition of done — ALL of:
1. `vnext_spread_ledger` contains ≥ 1 row with `is_test_data = false`, spread > 0.
2. `tx_in` (payer → Satelink, Base USDC) and `tx_out` (Satelink → external supplier) both verified on-chain by hand and recorded in `CHECKLIST.md`.
3. The payer is not a founder wallet and was not contacted by any human (T1).
4. The supplier was discovered by the crawler, not hand-entered (T2).
5. Zero human actions between the payer's request and the ledger write (T3).
6. All caps honored; kill switches tested before enable (T5-lite).

Sequence: build items B-1 → B-8 in `../03_ENGINEERING/BUILD_SEQUENCE.md`.

## Why this milestone preserves the 10-year architecture

M1 exercises every core noun (Resource, Supplier, Quote, SettlementPair, Score-stub) and both halves of the rail interface. Nothing about it is throwaway: scaling from 1 resource/1 supplier to K×N (Phase 2) changes loop bounds, not interfaces. And it is the smallest thing that can possibly produce autonomous revenue — anything smaller proves plumbing, not the business.

## Honest expectations (do not launder these later)

- **Revenue expectation for M1: cents.** Measured demand today is 3 paid calls [measured]; the pool of x402-paying agents is UNKNOWN. M1 proves the loop; it does not hit revenue targets. The legacy "$500/hr" target is not a Phase-1 number and is not repeated in vNext docs as a commitment.
- The first end-to-end run will likely be founder-triggered on the demand side (flagged test-data, excluded from every claim). T3 passes only on the first organic event, and there is **no guaranteed date for it** — it depends on ecosystem traffic we do not control. What we control: being listed (B-6), being cheapest-or-tied (pricing formula), and being reliable (probes).

## Phase-1 exit criteria

| Gate | Threshold |
|---|---|
| T1, T2, T3 | all passed with dated evidence |
| S-1 baseline | Bazaar listing count recorded (first ecosystem-volume ground truth) |
| P-1 A/B | two-margin pick-rate data collecting |
| Baseline | still 128 pass / 9 known-fail; live `/rpc` p50 within historical band |
| Caps audit | zero cap breaches, zero negative-spread rows (structurally impossible; verify anyway) |

## Phase-1 anti-goals

No new workload adapters. No reputation ML. No dashboard work beyond the read-only spread page. No outreach of any kind. No touching `contracts/`, `freeTierGate`, or settlement dry-run. No revenue projections published anywhere.
