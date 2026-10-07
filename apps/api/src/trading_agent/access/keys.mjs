// Agent / machine API keys (Phase 6 item 11). One key per agent/machine principal, issued by its
// human owner. Only the SHA-256 of the key is stored (scheme of console_accounts/keys.mjs); the raw
// key is returned once, at issue time.
import crypto from 'node:crypto';

export const Scope = Object.freeze({ READ: 'READ', PROPOSE: 'PROPOSE', EXECUTE_UNDER_MANDATE: 'EXECUTE_UNDER_MANDATE' });
const RANK = { READ: 1, PROPOSE: 2, EXECUTE_UNDER_MANDATE: 3 };
export const scopeAllows = (has, needs) => RANK[has] >= RANK[needs];

export const KEY_PREFIX = 'sk_trd_';
export const hashKey = (raw) => crypto.createHash('sha256').update(String(raw)).digest('hex');
export const hintOf = (raw) => `${KEY_PREFIX}…${String(raw).slice(-4)}`;

export class InMemoryAgentKeyStore {
  keys = new Map(); usage = [];
  async insertKey(k) { if ([...this.keys.values()].some((x) => x.principalId === k.principalId)) throw new Error('principal already has a key'); this.keys.set(k.id, structuredClone(k)); }
  async keyByHash(h) { return structuredClone([...this.keys.values()].find((k) => k.keyHash === h) ?? null); }
  async keyById(id) { return structuredClone(this.keys.get(id) ?? null); }
  async revoke(id, at) { const k = this.keys.get(id); if (k && !k.revokedAt) k.revokedAt = at; }
  async insertUsage(u) { if (this.usage.some((x) => x.keyId === u.keyId && x.requestId === u.requestId)) throw Object.assign(new Error('duplicate request'), { code: 'DUPLICATE' }); this.usage.push(structuredClone(u)); }
  async usageSince(keyId, sinceIso) { const r = this.usage.filter((u) => u.keyId === keyId && u.at >= sinceIso); return { calls: r.length, usdMicro: r.reduce((s, u) => s + BigInt(u.chargeUsdMicro), 0n) }; }
}

export class PgAgentKeyStore {
  #pool;
  constructor(pool) { if (!pool?.query) throw new Error('PgAgentKeyStore needs a pg pool'); this.#pool = pool; }
  async insertKey(k) {
    await this.#pool.query(
      `INSERT INTO trading_agent_keys (id, principal_id, owner_principal_id, key_hash, key_hint, scope, mandate_id, budget_calls, budget_usd_micro, budget_period, rate_per_minute, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [k.id, k.principalId, k.ownerPrincipalId, k.keyHash, k.keyHint, k.scope, k.mandateId, k.budgetCalls, String(k.budgetUsdMicro), k.budgetPeriod, k.ratePerMinute, k.createdAt]);
  }
  async keyByHash(h) {
    const { rows } = await this.#pool.query(
      `SELECT k.*, p.kind AS principal_kind FROM trading_agent_keys k JOIN principals p ON p.id = k.principal_id WHERE k.key_hash = $1`, [h]);
    const r = rows[0];
    return r ? { id: r.id, principalId: r.principal_id, principalKind: r.principal_kind, ownerPrincipalId: r.owner_principal_id, keyHash: r.key_hash, keyHint: r.key_hint, scope: r.scope, mandateId: r.mandate_id, budgetCalls: r.budget_calls, budgetUsdMicro: BigInt(r.budget_usd_micro), budgetPeriod: r.budget_period, ratePerMinute: r.rate_per_minute, createdAt: r.created_at.toISOString(), revokedAt: r.revoked_at?.toISOString() ?? null } : null;
  }
  async keyById(id) { const { rows } = await this.#pool.query('SELECT id, owner_principal_id FROM trading_agent_keys WHERE id = $1', [id]); return rows[0] ? { id: rows[0].id, ownerPrincipalId: rows[0].owner_principal_id } : null; }
  async revoke(id, at) { await this.#pool.query('UPDATE trading_agent_keys SET revoked_at = $2 WHERE id = $1 AND revoked_at IS NULL', [id, at]); }
  async insertUsage(u) {
    try {
      await this.#pool.query(`INSERT INTO trading_agent_usage (id, key_id, principal_id, endpoint, request_id, units, charge_usd_micro, price_version, at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [u.id, u.keyId, u.principalId, u.endpoint, u.requestId, u.units, String(u.chargeUsdMicro), u.priceVersion, u.at]);
    } catch (e) { if (e.code === '23505') throw Object.assign(new Error('duplicate request'), { code: 'DUPLICATE' }); throw e; }
  }
  async usageSince(keyId, sinceIso) {
    const { rows } = await this.#pool.query(`SELECT count(*)::int AS calls, COALESCE(sum(charge_usd_micro), 0)::text AS usd FROM trading_agent_usage WHERE key_id = $1 AND at >= $2`, [keyId, sinceIso]);
    return { calls: rows[0].calls, usdMicro: BigInt(rows[0].usd) };
  }
}

