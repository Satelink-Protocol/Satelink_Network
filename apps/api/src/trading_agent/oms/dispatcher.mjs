// Dispatcher (Stage 17): THE ONLY caller of adapter.placeOrder in the trading module
// (enforced by a static test). It drains trading_outbox 'order.place' events.
//
// Exactly-once intent, never a blind resend:
//   * one deterministic client order id per order (every send reuses it);
//   * the order is marked SENT *before* the broker call (write-ahead), so a crash after
//     the call is visible as SENT on recovery;
//   * any re-delivered event (lease expiry, crash, duplicate event) or any order already
//     SENT first RECONCILES by client order id against venue history; it sends only if
//     the venue confirms the order does not exist;
//   * exactly ONE placeOrder call per dispatch attempt — no retry inside the call (the
//     adapter's HTTP/SDK client must have automatic retries disabled for order POSTs);
//     all retry decisions are made here, only after NOT_PLACED;
//   * timeouts and AMBIGUOUS → UNKNOWN, owned by the reconciler (never resent from here);
//   * DUPLICATE_CLIENT_ORDER_ID ⇒ the order exists → look it up and record it.
import { OmsError } from './errors.mjs';
import { OmsState as S, stateOf, TERMINAL } from './states.mjs';
import { transition, applyBrokerSnapshot } from './transitions.mjs';
import { assertExactlyOnceCapable } from './acceptance.mjs';

const NOOP_FAULTS = Object.freeze({ crash() {} });

export class OrderDispatcher {
  #store; #adapters; #mandates; #guard; #clock; #o; #faults;

  /**
   * @param deps.adapters  { forVenue(venue) → BrokerAdapter }
   * @param deps.mandates  { verifyForOrder(mandateId) } — re-checked at dispatch time
   * @param deps.guard     optional async (order) → { ok, reason } (e.g. kill switch) — re-checked at dispatch time
   * @param deps.faults    test-only crash injection { crash(point) }
   */
  constructor({ store, adapters, mandates, guard = null, clock = () => new Date(), leaseMs = 30_000, submitTimeoutMs = 10_000, notFoundGraceMs = 120_000, maxAttempts = 8, backoffBaseMs = 1000, backoffMaxMs = 60_000, faults = NOOP_FAULTS }) {
    if (!store || !adapters || typeof adapters.forVenue !== 'function' || !mandates) throw new OmsError('CONFIG', 'OrderDispatcher needs store, adapters and mandates');
    // A claim must outlive the broker call it guards, or two dispatchers could hold one in-flight order.
    if (!(leaseMs > 2 * submitTimeoutMs)) throw new OmsError('CONFIG', 'leaseMs must exceed 2 × submitTimeoutMs');
    if (!(notFoundGraceMs > submitTimeoutMs)) throw new OmsError('CONFIG', 'notFoundGraceMs must exceed submitTimeoutMs');
    this.#store = store; this.#adapters = adapters; this.#mandates = mandates; this.#guard = guard; this.#clock = clock; this.#faults = faults;
    this.#o = { leaseMs, submitTimeoutMs, notFoundGraceMs, maxAttempts, backoffBaseMs, backoffMaxMs };
  }

  #now() { return this.#clock().getTime(); }

