// GO / WAIT / REJECT decision engine (Phase 6 item 6). Deterministic; no LLM.
//
//   any hard gate FAIL                         → REJECT  (a high score never overrides a failed gate)
//   score < goScore OR confidence < goConfidence → WAIT
//   otherwise                                  → GO
// Every decision is persisted (append-only, migration 033). A decision that cannot be recorded is
// not returned as GO: the engine downgrades it to REJECT with gate 'record_failed'.
import { SCORECARD_CONFIG, SCORE_MEANING } from './config.mjs';
import { scoreDimensions, totalScore, confidenceOf } from './dimensions.mjs';
import { evaluateGates } from './gates.mjs';
import { canonicalJson, contentHash } from '../strategies/canonical.mjs';

export const DecisionOutcome = Object.freeze({ GO: 'GO', WAIT: 'WAIT', REJECT: 'REJECT' });

/** Pure scoring: inputs → decision object (no id, no persistence). */
export function decide(input, { now, cfg = SCORECARD_CONFIG } = {}) {
  if (!(now instanceof Date)) throw new Error('decide needs an injected now');
  const dims = scoreDimensions(input, cfg);
  const score = totalScore(dims, cfg);
  const confidence = confidenceOf(input, dims, cfg);
  const { failed, riskResult } = evaluateGates(input, cfg, now);
  const decision = failed.length > 0 ? DecisionOutcome.REJECT
    : score < cfg.goScore || confidence < cfg.goConfidence ? DecisionOutcome.WAIT : DecisionOutcome.GO;

  // expiry: TTL, but never beyond the mandate or the validation evidence
  const candidates = [now.getTime() + cfg.decisionTtlMs];
  const mv = input.riskContext?.mandate?.validUntil;
  if (Number.isFinite(typeof mv === 'number' ? mv : Date.parse(mv ?? ''))) candidates.push(typeof mv === 'number' ? mv : Date.parse(mv));
  for (const k of ['walk_forward', 'stress']) {
    const at = input.validationTimes?.[k];
    if (at) candidates.push(Date.parse(at) + cfg.validationMaxAgeMs);
  }
  const expiresAt = new Date(Math.max(now.getTime(), Math.min(...candidates))).toISOString();

  const evidenceRefs = [
    input.backtest?.resultHash && `backtest:${input.backtest.resultHash}`,
    input.walkForward?.resultHash && `walk_forward:${input.walkForward.resultHash}`,
    input.stress?.resultHash && `stress:${input.stress.resultHash}`,
    input.regime?.configVersion && `regime:${input.regime.configVersion}:${input.regime.primary}`,
    input.liquidity?.configVersion && `liquidity:${input.liquidity.configVersion}`,
    input.dataConfidence?.configVersion && `data_confidence:${input.dataConfidence.configVersion}:${input.dataConfidence.score}`,
    input.portfolioFit?.configVersion && `portfolio_fit:${input.portfolioFit.configVersion}:${input.portfolioFit.score}`,
    riskResult && `risk:${riskResult.checksVersion}:${riskResult.decision}`,
  ].filter(Boolean);

  const body = {
    decision, score, confidence, scoreMeaning: SCORE_MEANING,
    failed_gates: failed.map((f) => f.gate),
    gate_details: failed,
    dimension_scores: dims,
    strategy_version: input.strategy?.versionId ?? null,
    strategy_definition_hash: input.strategy?.definitionHash ?? null,
    data_timestamp: input.dataTimestamp ?? null,
    expires_at: expiresAt,
    evidence_refs: evidenceRefs,
    config_version: cfg.version,
    decided_at: now.toISOString(),
    subject: { principalId: input.order?.principalId ?? null, instrument: input.order?.instrument ?? null, side: input.order?.side ?? null, opportunityId: input.opportunityId ?? null },
  };
  const inputHash = contentHash(canonicalJson(hashable(input)));
  return Object.freeze({ ...body, input_hash: inputHash, explanation: explain(body) });
}

/** JSON-normalised copy for hashing: drops undefined, bigint → string, keeps the clock out. */
function hashable(input) {
  const { riskContext, ...rest } = input;
  const rc = riskContext ? (({ now: _now, ...r }) => r)(riskContext) : null;
  return JSON.parse(JSON.stringify({ ...rest, riskContext: rc }, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)));
}

/** Deterministic plain-language explanation (stored with the decision; referenced by id). */
export function explain(d) {
  const lines = [`Decision ${d.decision} (score ${d.score}/100 for decision quality — not a probability of profit; confidence ${d.confidence}/100).`];
  if (d.failed_gates.length) lines.push(`Rejected by hard gate(s): ${d.gate_details.map((g) => `${g.gate} (${g.detail})`).join('; ')}. A high score never overrides a failed gate.`);
  else if (d.decision === 'WAIT') lines.push('No gate failed, but the score or confidence is below the GO threshold.');
  const weak = Object.entries(d.dimension_scores).filter(([, v]) => v == null || v < 40).map(([k, v]) => `${k}=${v ?? 'missing'}`);
  if (weak.length) lines.push(`Weak or missing dimensions: ${weak.join(', ')}.`);
  lines.push(`Valid until ${d.expires_at}. Config ${d.config_version}.`);
  return lines.join(' ');
}

export class DecisionService {
  #store; #ids; #clock;
  constructor({ store, idFactory, clock = () => new Date() }) {
    if (!store || typeof idFactory !== 'function') throw new Error('DecisionService needs a store and idFactory');
    this.#store = store; this.#ids = idFactory; this.#clock = clock;
  }

  /** Decide AND persist. Returns the stored decision (with id + explanation_ref). */
  async evaluate(input) {
    const d = decide(input, { now: this.#clock() });
    const id = this.#ids('dec');
    const record = Object.freeze({ id, ...d, explanation_ref: `decision:${id}:explanation` });
    try {
      await this.#store.insert(record);
      return record;
    } catch (e) {
      // an unrecorded decision is never a GO
      return Object.freeze({ ...record, decision: DecisionOutcome.REJECT, failed_gates: [...record.failed_gates, 'record_failed'], recorded: false, record_error: String(e?.message ?? e).slice(0, 200) });
    }
  }
}
