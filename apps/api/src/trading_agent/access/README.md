# trading_agent/access — machine + AI-agent interface (Phase 6 item 11)

One core: agents and machines use the same orchestrator → scorecard → proposal path as humans.

| Endpoint (Stage 24 router, `/v1/trading`) | Scope | What |
|---|---|---|
| `POST /agent/opportunities/evaluate` | READ | GO / WAIT / REJECT JSON (persisted decision, `receipt_id`) |
| `POST /agent/proposals` | PROPOSE | proposal bound to a mandate, for human review (`mode_b_candidate` for EXECUTE keys) |
| `GET /agent/receipts/:id` | READ | the owner's persisted decision |

MCP tools: `evaluate_opportunity`, `propose_strategy`, `get_receipt`. Still no placeOrder, no withdraw.

- **Keys** (migration 035): one per agent/machine principal (`principals.kind`), issued by its human owner; only the SHA-256 is stored; scope READ / PROPOSE / EXECUTE_UNDER_MANDATE (needs a mandate).
- **Guard:** scope → 403, rate limit → 429, call / USD budget per day or month → 402.
- **Metering:** one usage row per call (idempotent by request id) + a `usage_charge` to the shadow revenue engine. Prices are a **DRAFT** (`machine-pricing/draft-0`), so usage goes to the **simulated** book only; publishing a price is a founder decision.
