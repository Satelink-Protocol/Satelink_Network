// Routing Decision Engine (Constitution §6) — the SINGLE source of routing truth.
//
// Pure, deterministic, explainable. No AI/LLM, no optimization, no I/O, no
// randomness, no wall-clock in the decision hash. Given the same candidates +
// policy it always yields the identical RoutingDecision (same decisionId,
// chosen, scores). It is injectable: a caller (kernel or composition layer)
// invokes `select()` and knows nothing about the scoring rules, which live
// only here. Reuses the production canonical_json hashing primitive.

import { hashObject } from '../../utils/canonical_json.js';
import { DIMENSIONS } from './policies.js';

function round(x) { return Math.round(x * 1e6) / 1e6; }

/** Per-candidate raw scores where HIGHER = better (before normalization). */
function rawBetter(c, context) {
  const acceptedRails = context.acceptedRails || null;
  const acceptedModes = context.acceptedModes || null;
  return {
    price: -(Number(c.price ?? 0)),                 // cheaper is better
    latency: -(Number(c.latencyMs ?? 0)),           // faster is better
    availability: Number(c.availability ?? 1),
    reputation: Number(c.reputation ?? 0),
    historicalSuccess: Number(c.historicalSuccess ?? 1),
    paymentCompatibility: acceptedRails ? (acceptedRails.includes(c.paymentRail) ? 1 : 0) : 1,
    settlementCompatibility: acceptedModes ? (acceptedModes.includes(c.settlementMode) ? 1 : 0) : 1,
    risk: 1 - Number(c.riskScore ?? 0),             // lower risk is better
  };
}

/** Min-max normalize each dimension across candidates to [0,1]; flat dim -> 1. */
function normalizeDimensions(rawList) {
  const out = rawList.map(() => ({}));
  for (const d of DIMENSIONS) {
    let min = Infinity; let max = -Infinity;
    for (const r of rawList) { if (r[d] < min) min = r[d]; if (r[d] > max) max = r[d]; }
    const span = max - min;
    for (let i = 0; i < rawList.length; i++) {
      out[i][d] = span === 0 ? 1 : (rawList[i][d] - min) / span;
    }
  }
  return out;
}

/** Normalize weights to sum to 1 (missing dims -> 0; all-zero -> equal). */
function normalizeWeights(weights) {
  const w = {};
  let sum = 0;
  for (const d of DIMENSIONS) { w[d] = Number(weights[d] ?? 0); sum += w[d]; }
  if (sum === 0) { for (const d of DIMENSIONS) w[d] = 1 / DIMENSIONS.length; return w; }
  for (const d of DIMENSIONS) w[d] = w[d] / sum;
  return w;
}

export class DecisionEngine {
  constructor({ clock } = {}) { this.clock = clock || (() => Date.now()); }

  /**
   * @param {Array<object>} candidates  supplier capability records
   * @param {{name:string, weights:object}} policy
   * @param {object} [context]  {acceptedRails?, acceptedModes?}
   * @returns {object} RoutingDecision
   */
  select(candidates, policy, context = {}) {
    if (!Array.isArray(candidates) || candidates.length === 0) throw new Error('DecisionEngine.select: no candidates');
    const weights = normalizeWeights(policy.weights || {});
    const norm = normalizeDimensions(candidates.map((c) => rawBetter(c, context)));

    const scored = candidates.map((c, i) => {
      const perDimension = {};
      let total = 0;
      for (const d of DIMENSIONS) { perDimension[d] = round(norm[i][d]); total += weights[d] * norm[i][d]; }
      return { supplierId: c.supplierId, candidate: c, perDimension, total: round(total) };
    });

    // Deterministic order: total desc, then supplierId asc (stable tie-break).
    scored.sort((a, b) => (b.total - a.total) || (a.supplierId < b.supplierId ? -1 : a.supplierId > b.supplierId ? 1 : 0));

    const winner = scored[0];
    const runnerUp = scored.length > 1 ? scored[1].total : 0;
    const confidence = round(winner.total <= 0 ? 0 : (winner.total - runnerUp) / winner.total);
    const leadDimension = DIMENSIONS.reduce(
      (best, d) => (weights[d] * winner.perDimension[d] > weights[best] * winner.perDimension[best] ? d : best),
      DIMENSIONS[0],
    );

    // decisionId excludes the timestamp so the identity is reproducible on replay.
    const core = {
      policy: { name: policy.name, weights },
      candidates: candidates.map((c) => c.supplierId),
      chosen: winner.supplierId,
      scores: scored.map((s) => ({ supplierId: s.supplierId, perDimension: s.perDimension, total: s.total })),
    };

    return {
      decisionId: 'dec_' + hashObject(core).slice(0, 24),
      timestamp: this.clock(),
      policy: core.policy,
      chosen: winner.candidate,
      rejected: scored.slice(1).map((s) => ({
        supplierId: s.supplierId,
        total: s.total,
        perDimension: s.perDimension,
        reason: `lower weighted score (${s.total} < ${winner.total})`,
      })),
      weightedScores: scored.map((s) => ({ supplierId: s.supplierId, total: s.total })),
      scores: core.scores,
      reason: `Selected ${winner.supplierId}: highest weighted score ${winner.total} under policy '${policy.name}' (led on ${leadDimension}).`,
      confidence,
    };
  }
}
