// Applying state changes to an order (Stage 17). Shared by dispatcher and reconciler.
// Every change is a compare-and-set on the current status plus an order_events row,
// in one transaction. Re-applying the same broker snapshot is a no-op (duplicate
// events are idempotent); a stale snapshot can never move an order backwards.
import { OmsError } from './errors.mjs';
import { OmsState as S, DB_STATUS, stateOf, canTransition, isForward, FROM_BROKER, TERMINAL } from './states.mjs';

/**
 * Move `order` from its current state to `to` (CAS). Returns the new order or null if
 * another worker changed it first (caller re-reads; nothing is guessed).
 */
export async function transition(store, order, to, { actor, at, eventType, payload = {}, patch = {}, pinDispatch = false }) {
  const from = stateOf(order.status);
  if (!canTransition(from, to)) throw new OmsError('ILLEGAL_TRANSITION', `${order.id}: ${from} → ${to}`);
  return store.transaction(async (tx) => {
    const full = { ...patch, status: DB_STATUS[to], updatedAt: at };
    const expect = pinDispatch ? { status: order.status, dispatchCount: order.dispatchCount } : order.status;
    if (!(await tx.updateOrder(order.id, expect, full))) return null;
    await tx.appendOrderEvent({ orderId: order.id, eventType, fromStatus: order.status, toStatus: DB_STATUS[to], actor, payload, at });
    return { ...order, ...full };
  });
}

/**
 * Apply what the broker says (submit result or getOrder snapshot).
 * @returns { order, changed: boolean, ignored?: string }
 */
export async function applyBrokerSnapshot(store, order, snap, { actor, at, source }) {
  const from = stateOf(order.status);
  const to = FROM_BROKER[snap.status];
  if (!to) throw new OmsError('CONFIG', `unmapped broker status ${snap.status}`);
  const filled = snap.filledQuantity ?? order.filledQuantity ?? '0';
  const patch = {
    brokerOrderId: snap.brokerOrderId ?? order.brokerOrderId ?? null,
    filledQuantity: filled,
    avgFillPrice: snap.averagePrice ?? order.avgFillPrice ?? null,
    lastReconciledAt: at,
    ...(to !== S.UNKNOWN ? { unknownSince: null } : {}),
    ...((to === S.ACK || to === S.PARTIAL || to === S.FILLED) && !order.acknowledgedAt ? { acknowledgedAt: at } : {}),
  };
  if (to === from) {
    if (filled === order.filledQuantity && patch.brokerOrderId === order.brokerOrderId) return { order, changed: false }; // duplicate: no-op
    if (TERMINAL.has(from)) return { order, changed: false, ignored: 'terminal' };
    const same = await store.transaction(async (tx) => {
      if (!(await tx.updateOrder(order.id, order.status, { ...patch, updatedAt: at }))) return null;
      await tx.appendOrderEvent({ orderId: order.id, eventType: 'broker_update', fromStatus: order.status, toStatus: order.status, actor, payload: { source, filledQuantity: filled }, at });
      return { ...order, ...patch, updatedAt: at };
    });
    return same ? { order: same, changed: true } : { order, changed: false, ignored: 'concurrent' };
  }
  if (TERMINAL.has(from) || !isForward(from, to) || !canTransition(from, to)) return { order, changed: false, ignored: `stale ${from} ← ${to}` };
  const next = await transition(store, order, to, { actor, at, eventType: 'broker_status', payload: { source, brokerStatus: snap.status, filledQuantity: filled }, patch });
  return next ? { order: next, changed: true } : { order, changed: false, ignored: 'concurrent' };
}
