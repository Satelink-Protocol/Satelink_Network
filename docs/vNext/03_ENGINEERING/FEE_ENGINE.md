# Fee Engine — Implementation Notes (M5)

> Implementation documentation only (not architecture). Covers the Fee Engine, its security assumptions, red-team results, replay guarantees, edge cases, and the test matrix. Source: `apps/api/src/vnext/fees/{money,fee_engine,fee_ledger}.js`.

## What it is

Deterministic revenue calculator. Input `(RoutingDecision, ExecutionResult, SettlementContext, FeePolicy)` → `FeeInstruction`. The kernel never computes revenue; this does. Injectable, standalone (not wired into the frozen kernel).

Supported fee types: `zero`, `fixed`, `bps`, `percentage`, `spread`, `hybrid`, `subscription` (override), `dynamic` (tiered).

`FeeInstruction`: `{ version, txId, decisionId, feeType, feeAmount, currency, base, payer, receiver, settlementMode, splits?, explanation:{human,machine}, auditHash }`.

## Security assumptions

1. **All money is integer minor units in BigInt.** No JS float ever touches a monetary value. Amounts accepted as `bigint | integer-Number | digit-string`; floats, negatives, non-integers, and unsafe Numbers are rejected (`PRECISION` / `NEGATIVE` / `TYPE`).
2. **Fees are non-negative by construction.** Spread is floored at 0; a negative computed fee is an internal invariant violation (asserted, never returned).
3. **Rounding is ROUND_DOWN (floor), always**, via BigInt truncating division. Declared in `explanation.machine.rounding`.
4. **Currency coherence is enforced.** Every currency-bearing input (feePolicy, supplier, decision.chosen) must equal `settlement.currency`, else `CURRENCY_MISMATCH`.
5. **Determinism.** No `Date`/random/float. Identical inputs → byte-identical `FeeInstruction` and identical `auditHash = 'fee_' + sha256(canonical_json(core))` (reuses `utils/canonical_json.js`).
6. **Exactly-once at the ledger.** `FeeLedger.record()` is synchronous (atomic within Node's single thread); one journal entry per `txId`.
7. **bps bounded** to `[0, 10000]` (100%) by default; out of range → `BPS_RANGE`.
8. **Trust boundary:** the engine trusts that minor-unit amounts and currency codes are correct for the asset; it does not fetch prices or FX. It validates shape and coherence, not external truth.

## Replay guarantees

- **Recompute:** re-running `computeFee` with the same inputs yields the identical instruction + `auditHash`.
- **Journal replay:** `FeeLedger.replay(journal)` rebuilds the fee index from the hash-chain journal alone; reconstructed instruction deep-equals the original.
- **Tamper-evidence:** any mutation of a journaled fee payload makes `journal.verifyChain()` return `false`.
- **Dedupe:** replaying a record (same `auditHash`) is a no-op (no second charge); a different `auditHash` for the same `txId` is rejected (`FEE_MISMATCH`).

## Edge cases handled

zero base → zero fee · very large numbers (BigInt, no overflow) · spread ≤ 0 → 0 · bps 0 / 10000 boundaries · percentage ≤ 2 decimals (else `PRECISION`) · split remainder routed to primary receiver (exact sum, no leakage) · failed execution → zero fee · subscription override supersedes any configured type.

## Red-team results (attack → outcome)

| Attack | Outcome |
|---|---|
| negative fee (string/number config) | rejected `PRECISION` / `NEGATIVE` |
| negative spread | clamped to `0` (never negative) |
| overflow / very large numbers | exact via BigInt |
| duplicate settlement / double charge | deduped, single journal entry |
| replay attack | deduped, no new entry |
| journal tampering | `verifyChain()` → false |
| fee mismatch (same txId, different fee) | rejected `FEE_MISMATCH` |
| currency mismatch (supplier/policy/decision) | rejected `CURRENCY_MISMATCH` |
| precision loss / float input | rejected `PRECISION` |
| floating-point bps math | integer BigInt, exact |
| rounding leakage in splits | exact sum invariant enforced |
| large numbers | BigInt exact |
| zero amount | fee `0` |
| concurrent execution (same tick) | charged once |
| double charge | prevented (ledger once-per-txId) |
| subscription override bypass | override wins, cannot be bypassed |
| partner fee | routes exactly, sums to fee |
| multi-currency | rejected `CURRENCY_MISMATCH` |
| bps edge cases (0 / 10000 / 10001 / -1) | boundaries pass, out-of-range rejected |
| unknown fee type | rejected `CONFIG` |

All attacks fail to break the engine.

## Test matrix

- Functional: `test/vnext_fee_m5.test.js` — 11 tests (all 8 types + failed-exec + explanation + acceptance replay/journal).
- Adversarial: `test/vnext_fee_redteam_m5.test.js` — 16 tests covering the attack table above.

## Open risks

- **Not yet wired into the kernel ROUTE phase.** The frozen M1 kernel uses `FixedFeeAdapter`; integrating `FeeEngine` is a deferred one-line kernel change (see `docs/vNext/TODO.md`). Not done here (kernel is frozen).
- **Asset/decimals correctness is caller-supplied.** The engine enforces integer minor units and currency-code coherence but does not know an asset's decimal precision or real FX; passing wrong-scale amounts yields a correct fee over wrong inputs.
- **Splits are single-level** (primary + partners); nested/recursive partner trees are not modeled.
