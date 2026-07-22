# Custom Adapter — Authoring Guide

> How to propose, build, and admit a new adapter. This doc is process, not a specific ecosystem — it is also, not incidentally, the spec for the **Phase-1 M1 adapter**: generic HTTP resale of arbitrary x402 Bazaar resources, which is a `CUSTOM_ADAPTER` instance before it's specialized enough to earn its own file.

## Step 1 — Scorecard first, code never before

Fill `../02_MARKET_VALIDATION/PAYING_ECOSYSTEM_SCORECARD.md`'s 13 questions with evidence tags. One NO → write the rejection in `MARKET_REJECTION_LOG.md` with a reopen trigger and stop. All YES → proceed.

## Step 2 — Implement the two interfaces

```js
// WorkloadAdapter (see ../01_ARCHITECTURE/CORE_ENGINE.md)
key() / discoverSuppliers() / probe(supplier) / execute(supplier, request) /
unitCost(supplier, request) / describeResource()
```
`discoverSuppliers()` must read only already-existing, machine-readable listings (Rule: Q6). If it requires a human to enter a supplier by hand, it is not an adapter — it is a one-off, and belongs nowhere in `06_ADAPTERS/`.

The adapter picks its `RailAdapter` from the existing roster (`x402-base`, later `erc20-polygon`) — it does not invent settlement.

## Step 3 — Ship dark, behind a kill switch

Every adapter ships with `VNEXT_ADAPTER_<KEY>_ENABLED=false` default, per-adapter outbound caps, and a probe that costs ≤ $0.001 or is free. Lifecycle: PROPOSED → SHADOW (probing, no money) → LIVE (caps + discovery listing) → PAUSED/RETIRED, per `../01_ARCHITECTURE/ADAPTER_SYSTEM.md`.

## Step 4 — Define the measurement plan before enabling

State, in the adapter's doc: which metric proves it earns (spread events, distinct suppliers, recurrence), and the date it will be read. No adapter goes LIVE without this written down first — this is the concrete mechanism behind First Principle #7.

## The M1 instance: generic HTTP resale

For Phase 1, `CUSTOM_ADAPTER` is not specialized to any named ecosystem beyond "x402 Bazaar-listed HTTP resources in general." `discoverSuppliers()` = the crawler (B-4) over the CDP facilitator's discovery list, filtered to resale-permissive, schema-simple resources (start with GET-style, single-parameter resources — closest in shape to RPC, easiest to probe for correctness generically). `execute()` = pass-through HTTP call. `unitCost()` = the listed price on the supplier's own 402 challenge.

This is deliberately the least specialized possible adapter — it exists to prove the loop (M1), not to be excellent at any one workload class. Once a named class (search, inference) reopens per its own trigger, it graduates out of `CUSTOM_ADAPTER` into its own file with class-specific probing/normalization.

## Anti-patterns (rejected on sight in review)

- An adapter whose `discoverSuppliers()` is a hardcoded list of one hand-picked partner — that's a deal, not an adapter.
- An adapter with no measurement plan.
- An adapter that reuses ARCHIVE-class code (`../03_ENGINEERING/KEEP_REMOVE_ARCHIVE.md`) — blocked by the H-3 import lint once it lands, manually enforced in review until then.
