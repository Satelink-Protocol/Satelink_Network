// Versioned configs for the deterministic engines (Phase 6 item 4). A threshold change is a NEW
// version (new frozen object + version string), never an edit, so every engine output names the
// exact config it was computed with. All numbers are decimal strings (fixed-point, no floats).

export const REGIME_CONFIG = Object.freeze({
  version: 'regime/1.0',
  emaFast: 20, emaSlow: 50, atrPeriod: 14, volPeriod: 20, minBars: 60,
  trendThreshold: '0.015',      // |emaFast − emaSlow| / close ≥ 1.5% → trending
  rangeThreshold: '0.005',      // < 0.5% → ranging (between: the weaker of the two, by default ranging)
  highVolThreshold: '0.03',     // per-bar return stdev ≥ 3% → high_vol
  lowVolThreshold: '0.005',     // ≤ 0.5% → low_vol
  abnormalRangeAtr: '4',        // last bar range ≥ 4 × ATR → abnormal
  abnormalGap: '0.05',          // |open − previous close| / previous close ≥ 5% → abnormal
  minDataConfidence: 60,        // data confidence below this → uncertain
});

export const LIQUIDITY_CONFIG = Object.freeze({
  version: 'liquidity/1.0',
  depthBandBps: 50,             // depth counted within ±50 bps of mid
  maxSpreadBps: '25',           // spread above this → abnormal spread
  minDepthMultiple: '5',        // depth on the trade side must be ≥ 5 × order notional
  maxSlippageBps: '30',         // estimated slippage above this → insufficient liquidity
});

export const DATA_CONFIDENCE_CONFIG = Object.freeze({
  version: 'data-confidence/1.0',
  maxAgeMs: 120_000,            // freshness of the newest bar / quote (Stage 11 staleness policy)
  maxSourceDeviationBps: '20',  // sources disagreeing by more than this → penalty
  weights: Object.freeze({ freshness: 40, completeness: 35, agreement: 25 }), // sum 100
  maxGapRatio: '0.05',          // > 5% of expected bars missing → completeness 0
});
