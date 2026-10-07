// "Why did Satelink do this?" — trade receipt assembler (Stage 19).
//
// Walks the chain for one order: agent run(s) and signals on the same trace → risk decision
// (by the order's risk_decision_id) → signed mandate (terms hash the order was accepted
// under) → order and its events (dispatch, venue statuses) → fills → ledger (fills.ledger_txn_id;
// trading P&L is not posted yet, so this hop is reported as not posted, never invented).
// Returns a WHO / WHAT / WHEN / WHY receipt with a completeness verdict, redacted (Stage 12
// redaction) and content-hashed. Tenant-scoped: another principal's order is NOT_FOUND.
import { AuditError } from './errors.mjs';
import { redact } from '../agent/redaction.mjs';
import { canonicalJson, contentHash } from '../strategies/canonical.mjs';
import { formatTraceparent } from './trace_context.mjs';
import { fx, toDecimal } from '../strategies/fixed.mjs';

export const RECEIPT_VERSION = 'satelink.trade-receipt/1.0';
const iso = (v) => (v === null || v === undefined ? null : new Date(v).toISOString());

/**
 * @param source { order(id), orderEvents(orderId), fills(orderId), riskDecision(decisionId), mandate(id),
 *                 agentRuns(traceId), toolCalls(runIds), signals(traceId), auditByTrace(traceId) }
 */
export class TradeReceiptAssembler {
  #src; #clock;
  constructor({ source, clock = () => new Date() }) {
    for (const m of ['order', 'orderEvents', 'fills', 'riskDecision', 'mandate', 'agentRuns', 'toolCalls', 'signals', 'auditByTrace']) {
      if (typeof source?.[m] !== 'function') throw new AuditError('CONFIG', `receipt source needs ${m}()`);
    }
    this.#src = source; this.#clock = clock;
  }

