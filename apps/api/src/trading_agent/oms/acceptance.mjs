// Order acceptance (Stage 17): the only way an order enters the OMS.
//
//   idempotency key seen? → return the existing order (never a second order)
//   mandate verifies (Stage 16 verifyForOrder)      — else refused
//   risk APPROVEs and the decision was recorded (Stage 15) — else refused
//   venue can guarantee exactly-once intent (client-id dedupe + history lookup) — else refused
//   ONE transaction: order (NEW) + order_events 'accepted' + trading_outbox 'order.place'
// Nothing here talks to a broker.
import { OmsError } from './errors.mjs';
import { OmsState as S, DB_STATUS } from './states.mjs';
import { clientOrderIdFor } from './client_order_id.mjs';

export function assertExactlyOnceCapable(venue, caps) {
  if (!caps) throw new OmsError('CONFIG', `no adapter capabilities for venue ${venue}`);
  if (caps.executionSafety !== 'IDEMPOTENT' || !caps.supportsClientOrderId || !caps.supportsQueryByClientOrderId) {
    throw new OmsError('CONFIG', `venue ${venue} cannot guarantee exactly-once intent (needs IDEMPOTENT + client order id + query by client order id)`);
  }
}

export class OrderAcceptanceService {
  #store; #mandates; #risk; #venues; #ids; #clock;

  /**
   * @param deps.mandates  { verifyForOrder(mandateId) } — Stage 16 MandateService
   * @param deps.risk      { decide(order) }             — Stage 15 RiskEngine
   * @param deps.venues    { capabilities(venue) }        — adapter capability lookup
   */
  constructor({ store, mandates, risk, venues, idFactory, clock = () => new Date() }) {
    if (!store || !mandates || !risk || !venues || typeof idFactory !== 'function') throw new OmsError('CONFIG', 'OrderAcceptanceService needs store, mandates, risk, venues and idFactory');
    this.#store = store; this.#mandates = mandates; this.#risk = risk; this.#venues = venues; this.#ids = idFactory; this.#clock = clock;
  }

  async accept(intent) {
    const key = intent?.idempotencyKey;
    if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(key)) return refused('INVALID_ORDER', 'idempotencyKey required');
    const existing = await this.#store.getOrderByIdempotencyKey(key);
    if (existing) return Object.freeze({ accepted: true, duplicate: true, orderId: existing.id, clientOrderId: existing.clientOrderId, status: existing.status });

    let mandate;
    try { mandate = await this.#mandates.verifyForOrder(intent.mandateId); } catch (e) { return refused(`MANDATE_${e.code ?? 'ERROR'}`, e.message); }
    if (mandate.principalId !== intent.principalId || mandate.brokerAccountId !== intent.brokerAccountId) return refused('MANDATE_MISMATCH', 'mandate is for a different principal or account');

    const decision = await this.#risk.decide(intent);
    if (decision?.decision !== 'APPROVE' || decision.recorded !== true) {
      return refused(`RISK_${decision?.failedCheck?.code ?? 'REJECT'}`, decision?.failedCheck?.detail ?? 'risk did not approve', { decisionId: decision?.decisionId ?? null });
    }

    let caps;
    try { caps = this.#venues.capabilities(intent.venue); assertExactlyOnceCapable(intent.venue, caps); } catch (e) { return refused('VENUE_NOT_EXACTLY_ONCE', e.message); }

    const at = this.#clock().getTime();
    const id = this.#ids('ord');
    const clientOrderId = clientOrderIdFor(id, intent.venue, caps);
    const row = {
      id, principalId: intent.principalId, mandateId: intent.mandateId, brokerAccountId: intent.brokerAccountId, signalId: null,
      clientOrderId, brokerOrderId: null, instrument: intent.instrument, side: intent.side, orderType: intent.type, timeInForce: intent.timeInForce ?? null,
      quantity: intent.quantity, limitPrice: intent.limitPrice ?? null, stopPrice: null, notionalMinor: null, currency: mandate.currency, decimals: mandate.decimals,
      mode: intent.mode, status: DB_STATUS[S.NEW], idempotencyKey: key, createdAt: at, updatedAt: at,
      riskDecisionId: decision.decisionId, mandateTermsHash: mandate.termsHash, venue: intent.venue,
      filledQuantity: '0', avgFillPrice: null, sentAt: null, acknowledgedAt: null, unknownSince: null, lastReconciledAt: null,
      reconcileAttempts: 0, dispatchCount: 0, lastError: null,
    };
    try {
      await this.#store.transaction(async (tx) => {
        await tx.insertOrder(row);
        await tx.appendOrderEvent({ orderId: id, eventType: 'accepted', fromStatus: null, toStatus: row.status, actor: 'system:oms', payload: { riskDecisionId: decision.decisionId, mandateTermsHash: mandate.termsHash }, at });
        await tx.insertOutbox({ aggregateId: id, eventType: 'order.place', payload: { orderId: id }, idempotencyKey: `place:${id}:0`, nextAttemptAt: at });
      });
    } catch (e) {
      if (e.code === 'CONFLICT') { // lost a race on the same idempotency key: return the winner
        const won = await this.#store.getOrderByIdempotencyKey(key);
        if (won) return Object.freeze({ accepted: true, duplicate: true, orderId: won.id, clientOrderId: won.clientOrderId, status: won.status });
      }
      throw e;
    }
    return Object.freeze({ accepted: true, duplicate: false, orderId: id, clientOrderId, status: row.status, decisionId: decision.decisionId });
  }
}

function refused(reason, detail, extra = {}) {
  return Object.freeze({ accepted: false, reason, detail: String(detail ?? '').slice(0, 300), ...extra });
}