export class AgentKeyService {
  #store; #ids; #clock; #principals;
  /** @param principals { get(id) → { id, kind, parentId, state } } — the existing principals table */
  constructor({ store, principals, idFactory, clock = () => new Date() }) {
    if (!store || typeof principals?.get !== 'function' || typeof idFactory !== 'function') throw new Error('AgentKeyService needs store, principals and idFactory');
    this.#store = store; this.#principals = principals; this.#ids = idFactory; this.#clock = clock;
  }

  /** Issued by the HUMAN owner of an agent/machine principal. Returns the raw key once. */
  async issue({ actor, principalId, scope, mandateId = null, budgetCalls, budgetUsdMicro, budgetPeriod = 'day', ratePerMinute = 60 }) {
    if (actor?.kind !== 'human') throw Object.assign(new Error('only a human owner can issue agent keys'), { code: 'FORBIDDEN' });
    const p = await this.#principals.get(principalId);
    if (!p || !['agent', 'machine'].includes(p.kind) || p.parentId !== actor.principalId || p.state !== 'active') throw Object.assign(new Error('not your agent/machine principal'), { code: 'NOT_FOUND' });
    if (!Scope[scope]) throw Object.assign(new Error(`unknown scope ${scope}`), { code: 'INVALID' });
    if (scope === Scope.EXECUTE_UNDER_MANDATE && !mandateId) throw Object.assign(new Error('EXECUTE_UNDER_MANDATE needs a mandate'), { code: 'INVALID' });
    if (!Number.isInteger(budgetCalls) || budgetCalls <= 0 || !Number.isInteger(ratePerMinute) || ratePerMinute < 1 || ratePerMinute > 600) throw Object.assign(new Error('budgetCalls > 0 and ratePerMinute 1–600 required'), { code: 'INVALID' });
    const raw = `${KEY_PREFIX}${crypto.randomBytes(24).toString('base64url')}`;
    const key = { id: this.#ids('tak'), principalId, ownerPrincipalId: actor.principalId, keyHash: hashKey(raw), keyHint: hintOf(raw), scope, mandateId, budgetCalls, budgetUsdMicro: BigInt(budgetUsdMicro), budgetPeriod, ratePerMinute, createdAt: this.#clock().toISOString(), revokedAt: null };
    await this.#store.insertKey(key);
    return Object.freeze({ keyId: key.id, apiKey: raw, keyHint: key.keyHint, scope, principalId });
  }

  async revoke({ actor, keyId }) {
    if (actor?.kind !== 'human') throw Object.assign(new Error('only a human owner can revoke'), { code: 'FORBIDDEN' });
    const k = await this.#store.keyById(keyId);
    if (!k || k.ownerPrincipalId !== actor.principalId) throw Object.assign(new Error('not found'), { code: 'NOT_FOUND' });
    await this.#store.revoke(keyId, this.#clock().toISOString());
  }

  /** resolvePrincipal for the API: raw key → agent/machine principal, or null (unknown / revoked). */
  async resolve(raw) {
    if (typeof raw !== 'string' || !raw.startsWith(KEY_PREFIX)) return null;
    const k = await this.#store.keyByHash(hashKey(raw));
    if (!k || k.revokedAt) return null;
    const p = k.principalKind ? { kind: k.principalKind } : await this.#principals.get(k.principalId);
    return Object.freeze({ principalId: k.principalId, kind: p.kind === 'machine' ? 'machine' : 'agent', via: 'api_key', agentKey: Object.freeze({ id: k.id, ownerPrincipalId: k.ownerPrincipalId, scope: k.scope, mandateId: k.mandateId, budgetCalls: k.budgetCalls, budgetUsdMicro: k.budgetUsdMicro, budgetPeriod: k.budgetPeriod, ratePerMinute: k.ratePerMinute }) });
  }
}
