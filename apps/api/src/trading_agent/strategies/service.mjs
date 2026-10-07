// Strategy persistence on the Stage 09 tables (Stage 13). Internal API only.
//
//   strategies         one row per strategy; `status` = coarse projection (statusProjection)
//   strategy_versions  immutable, append-only (021 revokes UPDATE/DELETE); definition + definition_hash
//   audit_events       the lifecycle log: action 'strategy.version_created' / 'strategy.lifecycle',
//                      target_type 'strategy_version'. The latest lifecycle event of a version IS its state.
//
// No migration: 021's strategies.status CHECK only allows draft/active/paused/archived, so the
// 7-state lifecycle lives in audit_events (append-only) and strategies.status is a projection.
import { StrategyError } from './errors.mjs';
import { parseStrategyDsl, hashDefinition } from './dsl.mjs';
import { compileStrategy } from './compiler.mjs';
import { LifecycleState, DEPLOYED_STATES, checkTransition, statusProjection } from './lifecycle.mjs';

const PRN_RE = /^prn_[A-Za-z0-9_]{1,64}$/;
const ACTOR_TYPE = Object.freeze({ human: 'user', platform: 'system' }); // audit_events.actor_type
const AUTHORS = Object.freeze(['human']); // who may create strategies and versions

export class StrategyService {
  #store;
  #clock;
  #ids;
  #env;

  /**
   * @param {{store, clock?: () => Date, idFactory: (prefix: string) => string, env?: object}} deps
   *   env is the flag environment for lifecycle guards. It defaults to {} (every flag off), never process.env.
   */
  constructor({ store, clock = () => new Date(), idFactory, env = {} }) {
    if (!store || typeof store.withStrategyLock !== 'function') throw new StrategyError('CONFIG', 'StrategyService requires a store');
    if (typeof idFactory !== 'function') throw new StrategyError('CONFIG', 'StrategyService requires an idFactory');
    this.#store = store;
    this.#clock = clock;
    this.#ids = idFactory;
    this.#env = env;
  }

  async createStrategy({ actor, name, description = null }) {
    assertAuthor(actor);
    if (typeof name !== 'string' || name.trim().length === 0 || [...name].length > 120) throw new StrategyError('SCHEMA_INVALID', 'name must be 1–120 characters');
    const row = { id: this.#ids('stg'), principalId: actor.principalId, name: name.normalize('NFC'), description, status: 'draft', at: this.#clock() };
    await this.#store.insertStrategy(row);
    return Object.freeze({ id: row.id, status: row.status });
  }

  /** Parse, hash and store a new immutable version. Same hash as the latest version → returns it (idempotent). */
  async createVersion({ actor, strategyId, dsl }) {
    assertAuthor(actor);
    const parsed = parseStrategyDsl(dsl);
    return this.#store.withStrategyLock(strategyId, async (tx) => {
      const strategy = await tx.getStrategy(strategyId);
      if (!strategy) throw new StrategyError('NOT_FOUND', `strategy ${strategyId} not found`);
      if (strategy.principalId !== actor.principalId) throw new StrategyError('NOT_FOUND', `strategy ${strategyId} not found`); // no cross-tenant existence leak
      const latest = await tx.latestVersion(strategyId);
      if (latest && latest.definitionHash === parsed.hash) return Object.freeze({ ...summary(latest), created: false });
      const at = this.#clock();
      const row = {
        id: this.#ids('stv'), strategyId, version: (latest?.version ?? 0) + 1,
        definition: parsed.definition, definitionHash: parsed.hash, createdBy: actor.principalId, at,
      };
      await tx.insertVersion(row);
      await tx.appendAudit(auditRow(actor, strategy.principalId, 'strategy.version_created', row.id, { strategyId, version: row.version, definitionHash: row.definitionHash, dslVersion: parsed.dslVersion }, at));
      await tx.appendAudit(auditRow(actor, strategy.principalId, 'strategy.lifecycle', row.id, { strategyId, from: null, to: LifecycleState.DRAFT, definitionHash: row.definitionHash, pausedFrom: null, evidence: {} }, at));
      await this.#project(tx, strategyId, at);
      return Object.freeze({ ...summary(row), created: true });
    });
  }

  /** Read a version back and re-verify its content hash (detects tampering or drift). */
  async getVersion(versionId) {
    const v = await this.#store.getVersion(versionId);
    if (!v) throw new StrategyError('NOT_FOUND', `strategy version ${versionId} not found`);
    if (hashDefinition(v.definition) !== v.definitionHash) throw new StrategyError('CONFLICT', `strategy version ${versionId} failed its integrity check`);
    const state = await this.#store.lifecycleOf(versionId);
    return Object.freeze({ ...summary(v), definition: v.definition, state: state?.to ?? null });
  }

  /** A pure evaluator for a stored version (integrity-checked). */
  async compileVersion(versionId) {
    const v = await this.getVersion(versionId);
    return compileStrategy({ dslVersion: v.definition.dsl, definition: v.definition, hash: v.definitionHash });
  }

  /**
   * Move a version along the lifecycle. `expectedFrom` must equal the current state
   * (optimistic check under the strategy lock), so two racing callers can't both win.
   */
  async transition({ actor, versionId, to, expectedFrom, evidence = {} }) {
    const v0 = await this.#store.getVersion(versionId);
    if (!v0) throw new StrategyError('NOT_FOUND', `strategy version ${versionId} not found`);
    return this.#store.withStrategyLock(v0.strategyId, async (tx) => {
      const strategy = await tx.getStrategy(v0.strategyId);
      // A human may only move their own strategy (platform actors, e.g. a risk engine, may pause any).
      if (actor?.kind === 'human' && actor.principalId !== strategy.principalId) throw new StrategyError('NOT_FOUND', `strategy version ${versionId} not found`);
      const v = await tx.getVersion(versionId);
      if (hashDefinition(v.definition) !== v.definitionHash) throw new StrategyError('CONFLICT', `strategy version ${versionId} failed its integrity check`);
      const current = await tx.lifecycleOf(versionId);
      const from = current?.to ?? null;
      if (from !== expectedFrom) throw new StrategyError('CONFLICT', `version is ${from}, not ${expectedFrom}`);
      const event = checkTransition({ from, to, actor, evidence, definitionHash: v.definitionHash, pausedFrom: current?.pausedFrom ?? null, env: this.#env });

      if ([LifecycleState.PAPER, LifecycleState.LIVE_SMALL, LifecycleState.LIVE].includes(to) && from !== LifecycleState.PAUSED) {
        const others = await tx.versionStates(v.strategyId);
        const deployed = others.filter((o) => o.versionId !== versionId && DEPLOYED_STATES.includes(o.state));
        if (deployed.length) throw new StrategyError('GUARD_FAILED', `version ${deployed[0].versionId} of this strategy is already deployed (${deployed[0].state})`, { failures: ['one deployed version per strategy'] });
      }
      const at = this.#clock();
      await tx.appendAudit(auditRow(actor, strategy.principalId, 'strategy.lifecycle', versionId, { strategyId: v.strategyId, ...event }, at));
      const status = await this.#project(tx, v.strategyId, at);
      return Object.freeze({ versionId, from, to, strategyStatus: status });
    });
  }

  async #project(tx, strategyId, at) {
    const states = (await tx.versionStates(strategyId)).map((s) => s.state);
    const status = statusProjection(states);
    await tx.setStrategyStatus(strategyId, status, at);
    return status;
  }
}

