// Postgres source for the receipt assembler (Stage 19). Read-only queries over the chain
// tables; every row carries its trace / span ids (migration 029).
import { AuditError } from './errors.mjs';

const canon = (v) => {
  if (v === null || v === undefined) return null;
  const s = String(v);
  if (!s.includes('.')) return s;
  const t = s.replace(/0+$/, '').replace(/\.$/, '');
  return t === '-0' ? '0' : t;
};

export class PgReceiptSource {
  #q;
  constructor(pool) {
    if (!pool || typeof pool.query !== 'function') throw new AuditError('CONFIG', 'PgReceiptSource needs a pg pool');
    this.#q = pool;
  }
  async order(id) {
    const { rows } = await this.#q.query(`SELECT * FROM orders WHERE id = $1`, [id]);
    const r = rows[0];
    return r ? {
      id: r.id, principalId: r.principal_id, mandateId: r.mandate_id, riskDecisionId: r.risk_decision_id, mandateTermsHash: r.mandate_terms_hash,
      instrument: r.instrument, side: r.side, orderType: r.order_type, quantity: canon(r.quantity), limitPrice: canon(r.limit_price), venue: r.venue, mode: r.mode,
      clientOrderId: r.client_order_id, brokerOrderId: r.broker_order_id, status: r.status, filledQuantity: canon(r.filled_quantity), avgFillPrice: canon(r.avg_fill_price),
      createdAt: r.created_at, sentAt: r.sent_at, acknowledgedAt: r.acknowledged_at, traceId: r.trace_id, spanId: r.span_id,
    } : null;
  }
  async orderEvents(orderId) {
    const { rows } = await this.#q.query(`SELECT event_type, from_status, to_status, actor, created_at, trace_id, span_id FROM order_events WHERE order_id = $1 ORDER BY id`, [orderId]);
    return rows.map((r) => ({ eventType: r.event_type, fromStatus: r.from_status, toStatus: r.to_status, actor: r.actor, createdAt: r.created_at, traceId: r.trace_id, spanId: r.span_id }));
  }
  async fills(orderId) {
    const { rows } = await this.#q.query(`SELECT broker_fill_id, quantity, price, fee_minor, fee_currency, executed_at, ledger_txn_id, trace_id, span_id FROM fills WHERE order_id = $1 ORDER BY executed_at, broker_fill_id`, [orderId]);
    return rows.map((r) => ({ brokerFillId: r.broker_fill_id, quantity: canon(r.quantity), price: canon(r.price), feeMinor: String(r.fee_minor), feeCurrency: r.fee_currency, executedAt: r.executed_at, ledgerTxnId: r.ledger_txn_id, traceId: r.trace_id, spanId: r.span_id }));
  }
  async riskDecision(decisionId) {
    const { rows } = await this.#q.query(`SELECT payload FROM audit_events WHERE action = 'risk.decision' AND payload->>'decisionId' = $1 ORDER BY id DESC LIMIT 1`, [decisionId]);
    return rows[0]?.payload ?? null;
  }
  async mandate(id) {
    const { rows } = await this.#q.query(`SELECT * FROM mandates WHERE id = $1`, [id]);
    const r = rows[0];
    return r ? { id: r.id, mode: r.mode, modeCode: r.mode_code, status: r.status, termsHash: r.terms_hash, signedAt: r.signed_at, stepUpMethod: r.step_up_method, approvedBy: r.approved_by } : null;
  }
  async agentRuns(traceId) {
    const { rows } = await this.#q.query(`SELECT id, principal_id, status, goal_redacted, final_output_redacted, started_at, span_id FROM agent_runs WHERE trace_id = $1 ORDER BY started_at`, [traceId]);
    return rows.map((r) => ({ id: r.id, principalId: r.principal_id, status: r.status, goalRedacted: r.goal_redacted, finalOutputRedacted: r.final_output_redacted, startedAt: r.started_at, spanId: r.span_id }));
  }
  async toolCalls(runIds) {
    const { rows } = await this.#q.query(`SELECT run_id, seq, tool_name, tier, status, rejection_code FROM tool_calls WHERE run_id = ANY($1) ORDER BY run_id, seq`, [runIds]);
    return rows.map((r) => ({ runId: r.run_id, seq: r.seq, toolName: r.tool_name, tier: r.tier, status: r.status, rejectionCode: r.rejection_code }));
  }
  async signals(traceId) {
    const { rows } = await this.#q.query(`SELECT id, principal_id, source, instrument, side, confidence, created_at, span_id FROM signals WHERE trace_id = $1 ORDER BY created_at`, [traceId]);
    return rows.map((r) => ({ id: r.id, principalId: r.principal_id, source: r.source, instrument: r.instrument, side: r.side, confidence: canon(r.confidence), createdAt: r.created_at, spanId: r.span_id }));
  }
  async auditByTrace(traceId) {
    const { rows } = await this.#q.query(`SELECT occurred_at, actor_type, actor_id, principal_id, action, span_id FROM audit_events WHERE trace_id = $1 ORDER BY id`, [traceId]);
    return rows.map((r) => ({ occurredAt: r.occurred_at, actorType: r.actor_type, actorId: r.actor_id, principalId: r.principal_id, action: r.action, spanId: r.span_id }));
  }
}
