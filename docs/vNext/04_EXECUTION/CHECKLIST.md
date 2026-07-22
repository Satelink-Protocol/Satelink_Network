# Execution Checklist

> The single live tracking surface for vNext. Append-only per item: check things off with dates and evidence links; record failures as first-class entries. Anything claimed done without a date+evidence pair is not done.

## Phase 1 — build (see BUILD_SEQUENCE.md for specs)

- [ ] B-1 vnext schema + append-only ledger DAO (baseline 128/9 intact)
- [ ] B-2 RailAdapter wrap of inbound x402 (zero behavior change verified)
- [ ] B-3 outbound payer ported from x402-kit; caps enforced in code; ships dark
- [ ] B-3a outbound wallet created + funded ≤ $25 USDC (founder action; address recorded here: ______)
- [ ] B-4 Bazaar crawler + probes behind `VNEXT_CRAWL_ENABLED`
- [ ] B-5 `/x/<slug>` resale loop end-to-end in Shadow rail
- [ ] B-5a chaos assertions (T5-lite) pass in Shadow
- [ ] B-6 concrete discovery listings live (wildcard `/rpc/:var1` superseded); A/B margin slugs listed
- [ ] B-7 M1: first spread event (see gates below)
- [ ] B-8 `/vnext/admin/spread` live; numbers reproducible from SQL

## Phase 1 — measurements (record value + date; UNKNOWN until measured)

- [ ] S-1 Bazaar total listing count: ______ (date: ______) — first ecosystem-volume ground truth
- [ ] S-2 routable external suppliers after first crawl+probe: ______ (date: ______)
- [ ] P-1 two-margin pick-rate: A(+20%): ____ picks / B(+40%): ____ picks (window: ______)
- [ ] D-1 distinct non-founder payers, first 30 days of `/x/*`: ______

## M1 gates (all required, with evidence links)

- [ ] T1 autonomous demand event — ledger row id: ______, payer: ______
- [ ] T2 autonomous supply event — supplier id: ______, source: bazaar-crawl
- [ ] T3 autonomous spread event — tx_in: ______, tx_out: ______, spread: $______
- [ ] on-chain manual verification of both txs (verifier + date: ______)
- [ ] zero cap breaches, zero negative-spread rows (query + date: ______)

## Hygiene (interleaved)

- [ ] H-1 gateway/core file-level live/dead pass → archive manifest
- [ ] H-2 30-day traffic counts per experimental mount (defi/bridge/bandwidth/oracle/mev): recorded ______
- [ ] H-3 import lint (vnext ✗→ archive-class) in CI

## Phase 2 gates

- [ ] T4 recurrence (2 distinct weeks, non-founder): weeks ______ / ______
- [ ] B-9 scored routing live; B-10 catalog ≥ 5 external suppliers; B-11 T5 full drill log: ______
- [ ] T6 zero-touch week: PASS/FAIL (date: ______; if FAIL, intervention log → backlog items: ______)
- [ ] B-13 orphan roots archived (PR: ______)

## Phase 3 gates

- [ ] B-14 rail #2 spread event fully on erc20-polygon: tx_in ______ tx_out ______
- [ ] B-15 second workload adapter admitted via scorecard (or dated non-firing recorded in rejection log)
- [ ] structural review ADRs written from measured data

## Standing rules for this checklist

1. Failures get logged, not erased: `FAILED <date>: <what> — <why> — <next>` under the relevant item.
2. Every number here must be reproducible from a ledger/SQL query or a chain explorer; dashboard screenshots are not evidence.
3. Caps changes, flag enables, and wallet fundings are founder actions — initialed here when done.
