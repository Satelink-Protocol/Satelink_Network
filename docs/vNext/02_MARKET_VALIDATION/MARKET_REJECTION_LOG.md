# Market Rejection Log

> Ecosystems evaluated and rejected, with the failing question(s), evidence, and the specific measurable trigger that reopens the evaluation. Rejection is a first-class output — this log is what keeps the roadmap from refilling with wishes.

Format: **Ecosystem — REJECTED (failing Qs) — evidence — reopen trigger.**

## 2026-07-20 evaluations

### Traditional RPC-as-product (Infura/Alchemy-class customers)
REJECTED (Q4, Q5, Q8). Evidence: demand acquisition is human signup — measured on our own 496k req/day: ~zero paid conversion despite PRs #241/#243–#248/#254 [measured]; settlement is card/invoice.
Reopen trigger: none for the human-funnel form. RPC lives on as self-supply behind x402 (ADR-002).

### AI inference aggregation (OpenRouter-style, fiat API keys)
REJECTED (Q4, Q5, Q8). Evidence: dominant rails are prepaid fiat API keys; joining as an aggregator means becoming a signup-based competitor (changes economics, human demand acquisition); automatic machine settlement absent on the dominant path.
Reopen trigger: ≥ 5 inference providers listed as x402 merchants with concrete per-token/per-request pricing on a crawlable index [crawler S-1 watches this]. This is the highest-value reopen on the board (unit prices 10²–10⁵× RPC). Details: `../06_ADAPTERS/AI_INFERENCE.md`.

### GPU compute (Akash, io.net, Vast.ai)
REJECTED (Q11, Q4; Q13 marginal). Evidence: these networks internalize matching/routing — the router seat is occupied by the protocol itself [protocol: Akash auction/bid model]; inserting a reseller changes economics (provider margin or deployer price must move to fit our spread); resale requires operating deployments (capex/ops beyond existing resources).
Reopen trigger: a GPU network exposes a broker/reseller API with machine settlement where third-party routing is native, OR GPU offers appear as x402 merchants.

### Decentralized storage (Filecoin, Arweave)
REJECTED (Q9, Q13). Evidence: deal-making has protocol-native matching; spread capture requires being a storage provider (hardware capex) or an aggregator with retrieval infrastructure; settlement per-deal is automatic but not per-unit-resalable by a thin intermediary with this team's resources.
Reopen trigger: paid retrieval markets (per-GB machine-settled) with listed suppliers become crawlable.

### Search / SERP APIs
REJECTED (Q8). Evidence: paying demand exists (per-query API pricing is public) but settlement is fiat API keys; no machine rail.
Reopen trigger: search merchants on x402 index. Note: this is a *likely early* reopen — search is agent-demanded, per-query priced, and floor-compatible ($0.001–0.01/query). Details: `../06_ADAPTERS/SEARCH.md`.

### Blockchain indexing (The Graph)
REJECTED (Q13, Q4). Evidence: the router seat (gateway) and settlement (GRT rebates) are protocol-internal; participating requires GRT stake and indexer operations — capital and ops beyond existing resources; joining alters economics via curation/delegation mechanics.
Reopen trigger: fixed-price machine-settled query market without stake requirements.

### General compute / FaaS resale
REJECTED (Q1-specificity, Q8). Evidence: "compute" is not one ecosystem; each candidate (cloud FaaS, Golem-class, TEE markets) fails on either fiat settlement or absent listed supply. No named payer class with machine settlement was verifiable.
Reopen trigger: evaluated per concrete candidate when one shows a crawlable priced supplier list + machine rail.

### Browser automation / scraping APIs
REJECTED (Q8; Q3 partially — pricing often account-tiered). Evidence: strong agent demand exists anecdotally (volume UNKNOWN); settlement is fiat keys; several providers' ToS prohibit resale.
Reopen trigger: browser-automation merchants on x402 index with resale-permissive terms.

### Video (transcoding/streaming, Livepeer-class)
REJECTED (Q11, Q13). Evidence: Livepeer internalizes orchestrator routing; joining as intermediary adds no measured efficiency; operating orchestrators is capex/ops.
Reopen trigger: per-job machine-settled transcode offers from listed suppliers outside protocol-internal routing.

### MEV (relay/searcher economics)
REJECTED (Q11, Q13, and mission fit). Evidence: hyper-competitive latency race; existing `mev_relay` code in repo [code: `workloads/mev_relay/`] never produced revenue; capital and latency infrastructure requirements exceed resources.
Reopen trigger: none contemplated. Code → archive class.

### Cold-outreach-driven anything
REJECTED permanently (violates Q5 by definition; founder explicitly rejected inferred-address cold email [memory 2026]).
Reopen trigger: none. Opt-in surfaces only.

## Process note
Every future proposal gets an entry here or a scorecard admission — silence about a considered market is not permitted. Re-evaluations append; original entries are never edited (same append-only discipline as the spread ledger).
