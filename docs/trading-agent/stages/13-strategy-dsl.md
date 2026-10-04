# Stage 13 — Strategy DSL

**Branch:** `trading-agent/stage-13-strategy-dsl`, stacked on `trading-agent/blocker-register` (#468), which sits on Stage 12 (#467).

**Goal:** deterministic, auditable strategies. A strategy is a JSON document that is validated, canonicalised and content-hashed, then compiled to a pure evaluator. Every version is immutable and moves through a guarded lifecycle.

**Code:** `apps/api/src/trading_agent/strategies/` (module table in its `README.md`).

**DB:** no migration. It uses the Stage 09 tables `strategies`, `strategy_versions` and `audit_events`.

**API:** internal only. The module is not mounted and not imported by `app_factory.mjs` / `server.js`.

## Inspection and STOP evaluation

> STOP if: the schema library conflicts with existing validation standards.

**Not triggered.**

| Finding | Evidence |
|---|---|
| `apps/api` declares no schema library | `apps/api/package.json`: no ajv / zod / joi / yup |
| `zod` is used only by the web tier and content | `apps/web` (zod ^4), `packages/content` (zod ^3); 6 files; none in `apps/api` |
| `ajv` is transitive only | via `@modelcontextprotocol/sdk` and `@x402/extensions`; never imported by product code |
| The `apps/api` convention is hand-written schema modules | `pricing_v2/schema.mjs`, `plans/plans_schema.mjs`, `console_accounts/schema.mjs`, Stage 12 `agent/schema.mjs` |

**Decision:** a dependency-free validator inside `strategies/`, so there is no lockfile change and no new dependency. The DSL itself is a standard JSON Schema 2020-12 document. Any ajv-class validator can read it; its one custom keyword (`x-decimal`) is an annotation that standard validators ignore.

**Document A:** "Document A" (the brief's reference example) is still not in the repo or Downloads, as at Stage 12. DSL v1.0 below is a substitute designed to the brief's constraints. If Document A turns up, it is reconciled as **v1.1 or v2.0, never by editing v1.0**, because editing v1.0 would change stored hashes.

## DSL v1.0

```json
{
  "dsl": "satelink.strategy/1.0",
  "name": "BTC trend (SMA 10/30)",
  "description": "optional, ≤ 2000 chars",
  "universe": { "venue": "binance", "instruments": ["BTC-USDT", "ETH-USDT"] },
  "timeframe": "1h",
  "indicators": {
    "fast":  { "type": "sma", "period": 10 },
    "slow":  { "type": "ema", "period": 30, "source": "close" },
    "rsi14": { "type": "rsi", "period": 14 },
    "atr14": { "type": "atr", "period": 14 }
  },
  "entry": { "all": [
    { "cross": { "dir": "above", "left": { "ind": "fast" }, "right": { "ind": "slow" } } },
    { "cmp":   { "op": "lt", "left": { "ind": "rsi14" }, "right": { "const": "70" } } } ] },
  "exit":  { "any": [
    { "cross": { "dir": "below", "left": { "ind": "fast" }, "right": { "ind": "slow" } } },
    { "cmp":   { "op": "gt", "left": { "ind": "rsi14" }, "right": { "const": "80" } } } ] },
  "position":  { "side": "long", "sizing": { "mode": "fixed_notional", "notional": "250.00", "currency": "USDT" } },
  "risk":      { "stopLossPct": "2.5", "takeProfitPct": "6", "maxHoldingBars": 240 },
  "execution": { "orderType": "limit", "limitOffsetBps": 5, "cooldownBars": 3 }
}
```

This is the golden fixture. Its hash is pinned in the tests: `sha256:24a3a6ef476919421b90c4b040fa4ef030a7716ef8088145a674898c6db10f21`.

| Field | Bounds |
|---|---|
| `universe.venue` | `binance`, `alpaca`, `upstox`, `mock` (= Stage 10 `Venue`) |
| `universe.instruments` | 1–10 unique, canonical Stage 10 ids (`BTC-USDT`, `NSE:RELIANCE`) |
| `timeframe` | `1m 5m 15m 1h 4h 1d` (= Stage 11 intervals) |
| `indicators` | ≤ 16, id `^[a-z][a-z0-9_]{0,31}$`. `sma` / `ema` / `highest` / `lowest` period 2–500; `rsi` / `atr` 2–200; `source` open/high/low/close (default close) |
| Conditions | `all` / `any` (1–16 items), `not`, `cmp` (`gt gte lt lte`), `cross` (`above below`). Depth ≤ 8; ≤ 64 nodes across entry + exit |
| Operands | `{ind}` (must be defined), `{price}`, `{const}` decimal string ±1e12, ≤ 12 dp |
| `position.sizing` | `fixed_quantity` (0 < q ≤ 1e9, ≤ 12 dp) or `fixed_notional` (0 < n ≤ 1e9, ≤ 8 dp, USDT/USDC/USD/INR); `maxOpenPositions` 1–10 |
| `risk` | **`stopLossPct` mandatory**, 0.01–50, ≤ 4 dp; `takeProfitPct` 0.01–1000; `maxHoldingBars` 1–100000 |
| `execution` | `orderType` market/limit; `limitOffsetBps` 0–500 (limit only); `cooldownBars` 0–10000 |
| Whole document | ≤ 32 KiB canonical, nesting ≤ 24, ≤ 4096 JSON nodes |

**Validation rules:**
- Unknown fields are rejected at every level.
- Money and percentages are decimal **strings**; JS numbers are rejected.
- Integers must be safe integers.
- `__proto__` / `constructor` / `prototype` keys, non-JSON values and cycles are rejected.

**Semantic checks:**
- unknown indicator references;
- comparing two constants;
- comparing an operand with itself;
- `limitOffsetBps` on market orders;
- a blank name.

## Canonicalisation and hash

`parseStrategyDsl` runs these steps in order:
1. version dispatch (own-property lookup);
2. iterative shape check;
3. schema validation;
4. **normalisation:** defaults applied, decimals canonical (`"250.00"` → `"250"`), strings NFC;
5. re-validation;
6. semantic checks;
7. size check;
8. **RFC 8785 (JCS)** canonical JSON;
9. `sha256:` hash.

`strategy_versions.definition` stores the normalised document and `definition_hash` stores its hash, so what is stored is exactly what was hashed. Reads re-derive the hash; a mismatch is `CONFLICT`. Postgres JSONB reorders keys, and that is harmless, because the hash is over the canonical form.

## Compiler → pure evaluator

`compileStrategy` refuses a definition that doesn't match its hash. It returns a frozen object whose `evaluate({candles, position?, barsSinceLastExit?})`:
- has no I/O, clock, randomness or shared state;
- uses 18-dp fixed-point bigint arithmetic with half-even rounding, and only + − × ÷;
- returns `enter` / `exit` / `hold` with reasons;
- checks exits in priority order: `stop_loss` (bar low/high) > `take_profit` > `max_holding` > `exit_rule`, with a `cooldown` on entry.

It never sizes, routes or places an order.

## Lifecycle (per version; append-only in `audit_events`)

```
DRAFT ──► BACKTESTED ──► PAPER ──► LIVE_SMALL ──► LIVE
  │            │           │  ▲         │  ▲        │
  │            │           ▼  │         ▼  │        ▼
  │            │          PAUSED ◄──────────────────┘   (resume only to paused-from, or demote to PAPER)
  └────────────┴───────────┴──────────────────────────► RETIRED (terminal; from any state)
```

| Edge | Who | Evidence | Flags |
|---|---|---|---|
| DRAFT → BACKTESTED | human, platform | `backtest {backtestId, definitionHash = version hash, bars ≥ 500, passed: true}` | — |
| BACKTESTED → PAPER | human | `approval {approvedBy = actor}` | TRADING_AGENT |
| PAPER → LIVE_SMALL | human | approval + `paper {definitionHash, days ≥ 14, trades ≥ 10}` + `mandateId` | TRADING_AGENT, LIVE_SMALL, **LIVE_TRADING (LOCKED)** |
| LIVE_SMALL → LIVE | human | approval + `liveSmall {definitionHash, days ≥ 30, trades ≥ 20}` + `mandateId` | TRADING_AGENT, **LIVE_TRADING (LOCKED)** |
| PAPER / LIVE_SMALL / LIVE → PAUSED | human, platform | `reason` | — |
| PAUSED → PAPER | human | approval | TRADING_AGENT |
| PAUSED → LIVE_SMALL / LIVE (only to paused-from) | human | approval + `mandateId` | as for entering that state |
| any non-RETIRED → RETIRED | human | `reason` | — |

**Rules:**
- **Every other pair is `ILLEGAL_TRANSITION`.**
- **Agents can never move a strategy, author one, or create a version.**
- **Ownership:** a human may only act on their own strategy. A non-owner gets `NOT_FOUND`, so existence doesn't leak across tenants.
- **One deployed version per strategy** (PAPER, LIVE_SMALL, LIVE or PAUSED).
- **Concurrency:** each transition takes a `SELECT … FOR UPDATE` on the strategy row and checks `expectedFrom`. Two racing callers cannot both win.
- **Flags** come only from an injected `env`, which defaults to `{}` (all off). `process.env` is never read.

**021 constraint:** `strategies.status` CHECK allows only `draft | active | paused | archived`. The 7 states therefore live in `audit_events` (`action='strategy.lifecycle'`), the strategy row carries a projection, and no migration was added. A future migration may add a dedicated lifecycle column; that is founder-gated.

## Blocker impact

| Blocker | Touched? | Why the stage stays inside the accepted isolation |
|---|---|---|
| B-06 (no staging) | yes (writes to 021 tables) | exercised only on local ephemeral Postgres; no shared DB; nothing deployed |
| B-07 (migration tooling) | no new migration | uses 021 as-is |
| B-08 / B-09 (KMS, scope, legal) | no | no venue access, no credentials, no orders. LIVE_SMALL / LIVE are unreachable because `LIVE_TRADING` is LOCKED, and a test asserts it |
| B-03 / B-10 (unauthenticated routes, CI) | no | not mounted (the register test checks `app_factory.mjs` / `server.js`) |
| B-02 (staff auth) | deferred | lifecycle approvals are data (`approval.approvedBy = actor`); a human approval UI is not built |
| B-01, B-04, B-05, B-11 | no | — |

No blocker changes status. The Stage 13 row is added to the acceptance log in `docs/trading-agent/BLOCKERS.md`.

## Test evidence (2026-10-04)

| Suite | Result |
|---|---|
| `apps/api/test/trading_strategy_dsl.test.js` (mocha) | **31 passing** |
| Integration, local Postgres 16 (guard-DB recipe): `trading-strategy-dsl` (3 new) + `trading-agent-traces` + `trading-market-data` + `trading-foundation` | **13 passing**; temporary DBs dropped, none left behind |
| `scripts/ci-baseline-check.sh` | **656 tests / 536 pass / 2 known failures / 118 pending**, no new failures (blocker-register baseline was 625/505, so +31/+31) |

### Brief acceptance mapping

- **Schema fuzz:**
  - 3,000 seeded random JSON values only ever produce `StrategyError`s with known codes.
  - 2,000 seeded mutations of the golden document are either rejected with a known code or accepted and fully consistent: schema-valid, hash re-derives, normalisation is idempotent, and it compiles.
  - **The fuzzer found a real bug:** `"dsl": "__proto__"` resolved to `Object.prototype` and crashed. It is fixed with an own-property lookup and has a regression test.
- **Hash stability.** Acceptance: *identical DSL → identical hash across runs*.
  - 200 random key orders × JSON whitespace variants all give the golden hash.
  - Two separate Node processes compute the pinned golden hash.
  - Equivalent spellings hash the same: `"250"` vs `"250.00"`, explicit vs omitted defaults, NFD vs NFC.
  - Every semantic change hashes differently.
- **Illegal transitions rejected:**
  - All 7×7 state pairs (× paused-from variants) are checked against the exact legal edge set.
  - Every illegal pair is `ILLEGAL_TRANSITION`, even with all flags on.
  - Agents are rejected on every edge.
  - Evidence must be bound to the version hash, and thresholds are enforced.
  - LIVE_SMALL and LIVE are refused while `LIVE_TRADING` is locked.
- **Bounded ranges / unknown fields:** 27 out-of-range or wrong-type cases, unknown fields at 9 levels, and depth/node/size limits, including 100,000-deep nesting and a cyclic object, all without stack overflow.

**Mutation checks** (each change temporarily applied, then reverted). Every one made the suite fail:
- the validator's strict default removed;
- `risk` allowing unknown fields;
- the `__proto__` lookup regression;
- LIVE_SMALL without LIVE_TRADING;
- agents allowed to promote;
- unsorted canonical keys;
- no decimal normalisation;
- no optimistic state check.

## Follow-ups (not in this stage)

- **Producers of lifecycle evidence:** a backtester (`bkt_…`), a paper runner (`ppr_…`) and a live-small runner (`lsr_…`) are later stages. Today the guards only check that the evidence is well formed and bound to the hash.
- **A human approval UI is blocked by B-02.**
- **A dedicated lifecycle column/table** would need a founder-gated migration.
- **Reconcile with Document A** if it is found, as a new DSL version.
- The Stage 12 READ tool `get_strategy` can be backed by `StrategyService.getVersion` when the read ports are implemented.

## Rollback

Revert the commit. There's no migration and no runtime wiring, so nothing to undo in any database.
