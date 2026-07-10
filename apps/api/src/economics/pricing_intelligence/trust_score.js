// apps/api/src/economics/pricing_intelligence/trust_score.js
//
// Machine Preference Score — the number an autonomous buyer compares across
// providers. Every component is computed from live production data or a
// documented rubric over verifiable capability facts; a component whose data
// source is empty becomes null and is excluded (weights renormalize) instead
// of being invented. Caveats (e.g. single-node health sample) ship in the
// response — audit #17 says sample sizes must be visible, not implied.

const WEIGHTS = {
  price: 0.25,
  latency: 0.20,
  uptime: 0.20,
  payment_ease: 0.20,
  reliability: 0.15,
};

const clamp = (v, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));
const round1 = v => (v == null ? null : parseFloat(v.toFixed(1)));

/** Latency rubric over measured p50 (ms). */
function latencyScore(p50) {
  if (p50 == null) return null;
  if (p50 <= 50) return 95;
  if (p50 <= 75) return 90;
  if (p50 <= 100) return 85;
  if (p50 <= 150) return 75;
  if (p50 <= 250) return 60;
  if (p50 <= 500) return 40;
  return 20;
}

/**
 * Price rubric: relative to the verified market median per million requests.
 * At/below median scales 70→100 with the discount; above median decays as
 * median/price, plus a fixed +15 for zero-commitment pay-per-call (a real,
 * machine-verifiable property: no subscription, no monthly minimum).
 */
function priceScore(ourPerMillion, marketMedian) {
  if (marketMedian == null || !Number.isFinite(ourPerMillion)) return null;
  let base;
  if (ourPerMillion <= marketMedian) {
    base = 70 + 30 * (1 - ourPerMillion / marketMedian);
  } else {
    base = 70 * (marketMedian / ourPerMillion);
  }
  return clamp(base + 15);
}

/**
 * Payment-ease rubric over capability facts (each independently verifiable by
 * the caller): permissionless wallet onboarding +40, x402-native 402 flow +20
 * when the rail is enabled, no monthly minimum +15, machine-readable manifest
 * + 402 discovery +15, minimum deposit ≤ $1 +10.
 */
function paymentEaseScore({ x402Enabled, minDepositUsd }) {
  let s = 40 + 15 + 15; // wallet onboarding, no monthly minimum, manifest+402 discovery: always true
  if (x402Enabled) s += 20;
  if (minDepositUsd != null && minDepositUsd <= 1) s += 10;
  return clamp(s);
}

/**
 * @param {object} signals
 * @param {number|null} signals.p50LatencyMs       — node_health_logs 24h p50
 * @param {number|null} signals.availabilityPct    — node_health_logs 24h healthy %
 * @param {number|null} signals.errorRatePct       — node_health_logs 24h unhealthy %
 * @param {number|null} signals.healthSampleNodes  — distinct nodes in the sample
 * @param {number}      signals.ourPerMillionUsd
 * @param {number|null} signals.marketMedianUsdPerMillion
 * @param {boolean}     signals.x402Enabled
 * @param {number|null} signals.minDepositUsd
 */
export function computeMachinePreferenceScore(signals) {
  const components = {
    price: round1(priceScore(signals.ourPerMillionUsd, signals.marketMedianUsdPerMillion)),
    latency: round1(latencyScore(signals.p50LatencyMs)),
    uptime: signals.availabilityPct == null ? null : round1(clamp(signals.availabilityPct)),
    payment_ease: round1(paymentEaseScore(signals)),
    reliability: signals.errorRatePct == null ? null : round1(clamp(100 - signals.errorRatePct)),
  };

  let weightSum = 0, total = 0;
  for (const [key, score] of Object.entries(components)) {
    if (score == null) continue;
    weightSum += WEIGHTS[key];
    total += WEIGHTS[key] * score;
  }
  const overall = weightSum > 0 ? round1(total / weightSum) : null;

  const reasons = [];
  if (components.price != null && signals.marketMedianUsdPerMillion != null) {
    const pct = ((signals.ourPerMillionUsd - signals.marketMedianUsdPerMillion) / signals.marketMedianUsdPerMillion) * 100;
    reasons.push(pct <= 0
      ? `${Math.abs(pct).toFixed(0)}% below verified market median per million requests`
      : `${pct.toFixed(0)}% above market median per million, offset by zero monthly commitment (pure pay-per-call)`);
  }
  if (components.latency != null) reasons.push(`measured p50 latency ${signals.p50LatencyMs}ms over the last 24h`);
  if (components.uptime != null) reasons.push(`${signals.availabilityPct}% healthy checks over the last 24h`);
  reasons.push(signals.x402Enabled
    ? 'x402 instant payment enabled — pay per call with an HTTP header, no account'
    : 'wallet-signature onboarding, no email or human approval required');

  const caveats = [];
  if (signals.healthSampleNodes != null && signals.healthSampleNodes <= 1) {
    caveats.push(`latency/uptime/reliability sample covers ${signals.healthSampleNodes} node(s) — treat as a small sample`);
  }
  for (const [key, score] of Object.entries(components)) {
    if (score == null) caveats.push(`${key} component unavailable (no data) — excluded from the weighted score`);
  }

  return {
    score: overall,
    max_score: 100,
    components,
    weights: WEIGHTS,
    reasons,
    caveats,
    methodology:
      'Weighted average of available components; missing components are excluded and weights renormalized. ' +
      'price: rubric vs verified market median (+15 zero-commitment). latency/uptime/reliability: measured ' +
      'node_health_logs, last 24h. payment_ease: documented rubric over verifiable capability facts.',
  };
}
