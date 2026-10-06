// Mandate persistence (Stage 16): mandates (021 + 026 columns), audit_events (021),
// and the order cancellation that revocation / expiry / supersession performs on
// orders + order_events (021). Each locked unit of work is one transaction.
import { MandateError } from './errors.mjs';

const OPEN_UNSENT = ['proposed', 'approved'];                        // never reached a broker → cancelled
const AT_BROKER = ['submitted', 'acknowledged', 'partially_filled']; // at a broker → cancel_requested (execution sends it)

export class InMemoryMandateStore {
  constructor() { this.mandates = new Map(); this.audit = []; this.orders = []; this.orderEvents = []; this.locks = new Map(); }
  async withPrincipalLock(principalId, fn) {
    const prev = this.locks.get(principalId) ?? Promise.resolve();
    let release;
    this.locks.set(principalId, prev.then(() => new Promise((r) => { release = r; })));
    await prev;
    try { return await fn(this); } finally { release(); }
  }
  async insertMandate(row) {
    if (this.mandates.has(row.id)) throw new MandateError('CONFLICT', 'duplicate mandate id');
    if ([...this.mandates.values()].some((m) => m.lineageId === row.lineageId && m.version === row.version)) throw new MandateError('CONFLICT', 'duplicate lineage version');
    this.mandates.set(row.id, structuredClone({ approvedAt: null, approvedBy: null, stepUpMethod: null, revokedAt: null, signature: null, signedAt: null, signatureKeyId: null, revocationReason: null, ...row }));
  }
  async getMandate(id) { const m = this.mandates.get(id); return m ? structuredClone(m) : null; }
  async latestVersionInLineage(lineageId) { return Math.max(0, ...[...this.mandates.values()].filter((m) => m.lineageId === lineageId).map((m) => m.version)); }
  async updateMandate(id, patch, expectStatus) {
    const m = this.mandates.get(id);
    if (!m || m.status !== expectStatus) throw new MandateError('CONFLICT', `mandate ${id} is not ${expectStatus}`);
    if (patch.status === 'active' && [...this.mandates.values()].some((x) => x.id !== id && x.lineageId === m.lineageId && x.status === 'active')) throw new MandateError('CONFLICT', 'another version of this mandate is active');
    Object.assign(m, structuredClone(patch));
  }
  async listMandates({ principalId, statuses }) { return structuredClone([...this.mandates.values()].filter((m) => m.principalId === principalId && statuses.includes(m.status))); }
  async listExpired(atIso) { return structuredClone([...this.mandates.values()].filter((m) => m.status === 'active' && Date.parse(m.validUntil) <= Date.parse(atIso))); }
  async appendAudit(e) { this.audit.push(structuredClone(e)); }
  async recentStepUp(principalId, fingerprint, sinceIso) {
    return this.audit.some((a) => a.action === 'mandate.signed' && a.principalId === principalId && a.payload.stepUpFingerprint === fingerprint && Date.parse(a.occurredAt) >= Date.parse(sinceIso));
  }
  async cancelOpenOrders(mandateId, { actor, reason, at }) {
    const out = { cancelled: 0, cancelRequested: 0 };
    for (const o of this.orders.filter((x) => x.mandateId === mandateId)) {
      const to = OPEN_UNSENT.includes(o.status) ? 'cancelled' : AT_BROKER.includes(o.status) ? 'cancel_requested' : null;
      if (!to) continue;
      this.orderEvents.push({ orderId: o.id, eventType: 'mandate_cancel', fromStatus: o.status, toStatus: to, actor, payload: { reason }, createdAt: at });
      o.status = to;
      out[to === 'cancelled' ? 'cancelled' : 'cancelRequested'] += 1;
    }
    return out;
  }
}