  /** Claim and process one outbox event. Returns a short outcome label, or null when idle. */
  async runOnce() {
    const ev = await this.#store.claimOutbox(this.#now(), this.#o.leaseMs);
    if (!ev) return null;
    this.#faults.crash('after_claim');
    if (ev.eventType !== 'order.place') { await this.#store.failOutbox(ev.id, `unknown event ${ev.eventType}`); return 'unknown_event'; }
    let order = await this.#store.getOrder(ev.aggregateId);
    if (!order) { await this.#store.failOutbox(ev.id, 'order not found'); return 'missing_order'; }
    const state = stateOf(order.status);
    if (state !== S.NEW && state !== S.SENT) { await this.#store.completeOutbox(ev.id, this.#now()); return 'noop'; } // duplicate / stale event: idempotent

    const adapter = this.#adapters.forVenue(order.venue);
    try { assertExactlyOnceCapable(order.venue, adapter?.capabilities()); } catch (e) { await this.#store.failOutbox(ev.id, e.message); return 'venue_unsafe'; }
    const ref = { clientOrderId: order.clientOrderId };

    // Re-delivery or already SENT: the venue's history is the truth. Never send blind.
    if (state === S.SENT || ev.attempts > 1 || order.dispatchCount > 0) {
      const found = await this.#lookup(adapter, order, ref);
      if (found.error) return this.#defer(ev, `reconcile before resend failed: ${found.error}`);
      if (found.snapshot) {
        await applyBrokerSnapshot(this.#store, order, found.snapshot, { actor: 'system:dispatcher', at: this.#now(), source: 'pre_resend_lookup' });
        await this.#store.completeOutbox(ev.id, this.#now());
        return 'reconciled';
      }
      // Not found. If it MAY have been sent (SENT), a venue that is eventually consistent might
      // not show it yet: only a grace period since the send turns "not found" into "absent".
      // (NEW with dispatchCount > 0 means the venue said NOT_PLACED: absent, resend now.)
      if (state === S.SENT && this.#now() - (order.sentAt ?? 0) < this.#o.notFoundGraceMs) {
        await this.#store.retryOutbox(ev.id, (order.sentAt ?? this.#now()) + this.#o.notFoundGraceMs, 'awaiting not-found grace before resend');
        return 'awaiting_grace';
      }
    }

    // Authority can change between acceptance and dispatch: re-check, fail closed.
    const refusal = await this.#preDispatchRefusal(order);
    if (refusal) {
      const at = this.#now();
      const cur = state === S.SENT ? await transition(this.#store, order, S.NEW, { actor: 'system:dispatcher', at, eventType: 'confirmed_not_placed', payload: {}, pinDispatch: true }) : order;
      if (cur) await transition(this.#store, cur, S.CANCELLED, { actor: 'system:dispatcher', at, eventType: 'dispatch_refused', payload: { reason: refusal }, patch: { lastError: refusal } });
      await this.#store.completeOutbox(ev.id, at);
      return 'refused';
    }

    // Write-ahead: SENT before the broker call.
    const sentAt = this.#now();
    if (state === S.NEW) {
      order = await transition(this.#store, order, S.SENT, { actor: 'system:dispatcher', at: sentAt, eventType: 'dispatch', payload: { attempt: ev.attempts }, patch: { sentAt, dispatchCount: order.dispatchCount + 1 }, pinDispatch: true });
      if (!order) return this.#lostRace(ev);
    } else {
      // Re-send of a SENT order: pin the send generation, so of two workers holding different
      // events for this order only one can win (the race the randomized test found).
      const ok = await this.#store.updateOrder(order.id, { status: order.status, dispatchCount: order.dispatchCount }, { sentAt, dispatchCount: order.dispatchCount + 1, updatedAt: sentAt });
      if (!ok) return this.#lostRace(ev);
      order = { ...order, sentAt, dispatchCount: order.dispatchCount + 1 };
    }
    this.#faults.crash('after_mark_sent');

    let result;
    try {
      result = await withTimeout(adapter.placeOrder(order.brokerAccountId, requestOf(order)), this.#o.submitTimeoutMs);
    } catch (e) {
      this.#faults.crash('after_broker_call');
      return this.#onSubmitError(ev, order, adapter, ref, e);
    }
    this.#faults.crash('after_broker_call');
    // A submit result may report FILLED / PARTIAL without the filled quantity (Stage 10 SubmitResult has
    // no such field). Recording the status alone would freeze a terminal order at filled_quantity 0
    // (found by the Stage 19 trade receipt), so take the venue snapshot, which carries it.
    let snap = { ...result, filledQuantity: result.filledQuantity ?? null };
    if (snap.filledQuantity === null && (result.status === 'filled' || result.status === 'partially_filled')) {
      const found = await this.#lookup(adapter, order, ref);
      if (found.snapshot) snap = found.snapshot;
    }
    await applyBrokerSnapshot(this.#store, order, snap, { actor: 'system:dispatcher', at: this.#now(), source: 'submit' });
    this.#faults.crash('after_record_result');
    await this.#store.completeOutbox(ev.id, this.#now());
    return 'placed';
  }

  async #onSubmitError(ev, order, adapter, ref, e) {
    const at = this.#now();
    const code = e?.code;
    if (code === 'DUPLICATE_CLIENT_ORDER_ID') { // it exists at the venue
      const found = await this.#lookup(adapter, order, ref);
      if (found.snapshot) {
        await applyBrokerSnapshot(this.#store, order, found.snapshot, { actor: 'system:dispatcher', at, source: 'duplicate_client_id' });
        await this.#store.completeOutbox(ev.id, at);
        return 'exists';
      }
      await transition(this.#store, order, S.UNKNOWN, { actor: 'system:dispatcher', at, eventType: 'submit_unknown', payload: { error: code }, patch: { unknownSince: at, lastError: code } });
      await this.#store.completeOutbox(ev.id, at);
      return 'unknown';
    }
    if (e?.name === 'BrokerError' && e.outcome === 'not_placed') {
      if (e.retryable && ev.attempts < this.#o.maxAttempts) {
        await transition(this.#store, order, S.NEW, { actor: 'system:dispatcher', at, eventType: 'not_placed_retry', payload: { error: code }, patch: { lastError: code }, pinDispatch: true });
        await this.#store.retryOutbox(ev.id, at + Math.min(this.#o.backoffBaseMs * 2 ** (ev.attempts - 1), this.#o.backoffMaxMs), code);
        return 'retry';
      }
      await transition(this.#store, order, S.REJECTED, { actor: 'system:dispatcher', at, eventType: 'not_placed', payload: { error: code, retryable: e.retryable }, patch: { lastError: code } });
      await this.#store.completeOutbox(ev.id, at);
      return 'rejected';
    }
    // AMBIGUOUS, our own timeout, or anything unexpected: we cannot know → UNKNOWN.
    await transition(this.#store, order, S.UNKNOWN, { actor: 'system:dispatcher', at, eventType: 'submit_unknown', payload: { error: code ?? e?.name ?? 'error' }, patch: { unknownSince: at, lastError: String(code ?? e?.message ?? e).slice(0, 200) } });
    await this.#store.completeOutbox(ev.id, at);
    return 'unknown';
  }

  async #lookup(adapter, order, ref) {
    try {
      return { snapshot: await withTimeout(adapter.getOrder(order.brokerAccountId, ref), this.#o.submitTimeoutMs) };
    } catch (e) {
      if (e?.code === 'ORDER_NOT_FOUND') return { snapshot: null };
      return { error: e?.code ?? e?.message ?? 'lookup failed' };
    }
  }

  /** Another worker moved this order first: hand the event back for prompt re-evaluation (it will no-op or reconcile). */
  async #lostRace(ev) {
    await this.#store.retryOutbox(ev.id, this.#now(), 'lost race to another worker; re-evaluate');
    return 'concurrent';
  }

  async #defer(ev, why) {
    await this.#store.retryOutbox(ev.id, this.#now() + this.#o.backoffBaseMs, why);
    return 'deferred';
  }

  async #preDispatchRefusal(order) {
    try {
      const m = await this.#mandates.verifyForOrder(order.mandateId);
      if (m.termsHash !== order.mandateTermsHash) return 'mandate changed since acceptance';
    } catch (e) {
      return `mandate ${e.code ?? 'invalid'}`;
    }
    if (this.#guard) {
      try {
        const g = await this.#guard(order);
        if (!g?.ok) return `guard: ${g?.reason ?? 'refused'}`;
      } catch (e) {
        return `guard error: ${e.message}`;
      }
    }
    return null;
  }
}

function requestOf(o) {
  return { clientOrderId: o.clientOrderId, instrument: o.instrument, side: o.side, type: o.orderType, ...(o.timeInForce ? { timeInForce: o.timeInForce } : {}), quantity: o.quantity, ...(o.limitPrice ? { limitPrice: o.limitPrice } : {}) };
}

function withTimeout(promise, ms) {
  let t;
  const timeout = new Promise((_, reject) => { t = setTimeout(() => reject(Object.assign(new Error(`timed out after ${ms} ms`), { code: 'DISPATCH_TIMEOUT' })), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
}
