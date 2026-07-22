# Autonomy Tests

> "Autonomous" is a measurable property, not an adjective. A flow is autonomous only if it passes these tests with zero human actions in the transaction path. Each test states its metric, its data source, and its read date. Tests are pass/fail; "almost" is fail.

## T1 — Autonomous demand event
**Claim tested:** a machine Satelink never contacted can discover, pay, and consume a resource.
**Method:** spread-ledger rows where `payer_addr` is non-founder (`is_test_data = false`) AND the payer address has no prior relationship (not in any legacy customer/key table).
**Pass:** ≥ 1 such row. **Status 2026-07-20:** PASS on the inbound half historically (Jul 9–10 external-EOA settlements [measured]) — but those predate the spread ledger; vNext requires re-demonstration through the ledger. Current ledger count: 0 (ledger not yet built).

## T2 — Autonomous supply event
**Claim tested:** a supplier Satelink never contacted is discovered, probed, priced, and made routable by machine.
**Method:** `vnext_suppliers` rows with `source = 'bazaar-crawl'`, probe-passed, zero human edits (audit trail).
**Pass:** ≥ 1 external routable supplier. **Status:** 0 — crawler not yet built (build item #2).

## T3 — Autonomous spread event (THE test — M1's definition of done)
**Claim tested:** one unit of work where settle-in, route, pay-out, execute, and ledger-write all occur with zero human actions, spread > 0, both tx refs chain-verifiable.
**Method:** spread ledger row, `is_test_data = false`, manual verification of `tx_in` and `tx_out` on-chain for the first event; automated sample verification thereafter.
**Pass:** ≥ 1 row. **Status:** 0. **Note:** the *first* such event may be founder-triggered on the demand side to prove the pipe (flagged `is_test_data = true` and excluded from all revenue claims); T3 passes only on the first non-founder event.

## T4 — Recurrence without intervention
**Claim tested:** the system earns while nobody is working on it.
**Method:** spread events (real rows) in ≥ 2 distinct calendar weeks, with a change-freeze audit confirming no deploys or manual actions were required between them.
**Pass:** yes/no per 14-day window.

## T5 — Autonomous failure containment
**Claim tested:** the system loses at most capped amounts when things break, without a human noticing first.
**Method:** chaos drill each phase: kill the best supplier mid-traffic; assert breaker opens, failover or clean 502-no-charge occurs, spread never negative, caps never breached. Run in Shadow rail first, then live with minimal caps.
**Pass:** all assertions hold in the drill log.

## T6 — Zero-touch week (Phase 2 gate)
**Claim tested:** full loop — crawl, probe, quote, settle-in, route, pay-out, ledger — for 7 consecutive days with zero human actions (deploy freeze, no manual wallet ops, no config edits).
**Pass:** yes/no. This is the definition of "Autonomous Revenue OS" being real rather than aspirational.

## Standing measurement discipline

- All tests read exclusively from `vnext_spread_ledger`, `vnext_suppliers`, `vnext_route_log`, and chain data. Dashboards are not evidence (this repo fabricated dashboards once [measured: 11/13 pages, fixed #267]; never trust a rendered number over a ledger row).
- Results are recorded with dates in `../04_EXECUTION/CHECKLIST.md`, including failures. A failed test with a date is progress; an unrun test claimed as passing is the cardinal sin of the previous era.
