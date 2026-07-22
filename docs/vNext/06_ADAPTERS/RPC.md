# Adapter: RPC

- **Status:** PROPOSED → target SHADOW in Phase 1 (B-5)
- **Kind:** Workload adapter, self-supply
- **Scorecard:** see `../02_MARKET_VALIDATION/PAYING_ECOSYSTEM_SCORECARD.md` — RPC-as-product REJECTED; RPC-as-supplier ADMITTED per ADR-002.

## What it is in vNext

Not a product. Supplier row #1 in the supply index: Satelink's own Polygon RPC capacity [code: `apps/api/src/workloads/rpc_gateway/`], competing on identical terms (price × health × latency × reputation) against any external RPC supplier the crawler finds.

## Interface implementation notes

- `discoverSuppliers()` — for this adapter, "discovery" includes Satelink's own gateway as a static entry, plus any external RPC-class merchants found via the Bazaar crawler (same crawl used for other adapters; filtered by resource schema).
- `unitCost(supplier, request)` — for self-supply: measured upstream Polygon node cost per call (not zero); for external: the supplier's listed price.
- `probe()` — `eth_blockNumber`-class cheap call; near-zero cost, run frequently.
- `execute()` — existing gateway logic, unchanged, wrapped.

## Evidence

- Capacity proven: 496,273 req/24h, p50 46ms [measured 2026-07-16].
- Pricing proven uncompetitive as a product: 965% above median [measured, PR #242] — irrelevant once formula-priced as resale (`PRICING_ENGINE.md`).
- Zero external supplier competition discovered yet — S-2 metric will report the true count post-crawl.

## Explicit boundary

No new RPC-specific features (new chains, new tiers, dedicated endpoints) are in scope for this adapter file. Any such proposal is a product decision requiring a reopened scorecard (ADR-002 guard).
