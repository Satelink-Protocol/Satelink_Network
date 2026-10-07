// Machine + AI-agent interface (Phase 6 item 11) — ONE core: the same orchestrator, scorecard and
// proposal path humans use. Agent / machine principals act for their human owner; every call is
// scope-checked, rate-limited, budgeted and metered (guard.mjs). Nothing here can place an order:
//   evaluate  → orchestrator.run('evaluate_opportunity') → GO / WAIT / REJECT JSON (persisted decision)
//   propose   → a proposal for HUMAN review, bound to the key's mandate when the key has one
//   receipt   → a persisted decision record, only the owner's
import { AccessError } from './guard.mjs';
import { Scope } from './keys.mjs';

const INSTRUMENT = /^([A-Z0-9]{2,15}-[A-Z0-9]{2,15}|[A-Z]{2,10}:[A-Z0-9&._-]{1,30})$/;
const ID = (p) => new RegExp(`^${p}_[A-Za-z0-9_-]{3,64}$`);
const bad = (m) => new AccessError(400, 'INVALID', m);

export function decisionJson(d) {
  return Object.freeze({
    decision: d.decision, score: d.score, confidence: d.confidence, failed_gates: d.failed_gates, dimension_scores: d.dimension_scores,
    strategy_version: d.strategy_version, data_timestamp: d.data_timestamp, expires_at: d.expires_at, evidence_refs: d.evidence_refs,
    explanation_ref: d.explanation_ref, receipt_id: d.id, score_meaning: d.scoreMeaning,
  });
}

export function createMachineInterface({ orchestrator, decisionStore, proposals, guard }) {
  if (!orchestrator?.run || !decisionStore?.get || !proposals?.create || !guard) throw new Error('createMachineInterface needs orchestrator, decisionStore, proposals and guard');
  return Object.freeze({
    async evaluate(principal, body, requestId) {
      await guard.check(principal, 'evaluate_opportunity', Scope.READ);
      if (!INSTRUMENT.test(body?.instrument ?? '')) throw bad('instrument required');
      if (body.mandateId != null && !ID('mdt').test(body.mandateId)) throw bad('mandateId malformed');
      const owner = principal.agentKey.ownerPrincipalId;
      const r = await orchestrator.run({ kind: 'evaluate_opportunity', principalId: owner, actingPrincipalId: principal.principalId, instrument: body.instrument, mandateId: body.mandateId ?? principal.agentKey.mandateId ?? null, opportunityId: body.opportunityId ?? null, machineRequestId: requestId, intent: body.intent ?? {} });
      if (r.status !== 'ok' || !r.decision) throw new AccessError(503, 'EVALUATION_UNAVAILABLE', `evaluation did not complete (${r.status})`);
      await guard.meter(principal, 'evaluate_opportunity', requestId);
      return { ...decisionJson(r.decision), recommendation: r.recommendation, trace_id: r.traceId };
    },

    async propose(principal, body, requestId) {
      await guard.check(principal, 'propose', Scope.PROPOSE);
      const k = principal.agentKey;
      if (!ID('mdt').test(body?.mandateId ?? '')) throw bad('mandateId required: proposals are bound to a mandate');
      if (k.mandateId && body.mandateId !== k.mandateId) throw new AccessError(403, 'MANDATE_MISMATCH', 'this key is bound to a different mandate');
      if (!INSTRUMENT.test(body.instrument ?? '') || !['buy', 'sell'].includes(body.side) || typeof body.quantity !== 'string') throw bad('instrument, side and quantity (decimal string) required');
      if (body.decisionId != null) {
        const d = await decisionStore.get(body.decisionId);
        if (!d || (d.subject?.principalId ?? d.principal_id) !== k.ownerPrincipalId) throw new AccessError(404, 'NOT_FOUND', 'decision not found');
      }
      const created = await proposals.create({
        principalId: k.ownerPrincipalId, proposedBy: principal.principalId, proposedByKind: principal.kind, mandateId: body.mandateId,
        decisionId: body.decisionId ?? null, instrument: body.instrument, side: body.side, quantity: body.quantity,
        limitPrice: body.limitPrice ?? null, rationale: String(body.rationale ?? '').slice(0, 2000),
        executionPath: k.scope === Scope.EXECUTE_UNDER_MANDATE ? 'mode_b_candidate' : 'human_review', requestId,
      });
      await guard.meter(principal, 'propose', requestId);
      return { proposalId: created.proposalId, status: created.status, executionPath: k.scope === Scope.EXECUTE_UNDER_MANDATE ? 'mode_b_candidate' : 'human_review' };
    },

    async receipt(principal, id, requestId) {
      await guard.check(principal, 'get_receipt', Scope.READ);
      const d = await decisionStore.get(id);
      if (!d || (d.subject?.principalId ?? d.principal_id) !== principal.agentKey.ownerPrincipalId) throw new AccessError(404, 'NOT_FOUND', 'receipt not found');
      await guard.meter(principal, 'get_receipt', requestId);
      return d;
    },
  });
}
