// Fail-closed ordered evaluation of the 20 pre-trade checks (Stage 15). Pure and synchronous.
//
// Rules: checks run in registry order; the first non-PASS stops evaluation (the rest are
// recorded as 'not_evaluated'). A check that throws, or returns anything other than PASS /
// a well-formed rejection, REJECTs the order (CHECK_ERROR / INVALID_CHECK_RESULT).
// APPROVE requires all 20 to have passed. Nothing here can throw to the caller.
import { CHECKS, CHECKS_VERSION } from './checks.mjs';

export const Decision = Object.freeze({ APPROVE: 'APPROVE', REJECT: 'REJECT' });

export function evaluateChecks(order, ctx, checks = CHECKS) {
  const trace = [];
  let failed = null;
  for (const c of checks) {
    if (failed) { trace.push({ n: c.n, id: c.id, outcome: 'not_evaluated' }); continue; }
    let r;
    try {
      r = c.fn(order, ctx);
    } catch (e) {
      r = { ok: false, code: 'CHECK_ERROR', detail: String(e?.message ?? e).slice(0, 300) };
    }
    if (r === null || typeof r !== 'object' || (r.ok !== true && !(r.ok === false && typeof r.code === 'string'))) {
      r = { ok: false, code: 'INVALID_CHECK_RESULT', detail: 'check returned an unrecognised result' };
    }
    if (r.ok === true) { trace.push({ n: c.n, id: c.id, outcome: 'pass' }); continue; }
    failed = { n: c.n, id: c.id, code: r.code, detail: r.detail ?? '', ...(r.trip ? { trip: r.trip } : {}) };
    trace.push({ n: c.n, id: c.id, outcome: 'reject', code: r.code, detail: r.detail ?? '' });
  }
  // APPROVE only for the complete canonical registry: a partial, reordered or empty list can never approve.
  const complete = checks.length === CHECKS.length && checks.every((c, i) => c.id === CHECKS[i].id && c.n === CHECKS[i].n);
  const approved = complete && failed === null && trace.length === CHECKS.length && trace.every((t) => t.outcome === 'pass');
  return Object.freeze({ decision: approved ? Decision.APPROVE : Decision.REJECT, checksVersion: CHECKS_VERSION, failed, trace });
}
