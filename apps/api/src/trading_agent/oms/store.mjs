// OMS persistence (Stage 17): orders + order_events (021, + 027 columns) and
// trading_outbox (021) used as a transactional outbox / at-least-once queue —
// the same pattern as the Financial-OS outbox (011 + workers/reconciler publisher),
// on the trading module's own table so existing queue semantics are untouched.
//
// Claim = UPDATE … WHERE id = (SELECT … FOR UPDATE SKIP LOCKED LIMIT 1): the claim
// pushes next_attempt_at forward by a lease, so a crashed worker's row is re-claimed
// after the lease. At-least-once by design; exactly-once ORDER INTENT comes from the
// dispatcher (reconcile before any resend, one client order id per order).
import { OmsError } from './errors.mjs';

export class InMemoryOmsStore {
  constructor() { this.state = { orders: new Map(), events: [], outbox: [], seq: 0 }; }

  /** Atomic: any throw restores the previous state (like ROLLBACK). */
  async transaction(fn) {
    const snapshot = structuredClone(this.state);
    try { return await fn(this); } catch (e) { this.state = snapshot; throw e; }
  }
  async getOrder(id) { const o = this.state.orders.get(id); return o ? structuredClone(o) : null; }
  async getOrderByIdempotencyKey(k) { for (const o of this.state.orders.values()) if (o.idempotencyKey === k) return structuredClone(o); return null; }
  async insertOrder(row) {
    for (const o of this.state.orders.values()) {
      if (o.idempotencyKey === row.idempotencyKey) throw new OmsError('CONFLICT', 'duplicate idempotency key');
      if (o.brokerAccountId === row.brokerAccountId && o.clientOrderId === row.clientOrderId) throw new OmsError('CONFLICT', 'duplicate client order id');
    }
    this.state.orders.set(row.id, structuredClone(row));
  }
  /** CAS: `expect` is a status, or { status, dispatchCount } to also pin the send generation. */
  async updateOrder(id, expect, patch) {
    const { status: expectStatus, dispatchCount } = typeof expect === 'string' ? { status: expect } : expect;
    const o = this.state.orders.get(id);
    if (!o || o.status !== expectStatus) return false;
    if (dispatchCount !== undefined && o.dispatchCount !== dispatchCount) return false;
    Object.assign(o, structuredClone(patch));
    return true;
  }
  async appendOrderEvent(e) { this.state.events.push(structuredClone(e)); }
  async insertOutbox(r) {
    if (this.state.outbox.some((x) => x.idempotencyKey === r.idempotencyKey)) return { inserted: false };
    this.state.outbox.push({ id: ++this.state.seq, status: 'pending', attempts: 0, lastError: null, publishedAt: null, ...structuredClone(r) });
    return { inserted: true };
  }
  async claimOutbox(now, leaseMs) {
    const row = this.state.outbox.filter((x) => x.status === 'pending' && x.nextAttemptAt <= now).sort((a, b) => (a.nextAttemptAt - b.nextAttemptAt) || (a.id - b.id))[0];
    if (!row) return null;
    row.attempts += 1;
    row.nextAttemptAt = now + leaseMs;
    return structuredClone(row);
  }
  async completeOutbox(id, at) { const r = this.state.outbox.find((x) => x.id === id); if (r && r.status === 'pending') Object.assign(r, { status: 'published', publishedAt: at }); }
  async retryOutbox(id, nextAttemptAt, error) { const r = this.state.outbox.find((x) => x.id === id); if (r && r.status === 'pending') Object.assign(r, { nextAttemptAt, lastError: error }); }
  async failOutbox(id, error) { const r = this.state.outbox.find((x) => x.id === id); if (r && r.status === 'pending') Object.assign(r, { status: 'failed', lastError: error }); }
  async listForReconcile({ statuses, limit = 100 }) {
    return structuredClone([...this.state.orders.values()].filter((o) => statuses.includes(o.status)).sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1)).slice(0, limit));
  }
}

const ORDER_COLS = {
  id: 'id', principalId: 'principal_id', mandateId: 'mandate_id', brokerAccountId: 'broker_account_id', signalId: 'signal_id',
  clientOrderId: 'client_order_id', brokerOrderId: 'broker_order_id', instrument: 'instrument', side: 'side', orderType: 'order_type',
  timeInForce: 'time_in_force', quantity: 'quantity', limitPrice: 'limit_price', stopPrice: 'stop_price', notionalMinor: 'notional_minor',
  currency: 'currency', decimals: 'decimals', mode: 'mode', status: 'status', idempotencyKey: 'idempotency_key', createdAt: 'created_at',
  updatedAt: 'updated_at', riskDecisionId: 'risk_decision_id', mandateTermsHash: 'mandate_terms_hash', venue: 'venue',
  filledQuantity: 'filled_quantity', avgFillPrice: 'avg_fill_price', sentAt: 'sent_at', acknowledgedAt: 'acknowledged_at',
  unknownSince: 'unknown_since', lastReconciledAt: 'last_reconciled_at', reconcileAttempts: 'reconcile_attempts',
  dispatchCount: 'dispatch_count', lastError: 'last_error',
};
const TS = new Set(['createdAt', 'updatedAt', 'sentAt', 'acknowledgedAt', 'unknownSince', 'lastReconciledAt']);
const DEC = new Set(['quantity', 'limitPrice', 'stopPrice', 'filledQuantity', 'avgFillPrice']);

