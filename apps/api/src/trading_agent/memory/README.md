# trading_agent/memory — trading memory + feedback (Phase 6 item 9)

| Table (migration 034) | What | Mutability |
|---|---|---|
| `user_trading_profile` | risk tolerance, capital, max loss, markets, brokers | upsert, versioned |
| `strategy_memory` | per version: backtest / walk-forward / stress / paper / live / regime evidence, failure modes, revisions | append-only |
| `decision_memory` | decision → authorization → outcome (exactly one outcome per decision) | append-only |
| `trade_memory` | fills → P&L, regime, score, execution quality | append-only |
| `error_memory` | scope, code, bounded detail | append-only |
| `calibration_proposals` / `calibration_decisions` | feedback proposals and the single human decision on each | append-only |

- **Retrieval** (`MemoryService.contextFor`): structured, bounded (≤ 25 recent rows) context + a deterministic summary. No chat history is stored or returned.
- **Feedback** (`runFeedback`): outcome labels (GO decisions that ended in profit or loss) → per-dimension predictiveness → a calibration proposal for a NEW scorecard version (`scorecard/1.0 → 1.1`), stored as pending. Nothing changes until `decideCalibration` is called by a **staff human with a verified step-up**; agents, machines and the system cannot approve.
- **Strategy improvement** (`proposeStrategyRevision`): always v(n+1) via the Stage 13 StrategyService, starting at DRAFT; it must re-validate. The running version is never edited.
