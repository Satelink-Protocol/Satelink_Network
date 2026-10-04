// OMS order state machine (Stage 17).
//
//   NEW → SENT → ACK → PARTIAL → FILLED | CANCELLED | REJECTED | UNKNOWN
//
// Stored in orders.status (021 values; 'unknown' added by 027). CANCEL_REQUESTED is
// the extra state Stage 16 writes when a mandate is revoked while an order is at a broker.
// UNKNOWN is first-class: the dispatcher never resends it; only reconciliation by
// client order id (venue HISTORY, not open orders) may resolve it.
import { OmsError } from './errors.mjs';
import { BrokerOrderStatus as B } from '../brokers/types.mjs';

export const OmsState = Object.freeze({
  NEW: 'NEW', SENT: 'SENT', ACK: 'ACK', PARTIAL: 'PARTIAL', FILLED: 'FILLED',
  CANCELLED: 'CANCELLED', REJECTED: 'REJECTED', UNKNOWN: 'UNKNOWN', CANCEL_REQUESTED: 'CANCEL_REQUESTED',
});
const S = OmsState;

/** OMS state ↔ orders.status (021 + 027). */
export const DB_STATUS = Object.freeze({
  NEW: 'approved', SENT: 'submitted', ACK: 'acknowledged', PARTIAL: 'partially_filled', FILLED: 'filled',
  CANCELLED: 'cancelled', REJECTED: 'rejected', UNKNOWN: 'unknown', CANCEL_REQUESTED: 'cancel_requested',
});
const FROM_DB = Object.freeze({ ...Object.fromEntries(Object.entries(DB_STATUS).map(([k, v]) => [v, k])), expired: S.CANCELLED });
export const stateOf = (dbStatus) => {
  const s = FROM_DB[dbStatus];
  if (!s) throw new OmsError('CONFIG', `orders.status ${dbStatus} is not an OMS state`);
  return s;
};

export const TERMINAL = Object.freeze(new Set([S.FILLED, S.CANCELLED, S.REJECTED]));

/** Every legal edge, with why it exists. Anything else is ILLEGAL_TRANSITION. */
export const TRANSITIONS = Object.freeze({
  [S.NEW]: Object.freeze([S.SENT, S.CANCELLED, S.REJECTED]),
  [S.SENT]: Object.freeze([S.ACK, S.PARTIAL, S.FILLED, S.CANCELLED, S.REJECTED, S.UNKNOWN, S.NEW, S.CANCEL_REQUESTED]),
  [S.UNKNOWN]: Object.freeze([S.ACK, S.PARTIAL, S.FILLED, S.CANCELLED, S.REJECTED, S.NEW, S.CANCEL_REQUESTED]),
  [S.ACK]: Object.freeze([S.PARTIAL, S.FILLED, S.CANCELLED, S.REJECTED, S.CANCEL_REQUESTED, S.UNKNOWN]), // UNKNOWN: vanished at venue (manual review)
  [S.PARTIAL]: Object.freeze([S.PARTIAL, S.FILLED, S.CANCELLED, S.CANCEL_REQUESTED, S.UNKNOWN]),
  [S.CANCEL_REQUESTED]: Object.freeze([S.CANCEL_REQUESTED, S.CANCELLED, S.FILLED]),
  [S.FILLED]: Object.freeze([]),
  [S.CANCELLED]: Object.freeze([]),
  [S.REJECTED]: Object.freeze([]),
});

export function canTransition(from, to) {
  return Boolean(TRANSITIONS[from]?.includes(to));
}
export function assertTransition(from, to) {
  if (!canTransition(from, to)) throw new OmsError('ILLEGAL_TRANSITION', `${from} → ${to} is not an OMS transition`);
}

/** Broker (Stage 10 normalised) status → OMS state. */
export const FROM_BROKER = Object.freeze({
  [B.PENDING_NEW]: S.ACK,           // accepted by the gateway: the venue has it
  [B.ACKNOWLEDGED]: S.ACK,
  [B.PARTIALLY_FILLED]: S.PARTIAL,
  [B.FILLED]: S.FILLED,
  [B.PENDING_CANCEL]: S.CANCEL_REQUESTED,
  [B.CANCELLED]: S.CANCELLED,
  [B.EXPIRED]: S.CANCELLED,
  [B.REJECTED]: S.REJECTED,
  [B.UNKNOWN]: S.UNKNOWN,
});

/** Progress rank: a broker snapshot may never move an order backwards (stale or reordered reads). */
const RANK = Object.freeze({ NEW: 0, SENT: 1, UNKNOWN: 1, ACK: 2, PARTIAL: 3, CANCEL_REQUESTED: 4, FILLED: 5, CANCELLED: 5, REJECTED: 5 });
export const isForward = (from, to) => RANK[to] >= RANK[from];
