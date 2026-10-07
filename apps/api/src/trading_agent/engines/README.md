# trading_agent/engines — deterministic engines (Phase 6 item 4)

Pure functions over Stage 11 normalized data and Stage 13 fixed-point bars (bigint at 1e18,
half-even rounding). No I/O, no clock (`now` injected), no floats — so backtest, paper and live
compute bit-identical values. Every output names its versioned config (`config.mjs`).

| Engine | Input | Output |
|---|---|---|
| `features.mjs` | bars | SMA / EMA / RSI / ATR / highest / lowest (delegated to Stage 13 unchanged) + VWAP, returns, volatility |
| `regime.mjs` (`regime/1.0`) | bars + data confidence | primary uncertain / abnormal / trending / ranging, volatility high_vol / low_vol / normal, direction, reasons, metrics |
| `liquidity.mjs` (`liquidity/1.0`) | order book (+ intended order) | spread bps, depth ±50 bps, imbalance, book-walk fill and slippage, flags `abnormal_spread` / `insufficient_liquidity` |
| `data_confidence.mjs` (`data-confidence/1.0`) | candles + quotes from several sources + now | 0–100 score from freshness (Stage 11 staleness), completeness (gaps / duplicates), source agreement |

The flags and scores feed the scorecard's hard gates (Phase 6 item 6). The LLM never computes
any of these (`deterministic` tier, `agent/tiers.mjs`).
