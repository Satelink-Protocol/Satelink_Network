// Memory stores (Phase 6 item 9). In-memory for tests; Pg over migration 034. Append-only except
// the user profile. Every read is bounded (limit) — memory is retrieved, never dumped.
const TABLES = ['strategy_memory', 'decision_memory', 'trade_memory', 'error_memory', 'calibration_proposals', 'calibration_decisions'];

export class InMemoryMemoryStore {
  profiles = new Map();
  rows = Object.fromEntries(TABLES.map((t) => [t, []]));
  async upsertProfile(p) { const cur = this.profiles.get(p.principalId); this.profiles.set(p.principalId, structuredClone({ ...p, version: (cur?.version ?? 0) + 1 })); return this.profiles.get(p.principalId); }
  async profile(principalId) { return structuredClone(this.profiles.get(principalId) ?? null); }
  async append(table, row) {
    if (!TABLES.includes(table)) throw new Error(`unknown memory table ${table}`);
    if (row.id !== undefined && this.rows[table].some((r) => r.id === row.id)) throw new Error('duplicate id');
    if (table === 'decision_memory' && row.entryKind === 'outcome' && this.rows[table].some((r) => r.decisionId === row.decisionId && r.entryKind === 'outcome')) throw new Error('outcome already recorded');
    if (table === 'calibration_decisions' && this.rows[table].some((r) => r.proposalId === row.proposalId)) throw new Error('proposal already decided');
    this.rows[table].push(structuredClone(row));
  }
  async list(table, where = {}, limit = 50) {
    return structuredClone(this.rows[table].filter((r) => Object.entries(where).every(([k, v]) => r[k] === v)).slice(-limit).reverse());
  }
  async all(table) { return structuredClone(this.rows[table]); }
}

const SNAKE = (k) => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
const CAMEL = (k) => k.replace(/_([a-z])/g, (_m, c) => c.toUpperCase());
const JSON_COLS = new Set(['metrics', 'dimension_scores', 'execution_quality', 'context', 'weights', 'report']);

export class PgMemoryStore {
  #pool;
  constructor(pool) { if (!pool?.query) throw new Error('PgMemoryStore needs a pg pool'); this.#pool = pool; }
  async upsertProfile(p) {
    const { rows } = await this.#pool.query(
      `INSERT INTO user_trading_profile (principal_id, risk_tolerance, capital, currency, max_loss, markets, brokers, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (principal_id) DO UPDATE SET risk_tolerance = EXCLUDED.risk_tolerance, capital = EXCLUDED.capital, currency = EXCLUDED.currency,
         max_loss = EXCLUDED.max_loss, markets = EXCLUDED.markets, brokers = EXCLUDED.brokers, updated_at = EXCLUDED.updated_at,
         version = user_trading_profile.version + 1
       RETURNING *`,
      [p.principalId, p.riskTolerance, p.capital ?? null, p.currency ?? 'USDT', p.maxLoss ?? null, p.markets ?? [], p.brokers ?? [], p.updatedAt],
    );
    return fromRow(rows[0]);
  }
  async profile(principalId) { const { rows } = await this.#pool.query('SELECT * FROM user_trading_profile WHERE principal_id = $1', [principalId]); return rows[0] ? fromRow(rows[0]) : null; }
  async append(table, row) {
    if (!TABLES.includes(table)) throw new Error(`unknown memory table ${table}`);
    const keys = Object.keys(row).filter((k) => row[k] !== undefined);
    const cols = keys.map(SNAKE);
    const vals = keys.map((k, i) => (JSON_COLS.has(cols[i]) && row[k] !== null ? JSON.stringify(row[k]) : row[k]));
    await this.#pool.query(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map((_c, i) => `$${i + 1}`).join(', ')})`, vals);
  }
  async list(table, where = {}, limit = 50) {
    if (!TABLES.includes(table)) throw new Error(`unknown memory table ${table}`);
    const ks = Object.keys(where);
    const order = { strategy_memory: 'recorded_at', decision_memory: 'recorded_at', trade_memory: 'closed_at', error_memory: 'occurred_at', calibration_proposals: 'created_at', calibration_decisions: 'decided_at' }[table];
    const { rows } = await this.#pool.query(
      `SELECT * FROM ${table}${ks.length ? ` WHERE ${ks.map((k, i) => `${SNAKE(k)} = $${i + 1}`).join(' AND ')}` : ''} ORDER BY ${order} DESC, id DESC LIMIT ${Number(limit)}`,
      ks.map((k) => where[k]),
    );
    return rows.map(fromRow);
  }
  async all(table) { return this.list(table, {}, 100_000); }
}

function fromRow(r) {
  const o = {};
  for (const [k, v] of Object.entries(r)) o[CAMEL(k)] = v instanceof Date ? v.toISOString() : v;
  return o;
}
