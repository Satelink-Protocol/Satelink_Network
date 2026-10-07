// Deterministic engines (Phase 6 item 4): pure functions shared by backtest, paper and live.
// No I/O, no clock (now is injected), no floats. See README.md.
export const DOMAIN = 'engines';
export { REGIME_CONFIG, LIQUIDITY_CONFIG, DATA_CONFIDENCE_CONFIG } from './config.mjs';
export { FEATURE_TYPES, STAGE13_TYPES, barsFromCandles, computeFeature, featureSnapshot, returns, volatility, vwap, isqrt, sqrtFx } from './features.mjs';
export { classifyRegime, Regime } from './regime.mjs';
export { analyzeLiquidity } from './liquidity.mjs';
export { assessDataConfidence } from './data_confidence.mjs';