export class PgMandateStore {
  #pool; #q;
  constructor(pool, queryable = pool) {
    if (!pool || typeof pool.query !== 'function') throw new MandateError('CONFIG', 'PgMandateStore requires a pg pool');
    this.#pool = pool; this.#q = queryable;
  }
  async withPrincipalLock(principalId, fn) {
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`mandates:${principalId}`]);
      const out = await fn(new PgMandateStore(this.#pool, client));
      await client.query('COMMIT');
      return out;
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }
  async insertMandate(r) {
    await this.#q.query(
      `INSERT INTO mandates (id, principal_id, broker_account_id, strategy_id, mode, mode_code, status, max_notional_minor, currency, decimals,
                             valid_from, valid_until, created_at, lineage_id, version, supersedes_id, environment, terms, terms_hash,
                             sign_nonce, sign_nonce_expires_at, sign_attempts)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)`,
      [r.id, r.principalId, r.brokerAccountId, r.strategyId, r.mode021, r.modeCode, r.status, r.maxNotionalMinor, r.currency, r.decimals,
        r.validFrom, r.validUntil, r.createdAt, r.lineageId, r.version, r.supersedesId, r.environment, JSON.stringify(r.terms), r.termsHash,
        r.signNonce, r.signNonceExpiresAt, r.signAttempts],
    );
  }
  async getMandate(id) {
    const { rows } = await this.#q.query(`SELECT * FROM mandates WHERE id = $1`, [id]);
    return rows[0] ? fromRow(rows[0]) : null;
  }
  async latestVersionInLineage(lineageId) {
    const { rows } = await this.#q.query(`SELECT COALESCE(MAX(version), 0)::int AS v FROM mandates WHERE lineage_id = $1`, [lineageId]);
    return rows[0].v;
  }
  async updateMandate(id, p, expectStatus) {
    const cols = { status: 'status', signAttempts: 'sign_attempts', revokedAt: 'revoked_at', revocationReason: 'revocation_reason', approvedAt: 'approved_at', approvedBy: 'approved_by', stepUpMethod: 'step_up_method', signature: 'signature', signedAt: 'signed_at', signatureKeyId: 'signature_key_id' };
    const keys = Object.keys(p);
    for (const k of keys) if (!cols[k]) throw new MandateError('CONFIG', `unknown mandate field ${k}`);
    const sets = keys.map((k, i) => `${cols[k]} = $${i + 3}`).join(', ');
    const { rowCount } = await this.#q.query(`UPDATE mandates SET ${sets} WHERE id = $1 AND status = $2`, [id, expectStatus, ...keys.map((k) => p[k])]);
    if (rowCount !== 1) throw new MandateError('CONFLICT', `mandate ${id} is not ${expectStatus}`);
  }
  async listMandates({ principalId, statuses }) {
    const { rows } = await this.#q.query(`SELECT * FROM mandates WHERE principal_id = $1 AND status = ANY($2) ORDER BY created_at, id`, [principalId, statuses]);
    return rows.map(fromRow);
  }
  async listExpired(atIso) {
    const { rows } = await this.#q.query(`SELECT * FROM mandates WHERE status = 'active' AND terms_hash IS NOT NULL AND valid_until <= $1 ORDER BY valid_until, id`, [atIso]);
    return rows.map(fromRow);
  }
  async appendAudit(a) {
    await this.#q.query(
      `INSERT INTO audit_events (occurred_at, actor_type, actor_id, principal_id, action, target_type, target_id, payload) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [a.occurredAt, a.actorType, a.actorId, a.principalId, a.action, a.targetType, a.targetId, JSON.stringify(a.payload)],
    );
  }
  async recentStepUp(principalId, fingerprint, sinceIso) {
    const { rowCount } = await this.#q.query(
      `SELECT 1 FROM audit_events WHERE action = 'mandate.signed' AND principal_id = $1 AND payload->>'stepUpFingerprint' = $2 AND occurred_at >= $3 LIMIT 1`,
      [principalId, fingerprint, sinceIso],
    );
    return rowCount > 0;
  }
  async cancelOpenOrders(mandateId, { actor, reason, at }) {
    const out = { cancelled: 0, cancelRequested: 0 };
    for (const [from, to, key] of [[OPEN_UNSENT, 'cancelled', 'cancelled'], [AT_BROKER, 'cancel_requested', 'cancelRequested']]) {
      const { rows } = await this.#q.query(
        `WITH changed AS (
           UPDATE orders o SET status = $3, updated_at = $4
             FROM (SELECT id, status AS old_status FROM orders WHERE mandate_id = $1 AND status = ANY($2) FOR UPDATE) prev
            WHERE o.id = prev.id RETURNING o.id, prev.old_status)
         INSERT INTO order_events (order_id, event_type, from_status, to_status, actor, payload, created_at)
         SELECT id, 'mandate_cancel', old_status, $3, $5, $6, $4 FROM changed RETURNING order_id`,
        [mandateId, from, to, at, actor, JSON.stringify({ reason })],
      );
      out[key] = rows.length;
    }
    return out;
  }
}

const iso = (v) => (v === null || v === undefined ? null : new Date(v).toISOString());
function fromRow(r) {
  return {
    id: r.id, principalId: r.principal_id, brokerAccountId: r.broker_account_id, strategyId: r.strategy_id, mode021: r.mode, modeCode: r.mode_code,
    status: r.status, maxNotionalMinor: r.max_notional_minor, currency: r.currency, decimals: r.decimals, validFrom: iso(r.valid_from), validUntil: iso(r.valid_until),
    approvedAt: iso(r.approved_at), approvedBy: r.approved_by, stepUpMethod: r.step_up_method, createdAt: iso(r.created_at), revokedAt: iso(r.revoked_at),
    lineageId: r.lineage_id, version: r.version, supersedesId: r.supersedes_id, environment: r.environment, terms: r.terms, termsHash: r.terms_hash,
    signNonce: r.sign_nonce, signNonceExpiresAt: iso(r.sign_nonce_expires_at), signAttempts: r.sign_attempts, signature: r.signature, signedAt: iso(r.signed_at),
    signatureKeyId: r.signature_key_id, revocationReason: r.revocation_reason,
  };
}
