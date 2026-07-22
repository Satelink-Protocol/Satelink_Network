// Health scoring + reputation decay for the Supplier Intelligence Engine (M8).
// Pure, deterministic functions (no I/O, no clock) so scoring is reproducible
// and replay-safe. All inputs are plain observed metrics.

// Compose a 0..100 health score from observed benchmark metrics. Weights are
// explicit and sum to 1. Missing metrics use conservative defaults.
const WEIGHTS = Object.freeze({ availability: 0.35, successRate: 0.35, latency: 0.20, priceCompetitiveness: 0.10 });

// latency score: 0ms -> 100, >= LATENCY_CEILING -> 0 (linear).
const LATENCY_CEILING_MS = 3000;

function clamp01(x) { return Math.max(0, Math.min(1, x)); }
function round(x) { return Math.round(x * 100) / 100; }

/**
 * @param {object} m observed metrics for one supplier
 *  - availability: 0..1
 *  - successRate: 0..1
 *  - latencyMs: number
 *  - price, marketMedianPrice: for price competitiveness (cheaper vs median = better)
 * @returns {{score:number, breakdown:object}}  score in 0..100
 */
export function computeHealthScore(m = {}) {
  const availability = clamp01(Number(m.availability ?? 1));
  const successRate = clamp01(Number(m.successRate ?? 1));
  const latencyMs = Number(m.latencyMs ?? 0);
  const latencyScore = clamp01(1 - latencyMs / LATENCY_CEILING_MS);

  let priceScore = 0.5; // neutral when no market median to compare against
  const price = Number(m.price);
  const median = Number(m.marketMedianPrice);
  if (Number.isFinite(price) && Number.isFinite(median) && median > 0) {
    // cheaper than median -> >0.5, more expensive -> <0.5; clamped.
    priceScore = clamp01(1 - price / (2 * median));
  }

  const breakdown = {
    availability: round(availability),
    successRate: round(successRate),
    latency: round(latencyScore),
    priceCompetitiveness: round(priceScore),
  };
  const composite =
    WEIGHTS.availability * availability +
    WEIGHTS.successRate * successRate +
    WEIGHTS.latency * latencyScore +
    WEIGHTS.priceCompetitiveness * priceScore;
  return { score: Math.round(composite * 100), breakdown };
}

/**
 * Reputation decay: reputation moves toward the freshly observed health score,
 * at a rate set by `alpha` (EMA smoothing 0..1). A supplier that stops passing
 * benchmarks decays toward its low observed score; one that performs well climbs
 * toward it. Deterministic: same inputs -> same output.
 *
 * @param {number} current   current reputation 0..100
 * @param {number} observed  freshly observed health score 0..100
 * @param {number} alpha     smoothing factor (default 0.3)
 * @returns {number} new reputation 0..100 (integer)
 */
export function decayReputation(current, observed, alpha = 0.3) {
  const c = Math.max(0, Math.min(100, Number(current)));
  const o = Math.max(0, Math.min(100, Number(observed)));
  const a = Math.max(0, Math.min(1, Number(alpha)));
  return Math.round(c * (1 - a) + o * a);
}

/**
 * Idle decay: a supplier not observed for `missedRounds` benchmark cycles loses
 * reputation geometrically (uncertainty grows). Deterministic.
 */
export function idleDecay(current, missedRounds, perRound = 0.9) {
  const c = Math.max(0, Math.min(100, Number(current)));
  const r = Math.max(0, Number(missedRounds));
  return Math.round(c * Math.pow(Math.max(0, Math.min(1, perRound)), r));
}

export { WEIGHTS, LATENCY_CEILING_MS };
