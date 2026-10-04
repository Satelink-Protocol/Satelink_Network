# trading_agent/audit

**Status:** Stage 19 audit trail. `STATUS = 'skeleton'` = not wired: no routes, not mounted.

**Responsibility:** WHO / WHAT / WHEN / WHY for every trade. Audit-grade tables are **append-only for every role**, a W3C trace id follows each trade from the agent run to the fills, and a receipt answers **"Why did Satelink do this?"**.

**Tables:**
- **`audit_events`** (021), as audit 07 recommends. The existing `account_audit`, `automation_logs` and `audit_logs` are mutable or pruned.
- **Append-only:** migration 029 guards `audit_events`, `order_events`, `fills`, `strategy_versions`, `tool_calls`, `model_traces`, `kill_switch_events`, `reconciliation_events` and `portfolio_snapshots`.
- **Trace columns:** added on the chain tables.

| Module | Purpose |
|---|---|
| `trace_context.mjs` | W3C Trace Context (`traceparent`), AsyncLocalStorage propagation, mapping from the existing `X-Trace-ID` (UUID) |
| `traced_pool.mjs` | `tracedPool(pool)`: sets `satelink.trace_id` / `satelink.span_id` per checkout and clears them on release. Inject it wherever a pg pool goes |
| `receipt.mjs` | `TradeReceiptAssembler.explainOrder`: the receipt, with a completeness verdict, redacted and hashed, tenant-scoped |
| `source.mjs` | `PgReceiptSource`: read-only chain queries |

**Usage:** wrap the request or agent work in `runWithTrace(ctx, fn)` (or `fromRequestTraceId(req.traceId)`) and give stores `tracedPool(pool)`. Rows written later by workers (dispatcher, fill consumer) inherit the order's trace in the database.

**Not used:** no OpenTelemetry SDK (apps/api declares none); ids are W3C-compatible so one can adopt them. No logger is imported, and existing log formats are untouched.
