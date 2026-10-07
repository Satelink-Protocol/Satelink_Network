# trading_agent/orchestrator — AI orchestrator + specialized agents (Phase 6 item 8)

The reasoning backbone. It routes a task to only the agents it needs, fetches their inputs through the
Stage 12 ToolRegistry (**READ tools only**, per-agent allow-list, checked at construction), wraps all
tool / market text as untrusted data, calls each agent through the tiered model router with a strict
output schema, and produces **a proposal + a decision request to the scorecard**. It never produces an
order and has no import path to the OMS, brokers, credentials or env.

| Task | Agents |
|---|---|
| `evaluate_opportunity` | Market, Regime-interpreter, Risk-explainer, Portfolio |
| `propose_strategy` | Strategy (drafts DSL → Stage 13 parser), Challenger (required before any GO) |
| `explain_decision` | Risk-explainer |
| `post_trade_review` | Review |

Numbers come only from the deterministic engines; the scorecard (`decision/`) decides. Agent text is
explanation. For a new strategy the challenger can only downgrade: a missing, failed or blocking
challenger turns GO into WAIT.
