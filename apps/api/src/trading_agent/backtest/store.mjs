// Backtest / paper-run persistence on the `backtests` table (migration 024).
//
// The table doubles as the job queue: a backtest is enqueued as status 'queued' and a
// worker claims it with FOR UPDATE SKIP LOCKED (no Redis, no BullMQ; audit 02 found no
// production queue). Final rows are immutable (024 trigger). Paper runs (mode 'paper',
// id 'ppr_…') are inserted 'running' and completed when stopped.
import { SimError } from './errors.mjs';

const FINAL = new Set(['completed', 'failed', 'cancelled']);

export class InMemoryBacktestStore {
  constructor() { this.rows = new Map(); }
  async insert(row) {
    if (this.rows.has(row.id)) throw new SimError('CONFLICT', 'duplicate id');
    this.rows.set(row.id, structuredClone({ attempts: 0, startedAt: null, finishedAt: null, result: null, resultHash: null, dataHash: null, bars: null, passed: null, error: null, ...row }));
  }
  async get(id) { const r = this.rows.get(id); return r ? structuredClone(r) : null; }
  async claimNext(at) {
    const next = [...this.rows.values()].filter((r) => r.status === 'queued' && r.mode === 'backtest')
      .sort((a, b) => (a.createdAt - b.createdAt) || (a.id < b.id ? -1 : 1))[0];
    if (!next) return null;
    Object.assign(next, { status: 'running', startedAt: at, attempts: next.attempts + 1 });
    return structuredClone(next);
  }
  async complete(id, f) { return this.#finish(id, { status: 'completed', ...f }); }
  async fail(id, error, at) { return this.#finish(id, { status: 'failed', error, finishedAt: at }); }
  #finish(id, patch) {
    const r = this.rows.get(id);
    if (!r || r.status !== 'running') throw new SimError('CONFLICT', `backtest ${id} is not running`);
    Object.assign(r, structuredClone(patch));
  }
}

export class PgBacktestStore {
  #pool;
  constructor(pool) {
    if (!pool || typeof pool.query !== 'function') throw new SimError('CONFIG', 'PgBacktestStore requires a pg pool');
    this.#pool = pool;
  }
  async insert(r) {
    await this.#pool.query(
      `INSERT INTO backtests (id, principal_id, strategy_version_id, definition_hash, mode, label, status, engine_version,
                             params, params_hash, data_from, data_to, created_at, started_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [r.id, r.principalId, r.strategyVersionId, r.definitionHash, r.mode, r.label, r.status, r.engineVersion,
        JSON.stringify(r.params), r.paramsHash, toTs(r.dataFrom), toTs(r.dataTo), toTs(r.createdAt), toTs(r.startedAt ?? null)],
    );
  }
  async get(id) {
    const { rows } = await this.#pool.query(`SELECT * FROM backtests WHERE id = $1`, [id]);
    return rows[0] ? fromRow(rows[0]) : null;
  }
  async claimNext(at) {
    const { rows } = await this.#pool.query(
      `UPDATE backtests SET status = 'running', started_at = $1, attempts = attempts + 1
        WHERE id = (SELECT id FROM backtests WHERE status = 'queued' AND mode = 'backtest'
                     ORDER BY created_at, id FOR UPDATE SKIP LOCKED LIMIT 1)
        RETURNING *`, [toTs(at)],
    );
    return rows[0] ? fromRow(rows[0]) : null;
  }
  async complete(id, f) {
    const { rowCount } = await this.#pool.query(
      `UPDATE backtests SET status = 'completed', result = $2, result_hash = $3, data_hash = $4, bars = $5, passed = $6, finished_at = $7
        WHERE id = $1 AND status = 'running'`,
      [id, JSON.stringify(f.result), f.resultHash, f.dataHash, f.bars, f.passed, toTs(f.finishedAt)],
    );
    if (rowCount !== 1) throw new SimError('CONFLICT', `backtest ${id} is not running`);
  }
  async fail(id, error, at) {
    const { rowCount } = await this.#pool.query(
      `UPDATE backtests SET status = 'failed', error = $2, finished_at = $3 WHERE id = $1 AND status = 'running'`, [id, String(error).slice(0, 2000), toTs(at)],
    );
    if (rowCount !== 1) throw new SimError('CONFLICT', `backtest ${id} is not running`);
  }
}

const toTs = (v) => (v === null || v === undefined ? null : new Date(v).toISOString());
const ms = (v) => (v === null ? null : new Date(v).getTime());

function fromRow(r) {
  return {
    id: r.id, principalId: r.principal_id, strategyVersionId: r.strategy_version_id, definitionHash: r.definition_hash,
    mode: r.mode, label: r.label, status: r.status, engineVersion: r.engine_version, params: r.params, paramsHash: r.params_hash,
    dataFrom: ms(r.data_from), dataTo: ms(r.data_to), dataHash: r.data_hash, bars: r.bars, result: r.result, resultHash: r.result_hash,
    passed: r.passed, error: r.error, attempts: r.attempts, createdAt: ms(r.created_at), startedAt: ms(r.started_at), finishedAt: ms(r.finished_at),
  };
}

export { FINAL as FINAL_STATUSES };
