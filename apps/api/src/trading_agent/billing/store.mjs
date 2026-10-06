// Billing store (Stage 27): in-memory (tests) and Postgres (migration 030). Every write that a
// webhook causes happens inside ONE transaction together with the webhook-event record, so a
// replayed or concurrent duplicate delivery is a no-op.
import { BillingError } from './errors.mjs';

const iso = (v) => (v == null ? null : new Date(v).toISOString());

export class InMemoryBillingStore {
  constructor() { this.subs = new Map(); this.events = new Map(); this.payments = new Map(); this.invoices = new Map(); this.lock = Promise.resolve(); this.notices = new Set(); }
  async transaction(fn) {
    const run = this.lock.then(async () => {
      const snap = structuredClone({ subs: [...this.subs], events: [...this.events], payments: [...this.payments], invoices: [...this.invoices] });
      try { return await fn(this); } catch (e) {
        this.subs = new Map(snap.subs); this.events = new Map(snap.events); this.payments = new Map(snap.payments); this.invoices = new Map(snap.invoices);
        throw e;
      }
    });
    this.lock = run.catch(() => {});
    return run;
  }
  async insertSubscription(r) {
    for (const s of this.subs.values()) if (s.principalId === r.principalId && s.mode === r.mode && s.status !== 'ended') throw new BillingError('CONFLICT', 'an open subscription already exists');
    this.subs.set(r.id, structuredClone(r));
  }
  async getSubscription(id) { const s = this.subs.get(id); return s ? structuredClone(s) : null; }
  async getByGatewayId(gateway, gwId) { for (const s of this.subs.values()) if (s.gateway === gateway && s.gatewaySubscriptionId === gwId) return structuredClone(s); return null; }
  async openFor(principalId, mode) { for (const s of this.subs.values()) if (s.principalId === principalId && s.mode === mode && s.status !== 'ended') return structuredClone(s); return null; }
  async updateSubscription(id, patch) { const s = this.subs.get(id); if (!s) return false; Object.assign(s, structuredClone(patch)); return true; }
  async listPastDue() { return [...this.subs.values()].filter((s) => s.status === 'past_due').map((s) => structuredClone(s)); }
  async recordEvent(e) { const k = `${e.gateway}|${e.eventId}`; if (this.events.has(k)) return false; this.events.set(k, structuredClone(e)); return true; }
  async insertPayment(p) { const k = `${p.gateway}|${p.gatewayPaymentId}`; if (this.payments.has(k)) return false; this.payments.set(k, structuredClone(p)); return true; }
  async insertInvoice(inv) {
    for (const i of this.invoices.values()) if (i.gateway === inv.gateway && i.gatewayPaymentId === inv.gatewayPaymentId && i.kind === inv.kind) return false;
    this.invoices.set(inv.id, structuredClone(inv)); return true;
  }
  async listInvoices(principalId) { return [...this.invoices.values()].filter((i) => i.principalId === principalId).map((i) => structuredClone(i)); }
  async getInvoice(id) { const i = this.invoices.get(id); return i ? structuredClone(i) : null; }
  async markNotice(key) { if (this.notices.has(key)) return false; this.notices.add(key); return true; }
}

const SUB_COLS = 'id, principal_id, gateway, gateway_subscription_id, mode, plan_id, catalog_version, status, gateway_status, current_period_start, current_period_end, grace_until, last_event_at, created_at, updated_at';
const subFrom = (r) => r && ({
  id: r.id, principalId: r.principal_id, gateway: r.gateway, gatewaySubscriptionId: r.gateway_subscription_id, mode: r.mode, planId: r.plan_id, catalogVersion: r.catalog_version,
  status: r.status, gatewayStatus: r.gateway_status, currentPeriodStart: iso(r.current_period_start), currentPeriodEnd: iso(r.current_period_end), graceUntil: iso(r.grace_until),
  lastEventAt: Number(r.last_event_at), createdAt: iso(r.created_at), updatedAt: iso(r.updated_at),
});
const COLMAP = { gatewaySubscriptionId: 'gateway_subscription_id', planId: 'plan_id', status: 'status', gatewayStatus: 'gateway_status', currentPeriodStart: 'current_period_start', currentPeriodEnd: 'current_period_end', graceUntil: 'grace_until', lastEventAt: 'last_event_at' };

