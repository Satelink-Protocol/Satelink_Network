# trading_agent/decision — scorecard + hard gates + GO / WAIT / REJECT (Phase 6 item 6)

Deterministic; no LLM. **The score is decision quality, NOT a probability of profit.**

- **Inputs:** strategy version, backtest, walk-forward, stress, regime, portfolio fit, liquidity, execution quality (modelled vs estimated slippage), data confidence, mandate, capital / account (via the risk context), broker state.
- **Score (0–100):** 10 weighted dimensions (`scorecard/1.0`, weights sum 100). A missing input scores 0 and costs 5 confidence points — never neutral.
- **Confidence (0–100):** sample size, IS/OOS agreement, data confidence.
- **Hard gates:** the Stage 15 risk engine (`evaluateChecks`, all 20 checks, unchanged) + kill switch, stale data, broker unavailable, insufficient liquidity, abnormal spread, mandate expired, validation expired.
- **Rule:** any gate FAIL → REJECT; score < 65 or confidence < 60 → WAIT; otherwise GO.
- **Output:** `{decision, score, confidence, failed_gates[], dimension_scores, strategy_version, data_timestamp, expires_at, evidence_refs[], explanation_ref}` (+ explanation, input hash, config version).
- **Persistence:** every decision → `trading_decisions` (migration 033, append-only). An unrecorded decision is downgraded to REJECT (`record_failed`).