  async explainOrder({ principalId, orderId }) {
    const order = await this.#src.order(orderId);
    if (!order || order.principalId !== principalId) throw new AuditError('NOT_FOUND', 'order not found');
    const traceId = order.traceId ?? null;
    const [events, fills, decision, mandate] = await Promise.all([
      this.#src.orderEvents(orderId), this.#src.fills(orderId),
      order.riskDecisionId ? this.#src.riskDecision(order.riskDecisionId) : null,
      order.mandateId ? this.#src.mandate(order.mandateId) : null,
    ]);
    const runs = traceId ? (await this.#src.agentRuns(traceId)).filter((r) => r.principalId === principalId) : [];
    const toolCalls = runs.length ? await this.#src.toolCalls(runs.map((r) => r.id)) : [];
    const signals = traceId ? (await this.#src.signals(traceId)).filter((s) => s.principalId === principalId) : [];
    const audits = traceId ? (await this.#src.auditByTrace(traceId)).filter((a) => a.principalId === null || a.principalId === principalId) : [];

    const timeline = [
      ...runs.map((r) => ({ at: iso(r.startedAt), kind: 'agent_run', detail: `${r.id} ${r.status}`, spanId: r.spanId })),
      ...signals.map((s) => ({ at: iso(s.createdAt), kind: 'signal', detail: `${s.source} ${s.side} ${s.instrument}`, spanId: s.spanId })),
      ...audits.map((a) => ({ at: iso(a.occurredAt), kind: a.action, detail: `${a.actorType}:${a.actorId}`, spanId: a.spanId })),
      ...events.map((e) => ({ at: iso(e.createdAt), kind: `order.${e.eventType}`, detail: `${e.fromStatus ?? '∅'} → ${e.toStatus} (${e.actor})`, spanId: e.spanId })),
      ...fills.map((f) => ({ at: iso(f.executedAt), kind: 'fill', detail: `${f.quantity} @ ${f.price}`, spanId: f.spanId })),
    ].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));

    const filled = fills.reduce((s, f) => s + fx(f.quantity), 0n);
    const origin = runs.length ? 'agent' : signals.length ? 'strategy' : 'manual';
    const hops = {
      origin: { ok: true, kind: origin },
      risk: { ok: Boolean(decision && decision.decision === 'APPROVE' && decision.decisionId === order.riskDecisionId) },
      mandate: { ok: Boolean(mandate && mandate.termsHash && mandate.termsHash === order.mandateTermsHash) },
      order: { ok: true },
      dispatch: { ok: order.status === 'approved' || events.some((e) => e.eventType === 'dispatch') },
      fills: { ok: filled === fx(order.filledQuantity ?? '0'), filledQuantity: order.filledQuantity ?? '0', fillsTotal: toDecimal(filled) },
      trace: { ok: Boolean(traceId) && events.every((e) => e.traceId === traceId) && fills.every((f) => f.traceId === traceId) },
      ledger: { ok: true, posted: fills.some((f) => f.ledgerTxnId), note: fills.some((f) => f.ledgerTxnId) ? 'posted' : 'not posted: trading P&L is not posted to the ledger (Stage 18)' },
    };
    const missing = Object.entries(hops).filter(([, h]) => !h.ok).map(([k]) => k);

    const body = redact({
      receipt: RECEIPT_VERSION,
      question: 'Why did Satelink do this?',
      orderId,
      traceId,
      traceparent: traceId && order.spanId ? formatTraceparent({ traceId, spanId: order.spanId, sampled: true }) : null,
      who: {
        principalId,
        agentRuns: runs.map((r) => r.id),
        actors: [...new Set([...events.map((e) => e.actor), ...audits.map((a) => `${a.actorType}:${a.actorId}`)])].sort(),
        mandateSignedBy: mandate?.approvedBy ?? null,
      },
      what: {
        instrument: order.instrument, side: order.side, type: order.orderType, quantity: order.quantity, limitPrice: order.limitPrice ?? null,
        venue: order.venue, mode: order.mode, clientOrderId: order.clientOrderId, brokerOrderId: order.brokerOrderId ?? null,
        status: order.status, filledQuantity: order.filledQuantity ?? '0', avgFillPrice: order.avgFillPrice ?? null,
      },
      when: {
        accepted: iso(order.createdAt), sent: iso(order.sentAt), acknowledged: iso(order.acknowledgedAt),
        firstFill: fills.length ? iso(fills[0].executedAt) : null, lastFill: fills.length ? iso(fills.at(-1).executedAt) : null, timeline,
      },
      why: {
        origin,
        agentRuns: runs.map((r) => ({
          runId: r.id, status: r.status, goal: r.goalRedacted, finalOutput: r.finalOutputRedacted ?? null,
          toolCalls: toolCalls.filter((t) => t.runId === r.id).map((t) => ({ seq: t.seq, tool: t.toolName, tier: t.tier, status: t.status, rejection: t.rejectionCode ?? null })),
        })),
        signals: signals.map((s) => ({ id: s.id, source: s.source, side: s.side, instrument: s.instrument, confidence: s.confidence ?? null })),
        mandate: mandate ? {
          id: mandate.id, mode: mandate.modeCode ?? mandate.mode, status: mandate.status, termsHash: mandate.termsHash,
          matchesOrder: mandate.termsHash === order.mandateTermsHash, signedAt: iso(mandate.signedAt), stepUpMethod: mandate.stepUpMethod ?? null,
        } : null,
        risk: decision ? {
          decisionId: decision.decisionId, decision: decision.decision, checksVersion: decision.checksVersion, engineVersion: decision.engineVersion,
          policy: decision.policy ?? null, checksPassed: (decision.trace ?? []).filter((c) => c.outcome === 'pass').length, checksTotal: (decision.trace ?? []).length,
          failedCheck: decision.failedCheck ?? null,
        } : null,
      },
      fills: fills.map((f) => ({ brokerFillId: f.brokerFillId, quantity: f.quantity, price: f.price, feeMinor: String(f.feeMinor), feeCurrency: f.feeCurrency, executedAt: iso(f.executedAt) })),
      ledger: { posted: hops.ledger.posted, ledgerTxnIds: fills.map((f) => f.ledgerTxnId).filter(Boolean), note: hops.ledger.note },
      completeness: { complete: missing.length === 0, missing, hops },
    });
    // Partial chains are exactly when a receipt matters: drop undefined fields (undefined array
    // slots become null) so missing data is reported in `completeness`, never a crash.
    const clean = JSON.parse(JSON.stringify(body));
    return Object.freeze({ ...clean, generatedAt: this.#clock().toISOString(), receiptHash: contentHash(canonicalJson(clean)) });
  }
}