function assertAuthor(actor) {
  if (!actor || !PRN_RE.test(actor.principalId ?? '') || !AUTHORS.includes(actor.kind)) {
    throw new StrategyError('GUARD_FAILED', 'only a human principal may author strategies', { failures: ['author must be a human principal'] });
  }
}

function summary(v) {
  return { id: v.id, strategyId: v.strategyId, version: v.version, definitionHash: v.definitionHash };
}

function auditRow(actor, ownerPrincipalId, action, versionId, payload, at) {
  return {
    occurredAt: at,
    actorType: ACTOR_TYPE[actor.kind] ?? 'agent',
    actorId: actor.principalId,
    principalId: ownerPrincipalId,
    action,
    targetType: 'strategy_version',
    targetId: versionId,
    payload,
  };
}

// ── Stores ────────────────────────────────────────────────────────────────────

/** Deterministic in-memory store with the same contract as PgStrategyStore (tests, backtests). */
export class InMemoryStrategyStore {
  constructor() {
    this.strategies = new Map();
    this.versions = new Map();
    this.audit = [];
    this.locks = new Map();
  }
  async insertStrategy(r) {
    if (this.strategies.has(r.id)) throw new StrategyError('CONFLICT', 'duplicate strategy id');
    this.strategies.set(r.id, { ...r, updatedAt: r.at });
  }
  async getStrategy(id) { return this.strategies.get(id) ?? null; }
  async insertVersion(r) {
    for (const v of this.versions.values()) {
      if (v.strategyId === r.strategyId && v.version === r.version) throw new StrategyError('CONFLICT', 'duplicate version number');
    }
    this.versions.set(r.id, structuredClone(r));
  }
  async getVersion(id) { const v = this.versions.get(id); return v ? structuredClone(v) : null; }
  async latestVersion(strategyId) {
    let best = null;
    for (const v of this.versions.values()) if (v.strategyId === strategyId && (!best || v.version > best.version)) best = v;
    return best ? structuredClone(best) : null;
  }
  async appendAudit(row) { this.audit.push(structuredClone(row)); }
  async lifecycleOf(versionId) {
    for (let i = this.audit.length - 1; i >= 0; i -= 1) {
      const a = this.audit[i];
      if (a.action === 'strategy.lifecycle' && a.targetId === versionId) return a.payload;
    }
    return null;
  }
  async versionStates(strategyId) {
    const out = [];
    for (const v of this.versions.values()) if (v.strategyId === strategyId) out.push({ versionId: v.id, state: (await this.lifecycleOf(v.id))?.to ?? null });
    return out;
  }
  async setStrategyStatus(id, status, at) { const s = this.strategies.get(id); s.status = status; s.updatedAt = at; }
  /** Serialises work per strategy, like SELECT … FOR UPDATE does in Postgres. */
  async withStrategyLock(strategyId, fn) {
    const prev = this.locks.get(strategyId) ?? Promise.resolve();
    let release;
    const next = new Promise((r) => { release = r; });
    this.locks.set(strategyId, prev.then(() => next));
    await prev;
    try { return await fn(this); } finally { release(); }
  }
}

