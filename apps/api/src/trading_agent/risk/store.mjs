// Risk persistence (Stage 15).
//   risk_policies       (021 + 025 columns) — immutable versions (025 trigger)
//   kill_switch_events  (025)               — append-only
//   audit_events        (021)               — decision records, action 'risk.decision'
import { RiskError } from './errors.mjs';
import { canonicalJson, contentHash, canonicalDecimal } from '../strategies/canonical.mjs';

/** Policy as the checks read it (ctx.policy). */
function policyView(row) {
  const p = row.policy;
  return Object.freeze({
    id: row.id, version: row.version, hash: row.policyHash, principalId: row.principalId, mandateId: row.mandateId,
    currency: p.currency, decimals: p.decimals, maxOrderNotionalMinor: p.maxOrderNotionalMinor, maxDailyNotionalMinor: p.maxDailyNotionalMinor,
    maxDailyLossMinor: p.maxDailyLossMinor, maxLeverage: p.maxLeverage, maxOpenPositions: p.maxOpenPositions,
    allowedInstruments: [...p.allowedInstruments], killSwitch: p.killSwitch, limits: structuredClone(p.limits),
  });
}

export class InMemoryRiskStore {
  constructor() { this.policies = []; this.killSwitches = []; this.decisions = []; this.seq = 0; this.locks = new Map(); }
  async insertPolicy(row) {
    if (this.policies.some((p) => p.principalId === row.principalId && p.mandateId === row.mandateId && p.version === row.version)) throw new RiskError('CONFLICT', 'duplicate policy version');
    this.policies.push(structuredClone(row));
  }
  async latestPolicy(principalId, mandateId) {
    const rows = this.policies.filter((p) => p.principalId === principalId && p.mandateId === mandateId).sort((a, b) => b.version - a.version);
    return rows[0] ? policyView(rows[0]) : null;
  }
  async withPolicyLock(principalId, mandateId, fn) {
    const k = `${principalId}|${mandateId}`;
    const prev = this.locks.get(k) ?? Promise.resolve();
    let release;
    this.locks.set(k, prev.then(() => new Promise((r) => { release = r; })));
    await prev;
    try { return await fn(this); } finally { release(); }
  }
  async appendKillSwitchEvent(e) { this.killSwitches.push({ ...structuredClone(e), seq: ++this.seq }); }
  async killSwitchEvents({ principalId }) {
    return structuredClone(this.killSwitches.filter((e) => e.principalId === null || e.principalId === principalId));
  }
  async recordDecision(r) { this.decisions.push(structuredClone(r)); }
}

export class PgRiskStore {
  #pool; #q;
  constructor(pool, queryable = pool) {
    if (!pool || typeof pool.query !== 'function') throw new RiskError('CONFIG', 'PgRiskStore requires a pg pool');
    this.#pool = pool; this.#q = queryable;
  }
  async insertPolicy(r) {
    const p = r.policy;
    await this.#q.query(
      `INSERT INTO risk_policies (id, principal_id, mandate_id, version, max_order_notional_minor, max_daily_notional_minor, max_daily_loss_minor,
                                  currency, decimals, max_leverage, max_open_positions, allowed_instruments, kill_switch,
                                  limits, policy_hash, created_by, created_by_role, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$18)`,
      [r.id, r.principalId, r.mandateId, r.version, p.maxOrderNotionalMinor, p.maxDailyNotionalMinor, p.maxDailyLossMinor,
        p.currency, p.decimals, p.maxLeverage, p.maxOpenPositions, p.allowedInstruments, p.killSwitch,
        JSON.stringify(p.limits), r.policyHash, r.createdBy, r.createdByRole, r.at],
    );
  }
  async latestPolicy(principalId, mandateId) {
    const { rows } = await this.#q.query(
      `SELECT * FROM risk_policies WHERE principal_id = $1 AND mandate_id IS NOT DISTINCT FROM $2 ORDER BY version DESC LIMIT 1`, [principalId, mandateId],
    );
    if (!rows[0]) return null;
    const r = rows[0];
    const policy = {
      currency: r.currency, decimals: r.decimals, maxOrderNotionalMinor: r.max_order_notional_minor, maxDailyNotionalMinor: r.max_daily_notional_minor,
      maxDailyLossMinor: r.max_daily_loss_minor, maxLeverage: canonicalDecimal(r.max_leverage), maxOpenPositions: r.max_open_positions,
      allowedInstruments: r.allowed_instruments, killSwitch: r.kill_switch, limits: r.limits,
    };
    // Integrity: the row must still hash to what was approved (detects edits at rest).
    if (!r.policy_hash || contentHash(canonicalJson(policy)) !== r.policy_hash) throw new RiskError('CONFLICT', `risk policy ${r.id} failed its integrity check`);
    return policyView({ id: r.id, version: r.version, policyHash: r.policy_hash, principalId: r.principal_id, mandateId: r.mandate_id, policy });
  }
  async withPolicyLock(principalId, mandateId, fn) {
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`risk_policy:${principalId}:${mandateId ?? ''}`]);
      const out = await fn(new PgRiskStore(this.#pool, client));
      await client.query('COMMIT');
      return out;
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }
  async appendKillSwitchEvent(e) {
    await this.#q.query(
      `INSERT INTO kill_switch_events (scope_type, scope_id, principal_id, action, source, actor_id, reason, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [e.scopeType, e.scopeId, e.principalId, e.action, e.source, e.actorId, e.reason, e.at],
    );
  }
  async killSwitchEvents({ principalId }) {
    const { rows } = await this.#q.query(
      `SELECT id, scope_type, scope_id, principal_id, action, source, actor_id, reason, created_at FROM kill_switch_events
        WHERE principal_id IS NULL OR principal_id = $1 ORDER BY id`, [principalId],
    );
    return rows.map((r) => ({ seq: Number(r.id), scopeType: r.scope_type, scopeId: r.scope_id, principalId: r.principal_id, action: r.action, source: r.source, actorId: r.actor_id, reason: r.reason, at: r.created_at.toISOString() }));
  }
  async recordDecision(d) {
    await this.#q.query(
      `INSERT INTO audit_events (occurred_at, actor_type, actor_id, principal_id, action, target_type, target_id, payload)
       VALUES ($1, 'system', 'risk-engine', $2, 'risk.decision', 'order_intent', $3, $4)`,
      [d.decidedAt ?? new Date().toISOString(), /^prn_[A-Za-z0-9_]{1,64}$/.test(d.principalId ?? '') ? d.principalId : null, d.idempotencyKey ?? d.decisionId, JSON.stringify(d)],
    );
  }
}