export class PgOmsStore {
  #pool; #q;
  constructor(pool, queryable = pool) {
    if (!pool || typeof pool.query !== 'function') throw new OmsError('CONFIG', 'PgOmsStore requires a pg pool');
    this.#pool = pool; this.#q = queryable;
  }
  async transaction(fn) {
    if (this.#q !== this.#pool) return fn(this); // already inside one
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      const out = await fn(new PgOmsStore(this.#pool, client));
      await client.query('COMMIT');
      return out;
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }
  async getOrder(id) { const { rows } = await this.#q.query(`SELECT * FROM orders WHERE id = $1`, [id]); return rows[0] ? fromRow(rows[0]) : null; }
  async getOrderByIdempotencyKey(k) { const { rows } = await this.#q.query(`SELECT * FROM orders WHERE idempotency_key = $1`, [k]); return rows[0] ? fromRow(rows[0]) : null; }
  async insertOrder(row) {
    const keys = Object.keys(row).filter((k) => ORDER_COLS[k] && row[k] !== undefined);
    try {
      await this.#q.query(`INSERT INTO orders (${keys.map((k) => ORDER_COLS[k]).join(', ')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')})`, keys.map((k) => toDb(k, row[k])));
    } catch (e) {
      if (e.code === '23505') throw new OmsError('CONFLICT', 'duplicate order (idempotency key or client order id)');
      throw e;
    }
  }
  /** CAS: `expect` is a status, or { status, dispatchCount } to also pin the send generation. */
  async updateOrder(id, expect, patch) {
    const { status: expectStatus, dispatchCount } = typeof expect === 'string' ? { status: expect } : expect;
    const keys = Object.keys(patch);
    for (const k of keys) if (!ORDER_COLS[k]) throw new OmsError('CONFIG', `unknown order field ${k}`);
    const pin = dispatchCount === undefined ? '' : ` AND dispatch_count = $${keys.length + 3}`;
    const { rowCount } = await this.#q.query(
      `UPDATE orders SET ${keys.map((k, i) => `${ORDER_COLS[k]} = $${i + 3}`).join(', ')} WHERE id = $1 AND status = $2${pin}`,
      [id, expectStatus, ...keys.map((k) => toDb(k, patch[k])), ...(dispatchCount === undefined ? [] : [dispatchCount])],
    );
    return rowCount === 1;
  }
  async appendOrderEvent(e) {
    await this.#q.query(
      `INSERT INTO order_events (order_id, event_type, from_status, to_status, actor, payload, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [e.orderId, e.eventType, e.fromStatus, e.toStatus, e.actor, JSON.stringify(e.payload ?? {}), new Date(e.at).toISOString()],
    );
  }
  async insertOutbox(r) {
    const { rowCount } = await this.#q.query(
      `INSERT INTO trading_outbox (aggregate_type, aggregate_id, event_type, payload, idempotency_key, next_attempt_at, created_at)
       VALUES ('order', $1, $2, $3, $4, $5, $5) ON CONFLICT (idempotency_key) DO NOTHING`,
      [r.aggregateId, r.eventType, JSON.stringify(r.payload), r.idempotencyKey, new Date(r.nextAttemptAt).toISOString()],
    );
    return { inserted: rowCount === 1 };
  }
  async claimOutbox(now, leaseMs) {
    const { rows } = await this.#q.query(
      `UPDATE trading_outbox SET attempts = attempts + 1, next_attempt_at = $2
        WHERE id = (SELECT id FROM trading_outbox WHERE status = 'pending' AND aggregate_type = 'order' AND next_attempt_at <= $1
                     ORDER BY next_attempt_at, id FOR UPDATE SKIP LOCKED LIMIT 1)
        RETURNING id, aggregate_id, event_type, payload, idempotency_key, attempts, next_attempt_at`,
      [new Date(now).toISOString(), new Date(now + leaseMs).toISOString()],
    );
    const r = rows[0];
    return r ? { id: Number(r.id), aggregateId: r.aggregate_id, eventType: r.event_type, payload: r.payload, idempotencyKey: r.idempotency_key, attempts: r.attempts, nextAttemptAt: r.next_attempt_at.getTime() } : null;
  }
  async completeOutbox(id, at) { await this.#q.query(`UPDATE trading_outbox SET status = 'published', published_at = $2 WHERE id = $1 AND status = 'pending'`, [id, new Date(at).toISOString()]); }
  async retryOutbox(id, next, error) { await this.#q.query(`UPDATE trading_outbox SET next_attempt_at = $2, last_error = $3 WHERE id = $1 AND status = 'pending'`, [id, new Date(next).toISOString(), String(error).slice(0, 500)]); }
  async failOutbox(id, error) { await this.#q.query(`UPDATE trading_outbox SET status = 'failed', last_error = $2 WHERE id = $1 AND status = 'pending'`, [id, String(error).slice(0, 500)]); }
  async listForReconcile({ statuses, limit = 100 }) {
    const { rows } = await this.#q.query(`SELECT * FROM orders WHERE status = ANY($1) ORDER BY created_at, id LIMIT $2`, [statuses, limit]);
    return rows.map(fromRow);
  }
}

function toDb(k, v) {
  if (v === null || v === undefined) return null;
  if (TS.has(k)) return new Date(v).toISOString();
  return v;
}
const canonDec = (v) => {
  if (v === null || v === undefined) return null;
  const s = String(v);
  if (!s.includes('.')) return s;
  const t = s.replace(/0+$/, '').replace(/\.$/, '');
  return t === '-0' ? '0' : t;
};
function fromRow(r) {
  const o = {};
  for (const [k, c] of Object.entries(ORDER_COLS)) {
    const v = r[c];
    o[k] = v === null || v === undefined ? null : TS.has(k) ? new Date(v).getTime() : DEC.has(k) ? canonDec(v) : v;
  }
  return o;
}
