// Reconciliation worker (Stage 17). Resolves every order that is, or may be, at a
// broker by asking the venue's order HISTORY by client order id (never open-orders
// only: a filled or cancelled order is not "open" but very much exists).
//
//   SENT (older than sentGraceMs) / UNKNOWN : found → apply; not found → keep waiting
//        until notFoundGraceMs has passed (venues are eventually consistent), then the
//        order is proven absent → NEW + a new outbox event (same client order id).
//        An order the venue ever ACKNOWLEDGED is never re-queued (manual review instead).
//   ACK / PARTIAL / CANCEL_REQUESTED        : refresh status and fills; a CANCEL_REQUESTED
//        order still working at the venue gets ONE cancel request per cycle
//   any lookup failure                      : record, retry next cycle (never guess)
import { OmsError } from './errors.mjs';
import { OmsState as S, DB_STATUS, stateOf } from './states.mjs';
import { transition, applyBrokerSnapshot } from './transitions.mjs';

const WATCH = [S.SENT, S.UNKNOWN, S.ACK, S.PARTIAL, S.CANCEL_REQUESTED].map((s) => DB_STATUS[s]);
const WORKING = new Set(['pending_new', 'acknowledged', 'partially_filled']);

export class OrderReconciler {
  #store; #adapters; #clock; #o;
  constructor({ store, adapters, clock = () => new Date(), sentGraceMs = 30_000, notFoundGraceMs = 120_000, timeoutMs = 10_000 }) {
    if (!store || !adapters) throw new OmsError('CONFIG', 'OrderReconciler needs store and adapters');
    this.#store = store; this.#adapters = adapters; this.#clock = clock;
    this.#o = { sentGraceMs, notFoundGraceMs, timeoutMs };
  }

  async runOnce({ limit = 100 } = {}) {
    const out = { checked: 0, updated: 0, requeued: 0, cancelsRequested: 0, errors: 0 };
    for (const order of await this.#store.listForReconcile({ statuses: WATCH, limit })) {
      const now = this.#clock().getTime();
      const state = stateOf(order.status);
      if (state === S.SENT && now - (order.sentAt ?? 0) < this.#o.sentGraceMs) continue; // the dispatcher may still be mid-call
      out.checked += 1;
      const adapter = this.#adapters.forVenue(order.venue);
      let snap;
      try {
        snap = await withTimeout(adapter.getOrder(order.brokerAccountId, { clientOrderId: order.clientOrderId }), this.#o.timeoutMs);
      } catch (e) {
        if (e?.code === 'ORDER_NOT_FOUND') { if (await this.#notFound(order, state, now)) out.requeued += 1; continue; }
        out.errors += 1;
        await this.#store.updateOrder(order.id, order.status, { reconcileAttempts: (order.reconcileAttempts ?? 0) + 1, lastError: String(e?.code ?? e?.message).slice(0, 200), lastReconciledAt: now, updatedAt: now });
        continue;
      }
      const r = await applyBrokerSnapshot(this.#store, order, snap, { actor: 'system:reconciler', at: now, source: 'reconcile' });
      if (r.changed) out.updated += 1;
      const cur = r.order;
      if (stateOf(cur.status) === S.CANCEL_REQUESTED && WORKING.has(snap.status)) {
        try {
          const c = await withTimeout(adapter.cancelOrder(order.brokerAccountId, { clientOrderId: order.clientOrderId }), this.#o.timeoutMs);
          out.cancelsRequested += 1;
          await applyBrokerSnapshot(this.#store, cur, c, { actor: 'system:reconciler', at: this.#clock().getTime(), source: 'cancel' });
        } catch { out.errors += 1; }
      }
    }
    return out;
  }

  /** Proven absent only after the grace window; then re-queue with the SAME client order id. */
  async #notFound(order, state, now) {
    if (state === S.ACK || state === S.PARTIAL || state === S.CANCEL_REQUESTED) {
      // The venue acknowledged it before; "not found" now is an anomaly, not proof of absence.
      // Within the grace window it is just eventual consistency: wait.
      if (now - (order.acknowledgedAt ?? order.sentAt ?? now) < this.#o.notFoundGraceMs) return false;
      if (state !== S.CANCEL_REQUESTED) await transition(this.#store, order, S.UNKNOWN, { actor: 'system:reconciler', at: now, eventType: 'vanished', payload: {}, patch: { unknownSince: now, lastError: 'acknowledged order not found at venue' } });
      return false;
    }
    if (order.acknowledgedAt) {
      // The venue confirmed this order once. If it now "does not exist", resending could create a
      // real duplicate: never automatic — leave it UNKNOWN for a human.
      await this.#store.updateOrder(order.id, order.status, { lastError: 'acknowledged order missing at venue: manual review required', lastReconciledAt: now, updatedAt: now });
      return false;
    }
    const since = state === S.UNKNOWN ? (order.unknownSince ?? order.sentAt ?? now) : (order.sentAt ?? now);
    if (now - since < this.#o.notFoundGraceMs) return false;
    return this.#store.transaction(async (tx) => {
      // Pin the send generation: if a dispatcher re-sent meanwhile, this proof is stale.
      if (!(await tx.updateOrder(order.id, { status: order.status, dispatchCount: order.dispatchCount }, { status: DB_STATUS[S.NEW], unknownSince: null, lastError: 'proven absent at venue; re-queued', updatedAt: now }))) return false;
      await tx.appendOrderEvent({ orderId: order.id, eventType: 'proven_absent_requeue', fromStatus: order.status, toStatus: DB_STATUS[S.NEW], actor: 'system:reconciler', payload: { since, graceMs: this.#o.notFoundGraceMs }, at: now });
      await tx.insertOutbox({ aggregateId: order.id, eventType: 'order.place', payload: { orderId: order.id }, idempotencyKey: `place:${order.id}:requeue:${now}`, nextAttemptAt: now });
      return true;
    });
  }
}

function withTimeout(promise, ms) {
  let t;
  const timeout = new Promise((_, reject) => { t = setTimeout(() => reject(Object.assign(new Error(`timed out after ${ms} ms`), { code: 'RECONCILE_TIMEOUT' })), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
}
