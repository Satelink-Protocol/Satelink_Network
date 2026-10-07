// RiskEngine (Stage 15): the fail-closed wrapper around the 20 ordered checks.
//
// decide(order) never throws and only APPROVEs when ALL of these hold:
//   the context loaded in time · all 20 checks passed · the decision record was persisted.
// Everything else is a REJECT: loader error or timeout (CONTEXT_UNAVAILABLE), a throwing or
// malformed check (CHECK_ERROR / INVALID_CHECK_RESULT), or a failed write (RECORD_FAILED:
// an approval nobody can audit is not an approval). A tripped circuit breaker engages a
// mandate kill switch, so the following orders stop at check 1.
// Deterministic code decides; there is no LLM anywhere in this path.
import { evaluateChecks, Decision } from './evaluate.mjs';
import { CHECKS, CHECKS_VERSION } from './checks.mjs';
import { canonicalJson, contentHash } from '../strategies/canonical.mjs';

export const RISK_ENGINE_VERSION = 'risk-1.0';
const MAX_SNAPSHOT_BYTES = 65_536;

export class RiskEngine {
  #load; #store; #clock; #ids; #timeoutMs;

  /**
   * @param {{loadContext: (order) => Promise<ctx>, store: {recordDecision, appendKillSwitchEvent}, clock?, idFactory, timeoutMs?}} deps
   */
  constructor({ loadContext, store, clock = () => new Date(), idFactory, timeoutMs = 2000 }) {
    if (typeof loadContext !== 'function' || !store || typeof idFactory !== 'function') throw new Error('RiskEngine needs loadContext, store and idFactory');
    this.#load = loadContext; this.#store = store; this.#clock = clock; this.#ids = idFactory; this.#timeoutMs = timeoutMs;
  }

  async decide(order) {
    let decisionId = 'rdc_unassigned';
    try { decisionId = this.#ids('rdc'); } catch { /* fall through: still decided and recorded */ }
    const at = safeNow(this.#clock);
    let ctx = null;
    let result;
    try {
      ctx = await withTimeout(Promise.resolve().then(() => this.#load(order)), this.#timeoutMs);
    } catch (e) {
      result = contextFailure(e);
    }
    if (!result) result = evaluateChecks(order, ctx);

    let trip = null;
    if (result.failed?.trip) {
      const t = result.failed.trip;
      try {
        await this.#store.appendKillSwitchEvent({ scopeType: t.scopeType, scopeId: t.scopeId, principalId: t.principalId, action: 'engage', source: 'circuit_breaker', actorId: 'risk-engine', reason: `${result.failed.code}: ${t.reason}`.slice(0, 500), at });
        trip = { ...t, engaged: true };
      } catch (e) {
        trip = { ...t, engaged: false, error: String(e?.message ?? e).slice(0, 200) };
      }
    }

    const record = {
      decisionId,
      decision: result.decision,
      failedCheck: result.failed ? { n: result.failed.n, id: result.failed.id, code: result.failed.code, detail: result.failed.detail } : null,
      checksVersion: CHECKS_VERSION,
      engineVersion: RISK_ENGINE_VERSION,
      policy: ctx?.policy ? { id: ctx.policy.id ?? null, version: ctx.policy.version ?? null, hash: ctx.policy.hash ?? null } : null,
      orderHash: hashOrNull(order),
      context: snapshot(ctx),
      trace: result.trace,
      trip,
      decidedAt: at,
      principalId: typeof order?.principalId === 'string' ? order.principalId : null,
      idempotencyKey: typeof order?.idempotencyKey === 'string' ? order.idempotencyKey.slice(0, 128) : null,
    };
    try {
      await this.#store.recordDecision(record);
    } catch (e) {
      return Object.freeze({
        ...record, decision: Decision.REJECT,
        failedCheck: { n: 0, id: 'decision_record', code: 'RECORD_FAILED', detail: String(e?.message ?? e).slice(0, 200) },
        recorded: false,
      });
    }
    return Object.freeze({ ...record, recorded: true });
  }
}

function contextFailure(e) {
  const detail = String(e?.message ?? e).slice(0, 300);
  return Object.freeze({
    decision: Decision.REJECT, checksVersion: CHECKS_VERSION,
    failed: { n: 0, id: 'context', code: 'CONTEXT_UNAVAILABLE', detail },
    trace: CHECKS.map((c) => ({ n: c.n, id: c.id, outcome: 'not_evaluated' })),
  });
}

function withTimeout(promise, ms) {
  let t;
  const timeout = new Promise((_, reject) => { t = setTimeout(() => reject(new Error(`context load timed out after ${ms} ms`)), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
}

function safeNow(clock) {
  try { const d = clock(); return d instanceof Date && !Number.isNaN(d.getTime()) ? d.toISOString() : null; } catch { return null; }
}
function hashOrNull(v) {
  try { return contentHash(canonicalJson(v)); } catch { return null; }
}
/** The context the decision saw (bounded); its hash always, the body when small and canonical. */
function snapshot(ctx) {
  if (!ctx) return null;
  try {
    const body = canonicalJson(ctx);
    const hash = contentHash(body);
    return body.length <= MAX_SNAPSHOT_BYTES ? { hash, body: JSON.parse(body) } : { hash, body: null };
  } catch {
    return { hash: null, body: null };
  }
}