/** Postgres store over migration 021 tables. Each locked unit of work is one transaction. */
export class PgStrategyStore {
  #pool;
  #q;
  constructor(pool, queryable = pool) {
    if (!pool || typeof pool.query !== 'function') throw new StrategyError('CONFIG', 'PgStrategyStore requires a pg pool');
    this.#pool = pool;
    this.#q = queryable;
  }
  async insertStrategy(r) {
    await this.#q.query(
      `INSERT INTO strategies (id, principal_id, name, description, status, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $6)`,
      [r.id, r.principalId, r.name, r.description, r.status, r.at],
    );
  }
  async getStrategy(id) {
    const { rows } = await this.#q.query(`SELECT id, principal_id, name, status FROM strategies WHERE id = $1`, [id]);
    return rows[0] ? { id: rows[0].id, principalId: rows[0].principal_id, name: rows[0].name, status: rows[0].status } : null;
  }
  async insertVersion(r) {
    await this.#q.query(
      `INSERT INTO strategy_versions (id, strategy_id, version, definition, definition_hash, created_by, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [r.id, r.strategyId, r.version, JSON.stringify(r.definition), r.definitionHash, r.createdBy, r.at],
    );
  }
  async getVersion(id) {
    const { rows } = await this.#q.query(`SELECT id, strategy_id, version, definition, definition_hash FROM strategy_versions WHERE id = $1`, [id]);
    return rows[0] ? versionFromRow(rows[0]) : null;
  }
  async latestVersion(strategyId) {
    const { rows } = await this.#q.query(
      `SELECT id, strategy_id, version, definition, definition_hash FROM strategy_versions WHERE strategy_id = $1 ORDER BY version DESC LIMIT 1`, [strategyId],
    );
    return rows[0] ? versionFromRow(rows[0]) : null;
  }
  async appendAudit(a) {
    await this.#q.query(
      `INSERT INTO audit_events (occurred_at, actor_type, actor_id, principal_id, action, target_type, target_id, payload) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [a.occurredAt, a.actorType, a.actorId, a.principalId, a.action, a.targetType, a.targetId, JSON.stringify(a.payload)],
    );
  }
  async lifecycleOf(versionId) {
    const { rows } = await this.#q.query(
      `SELECT payload FROM audit_events WHERE action = 'strategy.lifecycle' AND target_type = 'strategy_version' AND target_id = $1 ORDER BY id DESC LIMIT 1`, [versionId],
    );
    return rows[0]?.payload ?? null;
  }
  async versionStates(strategyId) {
    const { rows } = await this.#q.query(
      `SELECT v.id AS version_id,
              (SELECT a.payload->>'to' FROM audit_events a
                WHERE a.action = 'strategy.lifecycle' AND a.target_type = 'strategy_version' AND a.target_id = v.id
                ORDER BY a.id DESC LIMIT 1) AS state
         FROM strategy_versions v WHERE v.strategy_id = $1 ORDER BY v.version`, [strategyId],
    );
    return rows.map((r) => ({ versionId: r.version_id, state: r.state }));
  }
  async setStrategyStatus(id, status, at) {
    await this.#q.query(`UPDATE strategies SET status = $2, updated_at = $3 WHERE id = $1`, [id, status, at]);
  }
  async withStrategyLock(strategyId, fn) {
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT 1 FROM strategies WHERE id = $1 FOR UPDATE`, [strategyId]);
      const result = await fn(new PgStrategyStore(this.#pool, client));
      await client.query('COMMIT');
      return result;
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }
}

function versionFromRow(r) {
  return { id: r.id, strategyId: r.strategy_id, version: r.version, definition: r.definition, definitionHash: r.definition_hash };
}