export class PgBillingStore {
  #pool; #q;
  constructor(pool, queryable = pool) { this.#pool = pool; this.#q = queryable; }
  async transaction(fn) {
    const c = await this.#pool.connect();
    try { await c.query('BEGIN'); const r = await fn(new PgBillingStore(this.#pool, c)); await c.query('COMMIT'); return r; }
    catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; }
    finally { c.release(); }
  }
  async insertSubscription(r) {
    try {
      await this.#q.query(`INSERT INTO billing_subscriptions (id, principal_id, gateway, gateway_subscription_id, mode, plan_id, catalog_version, status, gateway_status, last_event_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [r.id, r.principalId, r.gateway, r.gatewaySubscriptionId ?? null, r.mode, r.planId, r.catalogVersion, r.status, r.gatewayStatus ?? null, r.lastEventAt ?? 0]);
    } catch (e) { if (e.code === '23505') throw new BillingError('CONFLICT', 'an open subscription already exists'); throw e; }
  }
  async getSubscription(id) { const { rows } = await this.#q.query(`SELECT ${SUB_COLS} FROM billing_subscriptions WHERE id = $1`, [id]); return subFrom(rows[0]) ?? null; }
  async getByGatewayId(gateway, gwId) { const { rows } = await this.#q.query(`SELECT ${SUB_COLS} FROM billing_subscriptions WHERE gateway = $1 AND gateway_subscription_id = $2 FOR UPDATE`, [gateway, gwId]); return subFrom(rows[0]) ?? null; }
  async openFor(principalId, mode) { const { rows } = await this.#q.query(`SELECT ${SUB_COLS} FROM billing_subscriptions WHERE principal_id = $1 AND mode = $2 AND status <> 'ended'`, [principalId, mode]); return subFrom(rows[0]) ?? null; }
  async updateSubscription(id, patch) {
    const keys = Object.keys(patch).filter((k) => COLMAP[k]);
    if (!keys.length) return true;
    const sets = keys.map((k, i) => `${COLMAP[k]} = $${i + 2}`).join(', ');
    const { rowCount } = await this.#q.query(`UPDATE billing_subscriptions SET ${sets}, updated_at = now() WHERE id = $1`, [id, ...keys.map((k) => patch[k])]);
    return rowCount === 1;
  }
  async listPastDue() { const { rows } = await this.#q.query(`SELECT ${SUB_COLS} FROM billing_subscriptions WHERE status = 'past_due'`); return rows.map(subFrom); }
  async recordEvent(e) {
    const { rowCount } = await this.#q.query(`INSERT INTO billing_webhook_events (gateway, event_id, event_type, payload_hash, outcome) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`, [e.gateway, e.eventId, e.eventType, e.payloadHash, e.outcome]);
    return rowCount === 1;
  }
  async insertPayment(p) {
    const { rowCount } = await this.#q.query(`INSERT INTO billing_payments (gateway, gateway_payment_id, subscription_id, mode, status, amount_minor, currency, gateway_invoice_id, occurred_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`,
      [p.gateway, p.gatewayPaymentId, p.subscriptionId, p.mode, p.status, String(p.amountMinor), p.currency, p.gatewayInvoiceId, p.occurredAt]);
    return rowCount === 1;
  }
  async insertInvoice(inv) {
    const { rowCount } = await this.#q.query(`INSERT INTO invoices (id, principal_id, subscription_id, kind, mode, gateway, gateway_payment_id, currency, total_minor, period_start, period_end, issued_at, supplier_gstin, customer_gstin, place_of_supply, sac_code, tax_breakdown, gst_review_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) ON CONFLICT DO NOTHING`,
      [inv.id, inv.principalId, inv.subscriptionId, inv.kind, inv.mode, inv.gateway, inv.gatewayPaymentId, inv.currency, String(inv.totalMinor), inv.periodStart, inv.periodEnd, inv.issuedAt,
        inv.gst.supplierGstin, inv.gst.customerGstin, inv.gst.placeOfSupply, inv.gst.sacCode, inv.gst.taxBreakdown, inv.gst.reviewStatus]);
    if (rowCount !== 1) return false;
    for (const l of inv.lines) await this.#q.query(`INSERT INTO invoice_lines (invoice_id, line_no, description, quantity, unit_minor, amount_minor, ledger_txn_id) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [inv.id, l.lineNo, l.description, l.quantity, String(l.unitMinor), String(l.amountMinor), l.ledgerTxnId]);
    return true;
  }
  async listInvoices(principalId) {
    const { rows } = await this.#q.query(`SELECT id, principal_id, subscription_id, kind, mode, gateway, gateway_payment_id, currency, total_minor::text AS total, issued_at, gst_review_status FROM invoices WHERE principal_id = $1 ORDER BY issued_at DESC`, [principalId]);
    return rows.map((r) => ({ id: r.id, principalId: r.principal_id, subscriptionId: r.subscription_id, kind: r.kind, mode: r.mode, gateway: r.gateway, gatewayPaymentId: r.gateway_payment_id, currency: r.currency, totalMinor: BigInt(r.total), issuedAt: iso(r.issued_at), gstReviewStatus: r.gst_review_status }));
  }
  async getInvoice(id) { const { rows } = await this.#q.query(`SELECT id, principal_id FROM invoices WHERE id = $1`, [id]); return rows[0] ? { id: rows[0].id, principalId: rows[0].principal_id } : null; }
  async markNotice() { return true; } // reminder de-duplication lives with the notifier in production
}
