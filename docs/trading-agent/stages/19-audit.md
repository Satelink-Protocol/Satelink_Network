# Stage 19 — Audit trail, trace propagation, "Why did Satelink do this?"

**Branch:** `trading-agent/stage-19-audit`, stacked on Stage 18 (#474).

**Goal:** WHO / WHAT / WHEN / WHY for every trade:
- audit-grade tables that cannot be changed;
- one W3C trace id that follows a trade from the agent run through the risk decision, order and fills (to the ledger, once that is posted);
- a receipt that assembles the whole chain and says what's missing.

**Code:** `apps/api/src/trading_agent/audit/` (module table in its `README.md`).

**DB:** additive migration `029_audit_trail.sql`. Its down file is `database/migrations-down/029_audit_trail.down.sql` (local/ephemeral only).

**API:** internal only.

## Inspection and STOP evaluation

> STOP if: append-only enforcement conflicts with existing DB roles.

**Not triggered.**

**Audit 07 §4–5:** reuse the **new** `audit_events` (021). The existing `account_audit` (console), `automation_logs` and `audit_logs` (pruned after 30 days) are mutable or pruned. Audit 07 also records that **REVOKE-based append-only is inert in production**, because the app connects as the superuser `postgres` (see migration 004's header). Superusers bypass privilege checks.

**Roles today:** 017 creates `satelink_app` (NOSUPERUSER), grants it all DML, and revokes UPDATE/DELETE on `ledger_entries`. 021–028 revoke UPDATE/DELETE on the trading audit tables from PUBLIC and `satelink_app`.

**Decision:** enforce append-only with **triggers**. A `BEFORE UPDATE OR DELETE` row trigger and a `BEFORE TRUNCATE` statement trigger raise for **every role, superusers included**. **No role is created, altered, granted or revoked**, so nothing conflicts with the existing roles (verified: `satelink_app` still has INSERT and SELECT, and still no UPDATE).
- **Residual risk:** a superuser can still `ALTER TABLE … DISABLE TRIGGER` (the tests do exactly that to simulate tampering). Only repointing `DATABASE_URL` to `satelink_app` closes it (B-07 / audit 06 S-12, a founder decision).

**`financial_tables_guard`:** audit 07 suggested adding `audit_events` to it. It's a JS helper (`apps/api/src/utils/financial_tables_guard.js`) that stops the retention job deleting financial tables, and it lives outside this stage's allowed paths. `audit_events` is in no retention list, and the 029 trigger refuses any DELETE regardless. Adding it there is listed as a follow-up.

**Observability (audit 08 §6):** pino + `console`, prom-client, and **no tracing / APM / OpenTelemetry**. `@opentelemetry/api` exists only as a transitive dependency; `apps/api` doesn't declare it.
- **Decision:** native **W3C Trace Context** (the format OpenTelemetry propagates), with no new dependency or lockfile change.
- **Compatibility:** the existing `security/middleware/tracing.js` `X-Trace-ID` (a UUID) maps losslessly, since its 32 hex digits are a valid trace id (`fromRequestTraceId`).
- **No log format, logger or alerting path is touched** (brief §7; a static test confirms it).

## Append-only (migration 029)

`trading_append_only_guard()` is attached to **`audit_events`, `order_events`, `fills`, `strategy_versions`, `tool_calls`, `model_traces`, `kill_switch_events`, `reconciliation_events` and `portfolio_snapshots`**:
- per row, on UPDATE and DELETE;
- per statement, on TRUNCATE.

Corrections are new rows, as everywhere else in the trading module. Tables with their own lifecycle guards (`orders` 027, `mandates` 026, `backtests` 024, `risk_policies` 025) keep them.

## Trace propagation: agent_run → signal → risk → order → fill → ledger

The brief allows changes only in `trading/audit/**` and migrations, so propagation needs **no change to the Stage 12–18 stores**:

1. **Context:** `runWithTrace(ctx, fn)` keeps the current W3C context in AsyncLocalStorage (nesting and concurrency tested).
2. **Into Postgres:** `tracedPool(pool)` wraps any pg pool. On every checkout it runs `set_config('satelink.trace_id' / 'satelink.span_id')`, and it **clears them before release**, so a pooled connection never carries a stale trace to another caller. Inject it wherever the stores take a pool.
3. **Stamping:** `BEFORE INSERT` triggers set `trace_id`, `span_id` and `parent_span_id`:

| Rows | Source of the trace |
|---|---|
| `agent_runs`, `signals`, `orders`, `audit_events` (incl. `risk.decision`), `kill_switch_events` | the session context (`tracedPool`) |
| `order_events`, `fills` | **inherited from the parent order**, so the dispatcher and fill consumer, which run later and outside the request, stay on the trade's trace |
| `tool_calls`, `model_traces` | inherited from their `agent_runs` row |

4. **Ledger hop:** `fills.ledger_txn_id`. Trading P&L is not posted to the ledger yet (Stage 18), so the receipt reports **"not posted"** rather than inventing a hop.

## The receipt: "Why did Satelink do this?"

`TradeReceiptAssembler.explainOrder({ principalId, orderId })` walks:
- the order;
- the risk decision, by the order's own `risk_decision_id`;
- the signed mandate, checking the terms hash the order was accepted under;
- agent runs and tool calls, and signals, on the same trace;
- dispatch and venue events;
- fills;
- the ledger.

It returns WHO / WHAT / WHEN / WHY plus a **completeness verdict**: each hop is `ok` or listed in `missing`, including trace consistency across order events and fills. The body is redacted (Stage 12 `redact`) and content-hashed. Another tenant's order is `NOT_FOUND`, and another tenant's runs on a trace are excluded.

**A partial chain still produces a receipt**, with the gaps listed. That's exactly when a receipt matters, and a test found that a partial chain originally made the assembler throw (fixed).

### Sample trace (from the integration test's full MockBroker trade)

The receipt below is abridged; the full one is produced by `database/__tests__/trading-audit.integration.test.ts` with `DUMP_RECEIPT=path`. The agent's goal contained an API key on purpose; it appears as `[REDACTED]`.

```json
{
  "receipt": "satelink.trade-receipt/1.0",
  "question": "Why did Satelink do this?",
  "orderId": "ord_000007",
  "traceId": "c9067c4546bc3cb85c940cbbd8d32cf5",
  "traceparent": "00-c9067c4546bc3cb85c940cbbd8d32cf5-48ef56984b70d90a-01",
  "who": { "principalId": "prn_alice", "agentRuns": ["run_000002"],
           "actors": ["system:dispatcher", "system:oms", "system:risk-engine"], "mandateSignedBy": "prn_alice" },
  "what": { "instrument": "BTC-USDT", "side": "buy", "type": "market", "quantity": "0.002", "venue": "mock", "mode": "paper",
            "clientOrderId": "sl774d380d3319cf4c58e9d6829bdd0c", "brokerOrderId": "mock-ord-000001",
            "status": "filled", "filledQuantity": "0.002", "avgFillPrice": "30000" },
  "when": { "accepted": "2026-10-06T09:01:00.000Z", "sent": "2026-10-06T09:01:01.000Z",
    "timeline": [
      { "kind": "agent_run",           "detail": "run_000002 completed",                    "spanId": "01e2d4e77c37e1ab" },
      { "kind": "risk.decision",       "detail": "system:risk-engine",                      "spanId": "37906b3b618b337d" },
      { "kind": "order.accepted",      "detail": "∅ → approved (system:oms)",               "spanId": "529c5ed038f0e638" },
      { "kind": "order.dispatch",      "detail": "approved → submitted (system:dispatcher)", "spanId": "734f41836378d36b" },
      { "kind": "order.broker_status", "detail": "submitted → filled (system:dispatcher)",   "spanId": "619a321155dd6c94" },
      { "kind": "fill",                "detail": "0.002 @ 30000",                           "spanId": "63c3134c4aa4b3e9" } ] },
  "why": {
    "origin": "agent",
    "agentRuns": [{ "runId": "run_000002", "goal": "Buy a little BTC if momentum holds. (my api key is [REDACTED])",
                    "finalOutput": "Proposed a 0.002 BTC market buy for your approval.",
                    "toolCalls": [{ "seq": 1, "tool": "propose_order", "tier": "CONTROLLED", "status": "ok" }] }],
    "mandate": { "id": "mdt_000001", "mode": "A", "status": "active", "matchesOrder": true, "stepUpMethod": "totp",
                 "termsHash": "sha256:26ad0358…7bed", "signedAt": "2026-10-06T09:00:00.000Z" },
    "risk": { "decisionId": "rdc_000006", "decision": "APPROVE", "checksVersion": "risk-checks/1.0",
              "policy": { "id": "rsk_1", "version": 1 }, "checksPassed": 20, "checksTotal": 20 } },
  "fills": [{ "brokerFillId": "mock-fill-000001", "quantity": "0.002", "price": "30000", "feeMinor": "6", "feeCurrency": "USDT" }],
  "ledger": { "posted": false, "note": "not posted: trading P&L is not posted to the ledger (Stage 18)" },
  "completeness": { "complete": true, "missing": [] },
  "receiptHash": "sha256:5b10ca8e…ea43"
}
```

**How to read it:**
- **WHO:** Alice's agent run proposed; the dispatcher and the OMS acted; Alice had signed the mandate (TOTP step-up).
- **WHAT:** a filled 0.002 BTC market buy.
- **WHEN:** the timeline, one span per step.
- **WHY:** the agent proposed (and *could not place*), the order fit a signed mode-A mandate, and all 20 deterministic risk checks passed.

## Finding: the receipt caught a real Stage 17 bug (fixed here, disclosed scope exception)

The first full-trade receipt came back **incomplete** (`missing: ["fills"]`): the order was `filled` with fills totalling 0.002, but `orders.filled_quantity` was **0**.

- **Cause:** the Stage 10 `SubmitResult` carries a status but no filled quantity. The Stage 17 dispatcher recorded `filled` and kept the old quantity (0). A `FILLED` order is terminal, so the reconciler never revisits it, and the 027 trigger then freezes the wrong value for good.
- **Fix:** a **minimal, disclosed change outside this stage's allowed paths** (`oms/dispatcher.mjs`). When a submit result reports filled or partially filled without a quantity, the dispatcher takes the venue snapshot, which carries it, before recording.
- **Regression:** the Stage 17 unit test now asserts the filled quantity for FILL and PARTIAL; reverting the fix fails it.
- **Why not leave it:** the alternative was weakening the receipt's cross-check, which would have hidden a wrong position source.

**Other test adjustments, in tests only:**
- The Stage 13 integration test (tampering with `strategy_versions`) and the Stage 15 one (UPDATE / DELETE on `kill_switch_events`) now get the 029 refusal first.
- They then simulate a superuser bypass by disabling the trigger, the documented residual risk.

## Blocker impact

| Blocker | Touched? | Why the stage stays inside the accepted isolation |
|---|---|---|
| B-06 (no staging) | yes (migration 029) | applied only to local ephemeral Postgres; nothing deployed |
| B-07 (migration tooling / roles) | yes, **not resolved** | append-only now holds even for the superuser connection, but a superuser can disable triggers; repointing `DATABASE_URL` to `satelink_app` remains the fix (S-12) |
| B-10 (CI) | no | — |
| B-01–B-05, B-08, B-09, B-11 | no | not mounted; no logs, alerts, infra or roles changed |

No blocker changes status. The Stage 19 row is added to the acceptance log in `docs/trading-agent/BLOCKERS.md`.

## Test evidence (2026-10-05)

| Suite | Result |
|---|---|
| `apps/api/test/trading_audit.test.js` (mocha) | **12 passing** |
| `apps/api/test/trading_oms.test.js` (mocha, with the regression) | **28 passing** |
| Integration, local Postgres 16 (guard-DB recipe): `trading-audit` (3 new) + all Stage 09–18 suites, now running under 029 (021 round trip rolls back 029 → … → 024) | **38 passing** on 2 runs; temporary DBs dropped, none left behind |
| `scripts/ci-baseline-check.sh` | clean runs (×2): **777 tests / 657 pass / 2 known failures / 118 pending** (+12 vs Stage 18) |

**Baseline flakiness, reported honestly:** two earlier full runs failed timing-sensitive rate-limit suites (`identity_rate_limit`; `withdraw_rate_limit` "P0-08 wiring", which passes 2/2 alone three times). They sort before `trading_*` and run before any trading code loads. This is the same recurring full-suite flakiness noted since Stage 12.

### Brief acceptance mapping

**Immutability (§11),** in Postgres **as a superuser:**
- UPDATE and DELETE are refused on every guarded table that holds rows from the trade;
- TRUNCATE is refused on all 9;
- `satelink_app` privileges are unchanged (INSERT and SELECT yes, UPDATE no);
- INSERT still works.

**Full trace for a MockBroker trade (§11–12, "trace complete"):** an agent run (Stage 12, `propose_order` only) → a signed mandate (16) → acceptance with risk APPROVE (15) and the order (17), all inside one trace via `tracedPool`. Then the **untraced** dispatcher (17) and fill consumer (18) run on the raw pool. Results:
- `agent_runs`, `tool_calls`, `model_traces`, the `risk.decision` audit row, `orders`, `order_events` and `fills` **all carry the same trace id**;
- the dispatch event's `parent_span_id` is the order's span;
- the earlier mandate actions are on no trace (they're a separate action);
- the receipt is **complete**: origin agent, risk 20/20, mandate terms hash matches, dispatch, fills = filled quantity, consistent trace, ledger "not posted";
- the planted secret is absent;
- a pooled connection has no leftover trace afterwards.

**Redaction (§10):**
- a secret in the agent goal is redacted at write time (Stage 12) and again in the receipt;
- the receipt hash covers the redacted body and is deterministic;
- a static test confirms `audit/**` imports no logger, ledger, billing or settlement code and doesn't read the environment.

**Also covered:**
- W3C parsing and formatting (invalid headers ignored), UUID `X-Trace-ID` mapping, AsyncLocalStorage nesting and isolation;
- `tracedPool` hygiene: set and clear order, clearing outside a trace, a broken connection released on SET failure, double release;
- receipt hops missing one by one (risk missing or rejected, mandate hash mismatch, no fills, no dispatch, a trace mismatch on a fill);
- tenant scoping.

## Follow-ups (not in this stage)

- **Repoint production `DATABASE_URL` to `satelink_app`** (B-07 / S-12). Then REVOKE and the triggers both hold, and a compromised app can't disable triggers.
- **Wire `tracedPool` and `runWithTrace`** into the trading composition root and HTTP entry points (`fromRequestTraceId(req.traceId)`) when routes are mounted; persist `traceparent` on agent proposals for the approval step.
- **An OpenTelemetry exporter** (optional): the ids already follow W3C, so an OTel SDK can adopt them once a backend is chosen (audit 08: none today).
- **Add `audit_events`** (and the other append-only trading tables) to `utils/financial_tables_guard.js`.
- **The Stage 10 contract:** consider adding `filledQuantity` to `SubmitResult` so dispatchers don't need the follow-up lookup.

## Rollback

Revert the commit. On a local database, apply `029_audit_trail.down.sql` (before the 028 … 021 downs). The dispatcher fix reverts with it; Stage 17 alone still has the bug described above.
