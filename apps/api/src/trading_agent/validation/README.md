# trading_agent/validation — walk-forward + stress / Monte Carlo (Phase 6 item 5)

Runs on the Stage 14 simulator (`backtest/run.mjs`) — no second simulator. Every result is labelled
**HYPOTHETICAL**, carries the Stage 14 disclaimer and a `resultHash`, and names its config version.

| File | What |
|---|---|
| `walk_forward.mjs` (`walk-forward/1.0`) | rolling or anchored IS/OOS windows with a FIXED strategy version; OOS runs get a warm-up prefix but only trades entered in the window count; efficiency = OOS P&L/bar ÷ IS P&L/bar (null if IS lost) |
| `stress.mjs` (`stress/1.0`) | seeded trade-order bootstrap (final equity / max drawdown p5-p50-p95, P(loss), P(ruin)); fee × k and slippage × k re-runs; multiplicative gap scenarios from the middle bar |

These feed the scorecard's out-of-sample and robustness dimensions (Phase 6 item 6).
