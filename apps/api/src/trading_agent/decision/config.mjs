// Scorecard config (Phase 6 item 6). Versioned: a weight or threshold change is a NEW version
// (a calibration proposal from item 9 becomes 'scorecard/1.1' only after human approval).
//
// The score measures DECISION QUALITY — how well-evidenced and well-fitted an opportunity is under
// Satelink's rules. It is NOT a probability of profit and must never be presented as one.

export const SCORECARD_CONFIG = Object.freeze({
  version: 'scorecard/1.0',
  weights: Object.freeze({ // sum = 100
    strategy_edge: 15, backtest_quality: 10, out_of_sample: 15, risk_quality: 10, reward_risk: 10,
    regime_fit: 10, portfolio_fit: 10, execution_quality: 5, robustness: 10, data_confidence: 5,
  }),
  goScore: 65,                   // score below → WAIT
  goConfidence: 60,              // confidence below → WAIT
  decisionTtlMs: 15 * 60_000,    // a decision expires after 15 min (or earlier: mandate / validation expiry)
  validationMaxAgeMs: 7 * 24 * 3_600_000, // walk-forward / stress older than 7 days → gate fails
  minTrades: 30,                 // sample size for full confidence
  maxModelledVsRealisedSlippageBps: '15',
});

export const SCORE_MEANING = 'decision quality under Satelink rules (0–100); NOT a probability of profit';
