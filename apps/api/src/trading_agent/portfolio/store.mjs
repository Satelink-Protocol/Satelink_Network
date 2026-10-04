// Portfolio persistence (Stage 18). Reads OMS orders / order_events (021, 027); writes
// fills (021, append-only), positions (021 + 028 columns), portfolio_snapshots,
// reconciliation_events and portfolio_consumer_cursors (028), trading_outbox (aggregate
// 'strategy' — the OMS dispatcher only claims 'order') and audit_events.
// Never touches the ledger (fills.ledger_txn_id stays NULL). Every read that can return
// tenant data takes a principalId and filters on it.
import { PortfolioError } from './errors.mjs';

const FILL_EVENT_TYPES = ['broker_status', 'broker_update'];

/** In-memory store; `oms` (an InMemoryOmsStore) provides orders and order_events. */
export class InMemoryPortfolioStore {
  constructor({ oms }) {
    if (!oms?.state) throw new PortfolioError('CONFIG', 'InMemoryPortfolioStore needs an InMemoryOmsStore');
    this.oms = oms;
    this.state = { fills: [], positions: new Map(), snapshots: [], recon: [], cursors: new Map(), outbox: [], audit: [], seq: 0 };
  }
  async transaction(fn) {
    const snap = structuredClone(this.state);
    try { return await fn(this); } catch (e) { this.state = snap; throw e; }
  }
  async getCursor(name) { return this.state.cursors.get(name) ?? 0; }
  async setCursor(name, id) { this.state.cursors.set(name, id); }
  async readOrderEvents(afterId, limit) {
    return this.oms.state.events.map((e, i) => ({ id: i + 1, orderId: e.orderId, eventType: e.eventType }))
      .filter((e) => e.id > afterId && FILL_EVENT_TYPES.includes(e.eventType)).slice(0, limit);
  }
  async lastOrderEventId() { return this.oms.state.events.length; }
  async getOrder(id) { const o = this.oms.state.orders.get(id); return o ? structuredClone(o) : null; }
  async insertFills(rows) {
    let n = 0;
    for (const r of rows) {
      if (this.state.fills.some((f) => f.orderId === r.orderId && f.brokerFillId === r.brokerFillId)) continue;
      this.state.fills.push(structuredClone(r)); n += 1;
    }
    return n;
  }
  async fillsForKey({ brokerAccountId, instrument, mode }) {
    return this.state.fills.flatMap((f) => {
      const o = this.oms.state.orders.get(f.orderId);
      return o && o.brokerAccountId === brokerAccountId && o.instrument === instrument && o.mode === mode
        ? [{ fillId: f.brokerFillId, side: o.side, quantity: f.quantity, price: f.price, feeMinor: f.feeMinor, feeCurrency: f.feeCurrency, feeDecimals: f.feeDecimals, executedAt: f.executedAt }] : [];
    });
  }
  async filledByOrder(orderId) { return this.state.fills.filter((f) => f.orderId === orderId).map((f) => f.quantity); }
  async upsertPosition(p) { this.state.positions.set(`${p.brokerAccountId}|${p.instrument}|${p.mode}`, structuredClone(p)); }
  async positions(principalId, { brokerAccountId = null, mode = null } = {}) {
    return structuredClone([...this.state.positions.values()].filter((p) => p.principalId === principalId && (!brokerAccountId || p.brokerAccountId === brokerAccountId) && (!mode || p.mode === mode)));
  }
  async insertSnapshot(s) { this.state.snapshots.push(structuredClone(s)); }
  async snapshots(principalId, { brokerAccountId = null, limit = 50 } = {}) {
    return structuredClone(this.state.snapshots.filter((s) => s.principalId === principalId && (!brokerAccountId || s.brokerAccountId === brokerAccountId)).slice(-limit).reverse());
  }
  async insertReconciliationEvent(e) { this.state.recon.push({ ...structuredClone(e), seq: ++this.state.seq }); }
  async reconciliationEvents(principalId, { brokerAccountId = null, mode = null, limit = 50 } = {}) {
    return structuredClone(this.state.recon.filter((e) => e.principalId === principalId && (!brokerAccountId || e.brokerAccountId === brokerAccountId) && (!mode || e.mode === mode)).sort((a, b) => b.seq - a.seq).slice(0, limit));
  }
  async insertOutbox(r) {
    if (this.state.outbox.some((x) => x.idempotencyKey === r.idempotencyKey)) return { inserted: false };
    this.state.outbox.push(structuredClone(r)); return { inserted: true };
  }
  async appendAudit(a) { this.state.audit.push(structuredClone(a)); }
}

