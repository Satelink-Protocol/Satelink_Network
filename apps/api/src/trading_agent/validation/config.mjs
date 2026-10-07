// Versioned validation configs (Phase 6 item 5). A change is a new version, never an edit.
export const WALK_FORWARD_CONFIG = Object.freeze({
  version: 'walk-forward/1.0',
  inSampleBars: 200, outOfSampleBars: 50, stepBars: 50, warmupBars: 100, anchored: false, minWindows: 3,
});
export const STRESS_CONFIG = Object.freeze({
  version: 'stress/1.0',
  iterations: 1000, seed: 7,
  ruinDrawdownPct: '50',                  // a path whose drawdown reaches 50% counts as ruin
  feeMultipliers: Object.freeze(['2', '3']),
  slippageMultipliers: Object.freeze(['2', '5']),
  gaps: Object.freeze(['-0.1', '-0.2', '0.1']), // multiplicative gap applied from the middle bar onwards
});
