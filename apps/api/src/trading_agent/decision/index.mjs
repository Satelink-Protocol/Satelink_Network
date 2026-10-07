// Scorecard + hard gates + GO/WAIT/REJECT (Phase 6 item 6). See README.md.
export const DOMAIN = 'decision';
export const TABLES = Object.freeze(['trading_decisions']);
export { SCORECARD_CONFIG, SCORE_MEANING } from './config.mjs';
export { DIMENSIONS, scoreDimensions, totalScore, confidenceOf } from './dimensions.mjs';
export { GATES, evaluateGates } from './gates.mjs';
export { decide, explain, DecisionService, DecisionOutcome } from './engine.mjs';
export { InMemoryDecisionStore, PgDecisionStore } from './store.mjs';