export class PgPortfolioStore {
  #pool; #q;
  constructor(pool, queryable = pool) {
    if (!pool || typeof pool.query !== 'function') throw new PortfolioError('CONFIG', 'PgPortfolioStore requires a pg pool');
    this.#pool = pool; this.#q = queryable;
  }
  async transaction(fn) {
    if (this.#q !== this.#pool) return fn(this);
    const c = await this.#pool.connect();
    try { await c.query('BEGIN'); const out = await fn(new PgPortfolioStore(this.#pool, c)); await c.query('COMMIT'); return out; } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  }
  async getCursor(name) { const { rows } = await this.#q.query(`SELECT last_event_id FROM portfolio_consumer_cursors WHERE consumer = $1`, [name]); return rows[0] ? Number(rows[0].last_event_id) : 0; }
  async setCursor(name, id) {
    await this.#q.query(`INSERT INTO portfolio_consumer_cursors (consumer, last_event_id, updated_at) VALUES ($1, $2, now())
                         ON CONFLICT (consumer) DO UPDATE SET last_event_id = GREATEST(portfolio_consumer_cursors.last_event_id, EXCLUDED.last_event_id), updated_at = now()`, [name, id]);
  }
  async readOrderEvents(afterId, limit) {
    const { rows } = await this.#q.query(`SELECT id, order_id, event_type FROM order_events WHERE id > $1 AND event_type = ANY($2) ORDER BY id LIMIT $3`, [afterId, FILL_EVENT_TYPES, limit]);
    return rows.map((r) => ({ id: Number(r.id), orderId: r.order_id, eventType: r.event_type }));
  }
  async getOrder(id) {
    const { rows } = await this.#q.query(`SELECT id, principal_id, broker_account_id, client_order_id, instrument, side, mode, currency, decimals, venue FROM orders WHERE id = $1`, [id]);
    const r = rows[0];
    return r ? { id: r.id, principalId: r.principal_id, brokerAccountId: r.broker_account_id, clientOrderId: r.client_order_id, instrument: r.instrument, side: r.side, mode: r.mode, currency: r.currency, decimals: r.decimals, venue: r.venue } : null;
  }
  async insertFills(rows) {
    let n = 0;
    for (const r of rows) {
      const { rowCount } = await this.#q.query(
        `INSERT INTO fills (id, order_id, broker_fill_id, quantity, price, fee_minor, fee_currency, fee_decimals, executed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (order_id, broker_fill_id) DO NOTHING`,
        [r.id, r.orderId, r.brokerFillId, r.quantity, r.price, r.feeMinor, r.feeCurrency, r.feeDecimals, r.executedAt],
      );
      n += rowCount;
    }
    return n;
  }
  async fillsForKey({ brokerAccountId, instrument, mode }) {
    const { rows } = await this.#q.query(
      `SELECT f.broker_fill_id, o.side, f.quantity::text AS quantity, f.price::text AS price, f.fee_minor::text AS fee_minor, f.fee_currency, f.fee_decimals, f.executed_at
         FROM fills f JOIN orders o ON o.id = f.order_id
        WHERE o.broker_account_id = $1 AND o.instrument = $2 AND o.mode = $3`, [brokerAccountId, instrument, mode],
    );
    return rows.map((r) => ({ fillId: r.broker_fill_id, side: r.side, quantity: canon(r.quantity), price: canon(r.price), feeMinor: r.fee_minor, feeCurrency: r.fee_currency, feeDecimals: r.fee_decimals, executedAt: r.executed_at.toISOString() }));
  }
  async filledByOrder(orderId) { const { rows } = await this.#q.query(`SELECT quantity::text AS q FROM fills WHERE order_id = $1`, [orderId]); return rows.map((r) => canon(r.q)); }
  async upsertPosition(p) {
    await this.#q.query(
      `INSERT INTO positions (id, principal_id, broker_account_id, instrument, mode, quantity, avg_entry_price, realized_pnl_minor, currency, decimals,
                              fees_minor, fill_count, last_fill_at, unconverted_fees, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       ON CONFLICT (broker_account_id, instrument, mode) DO UPDATE SET quantity = EXCLUDED.quantity, avg_entry_price = EXCLUDED.avg_entry_price,
         realized_pnl_minor = EXCLUDED.realized_pnl_minor, fees_minor = EXCLUDED.fees_minor, fill_count = EXCLUDED.fill_count,
         last_fill_at = EXCLUDED.last_fill_at, unconverted_fees = EXCLUDED.unconverted_fees, updated_at = EXCLUDED.updated_at`,
      [p.id, p.principalId, p.brokerAccountId, p.instrument, p.mode, p.quantity, p.avgEntryPrice, p.realizedPnlMinor, p.currency, p.decimals,
        p.feesMinor, p.fillCount, p.lastFillAt, JSON.stringify(p.unconvertedFees), p.updatedAt],
    );
  }
  async positions(principalId, { brokerAccountId = null, mode = null } = {}) {
    const { rows } = await this.#q.query(
      `SELECT * FROM positions WHERE principal_id = $1 AND ($2::text IS NULL OR broker_account_id = $2) AND ($3::text IS NULL OR mode = $3) ORDER BY instrument`,
      [principalId, brokerAccountId, mode],
    );
    return rows.map((r) => ({ id: r.id, principalId: r.principal_id, brokerAccountId: r.broker_account_id, instrument: r.instrument, mode: r.mode, quantity: canon(r.quantity),
      avgEntryPrice: r.avg_entry_price === null ? null : canon(r.avg_entry_price), realizedPnlMinor: String(r.realized_pnl_minor), currency: r.currency, decimals: r.decimals,
      feesMinor: String(r.fees_minor), fillCount: r.fill_count, lastFillAt: r.last_fill_at?.toISOString() ?? null, unconvertedFees: r.unconverted_fees }));
  }
  async insertSnapshot(s) {
    await this.#q.query(
      `INSERT INTO portfolio_snapshots (id, principal_id, broker_account_id, mode, taken_at, currency, decimals, positions, realized_pnl_minor, unrealized_pnl_minor,
                                        gross_exposure_minor, net_exposure_minor, fees_minor, marks_complete, snapshot_hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [s.id, s.principalId, s.brokerAccountId, s.mode, s.takenAt, s.currency, s.decimals, JSON.stringify(s.positions), s.realizedPnlMinor, s.unrealizedPnlMinor,
        s.grossExposureMinor, s.netExposureMinor, s.feesMinor, s.marksComplete, s.snapshotHash],
    );
  }
  async snapshots(principalId, { brokerAccountId = null, limit = 50 } = {}) {
    const { rows } = await this.#q.query(`SELECT * FROM portfolio_snapshots WHERE principal_id = $1 AND ($2::text IS NULL OR broker_account_id = $2) ORDER BY taken_at DESC, id DESC LIMIT $3`, [principalId, brokerAccountId, limit]);
    return rows.map((r) => ({ id: r.id, principalId: r.principal_id, brokerAccountId: r.broker_account_id, mode: r.mode, takenAt: r.taken_at.toISOString(), snapshotHash: r.snapshot_hash, marksComplete: r.marks_complete, unrealizedPnlMinor: r.unrealized_pnl_minor === null ? null : String(r.unrealized_pnl_minor), positions: r.positions }));
  }
  async insertReconciliationEvent(e) {
    await this.#q.query(
      `INSERT INTO reconciliation_events (id, principal_id, broker_account_id, mode, checked_at, status, consecutive_mismatches, action, broker_as_of, tolerance, details)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [e.id, e.principalId, e.brokerAccountId, e.mode, e.checkedAt, e.status, e.consecutiveMismatches, e.action, e.brokerAsOf, JSON.stringify(e.tolerance), JSON.stringify(e.details)],
    );
  }
  async reconciliationEvents(principalId, { brokerAccountId = null, mode = null, limit = 50 } = {}) {
    const { rows } = await this.#q.query(
      `SELECT * FROM reconciliation_events WHERE principal_id = $1 AND ($2::text IS NULL OR broker_account_id = $2) AND ($3::text IS NULL OR mode = $3) ORDER BY checked_at DESC, seq DESC LIMIT $4`,
      [principalId, brokerAccountId, mode, limit],
    );
    return rows.map((r) => ({ id: r.id, principalId: r.principal_id, brokerAccountId: r.broker_account_id, mode: r.mode, checkedAt: r.checked_at.toISOString(), status: r.status, consecutiveMismatches: r.consecutive_mismatches, action: r.action, details: r.details }));
  }
  async insertOutbox(r) {
    const { rowCount } = await this.#q.query(
      `INSERT INTO trading_outbox (aggregate_type, aggregate_id, event_type, payload, idempotency_key) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (idempotency_key) DO NOTHING`,
      [r.aggregateType, r.aggregateId, r.eventType, JSON.stringify(r.payload), r.idempotencyKey],
    );
    return { inserted: rowCount === 1 };
  }
  async appendAudit(a) {
    await this.#q.query(`INSERT INTO audit_events (occurred_at, actor_type, actor_id, principal_id, action, target_type, target_id, payload) VALUES ($1,'system',$2,$3,$4,$5,$6,$7)`,
      [a.at, a.actorId, a.principalId, a.action, a.targetType, a.targetId, JSON.stringify(a.payload)]);
  }
}

function canon(v) {
  const s = String(v);
  if (!s.includes('.')) return s;
  const t = s.replace(/0+$/, '').replace(/\.$/, '');
  return t === '-0' ? '0' : t;
}
