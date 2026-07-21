// PostgreSQL durable store — production binding of the DurableStore interface.
// Same method surface as MemoryDurableStore (all async). Uses a `pg` pool.
// Idempotency insert-if-absent is enforced atomically by the primary key
// (ON CONFLICT DO NOTHING), so exactly-once holds across processes/crashes.

const GENESIS = '0'.repeat(64);

export class PgDurableStore {
  constructor(pool) {
    if (!pool) throw new Error('PgDurableStore requires a pg pool/client');
    this.pool = pool;
  }

  async init() {
    // Idempotent schema creation (mirrors schema.sql). Safe to call on boot.
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const path = fileURLToPath(new URL('./schema.sql', import.meta.url));
    await this.pool.query(readFileSync(path, 'utf8'));
  }

  async appendEvent(ev) {
    const { rows } = await this.pool.query(
      `INSERT INTO vnext_journal(stream_id, phase, payload, ts, hash_prev, hash_current)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING seq`,
      [ev.stream_id, ev.phase, JSON.stringify(ev.payload), ev.ts, ev.hash_prev, ev.hash_current],
    );
    return { seq: Number(rows[0].seq), ...ev };
  }
  async readStream(streamId) {
    const { rows } = await this.pool.query(
      `SELECT seq, stream_id, phase, payload, ts, hash_prev, hash_current
       FROM vnext_journal WHERE stream_id=$1 ORDER BY seq`, [streamId]);
    return rows.map(this._row);
  }
  async allEvents() {
    const { rows } = await this.pool.query(
      `SELECT seq, stream_id, phase, payload, ts, hash_prev, hash_current FROM vnext_journal ORDER BY seq`);
    return rows.map(this._row);
  }
  async lastHash() {
    const { rows } = await this.pool.query(`SELECT hash_current FROM vnext_journal ORDER BY seq DESC LIMIT 1`);
    return rows.length ? rows[0].hash_current : GENESIS;
  }
  _row(r) { return { seq: Number(r.seq), stream_id: r.stream_id, phase: r.phase, payload: r.payload, ts: Number(r.ts), hash_prev: r.hash_prev, hash_current: r.hash_current }; }

  async kvGet(key) {
    const { rows } = await this.pool.query(`SELECT result FROM vnext_idempotency WHERE key=$1`, [key]);
    return rows.length ? rows[0].result : null;
  }
  async kvSetIfAbsent(key, value) {
    const { rows } = await this.pool.query(
      `INSERT INTO vnext_idempotency(key, result, created) VALUES ($1,$2,$3)
       ON CONFLICT (key) DO NOTHING RETURNING key`, [key, JSON.stringify(value), Date.now()]);
    if (rows.length) return { inserted: true, value };
    return { inserted: false, value: await this.kvGet(key) };
  }

  async supplierUpsert(id, snapshot, ts) {
    await this.pool.query(
      `INSERT INTO vnext_suppliers(supplier_id, snapshot, updated_at) VALUES ($1,$2,$3)
       ON CONFLICT (supplier_id) DO UPDATE SET snapshot=EXCLUDED.snapshot, updated_at=EXCLUDED.updated_at`,
      [id, JSON.stringify(snapshot), ts]);
  }
  async supplierDelete(id) { await this.pool.query(`DELETE FROM vnext_suppliers WHERE supplier_id=$1`, [id]); }
  async supplierAll() {
    const { rows } = await this.pool.query(`SELECT supplier_id, snapshot, updated_at FROM vnext_suppliers`);
    return rows.map((r) => ({ supplier_id: r.supplier_id, snapshot: r.snapshot, updated_at: Number(r.updated_at) }));
  }

  async dlqAdd(entry) {
    await this.pool.query(
      `INSERT INTO vnext_dlq(tx_id, reason, attempts, request, failed_at) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (tx_id) DO NOTHING`,
      [entry.tx_id, entry.reason, entry.attempts, JSON.stringify(entry.request), entry.failed_at]);
  }
  async dlqAll() {
    const { rows } = await this.pool.query(`SELECT tx_id, reason, attempts, request, failed_at FROM vnext_dlq`);
    return rows.map((r) => ({ tx_id: r.tx_id, reason: r.reason, attempts: r.attempts, request: r.request, failed_at: Number(r.failed_at) }));
  }
  async dlqGet(txId) {
    const { rows } = await this.pool.query(`SELECT tx_id, reason, attempts, request, failed_at FROM vnext_dlq WHERE tx_id=$1`, [txId]);
    return rows.length ? { tx_id: rows[0].tx_id, reason: rows[0].reason, attempts: rows[0].attempts, request: rows[0].request, failed_at: Number(rows[0].failed_at) } : null;
  }

  /**
   * Run `fn` while holding a Postgres session-level advisory lock. Only one
   * process/instance can hold the lock for `key` at a time, so concurrent
   * recovery sweeps across instances are serialized to exactly one. Non-blocking:
   * if another instance holds the lock, returns {ran:false} immediately instead
   * of queueing. Lock + unlock run on the SAME dedicated client (advisory locks
   * are session-scoped); the client is always released.
   * @returns {{ran:boolean, result:any}}
   */
  async withAdvisoryLock(key, fn) {
    const client = await this.pool.connect();
    try {
      const { rows } = await client.query('SELECT pg_try_advisory_lock($1) AS locked', [key]);
      if (!rows[0].locked) return { ran: false, result: null };
      try {
        return { ran: true, result: await fn() };
      } finally {
        await client.query('SELECT pg_advisory_unlock($1)', [key]);
      }
    } finally {
      client.release();
    }
  }
}

export { GENESIS };
