import { expect } from 'chai';
import pkg from 'pg';
const { Pool } = pkg;

// Integration test for migration 035 (payment_sources.source CHECK allows 'dodo').
// Runs against a REAL Postgres (local satelink_test). In CI the DATABASE_URL is a
// dummy unreachable host, so the connection fails and the whole suite is skipped —
// it never fails CI, and it proves the fix locally.
describe('035 — payment_sources.source CHECK allows dodo (integration)', function () {
  this.timeout(15000);
  let pool;
  const TX = `test:dodo035:${Date.now()}`;
  const TX_BOGUS = `${TX}:bogus`;

  const OLD_CHECK = `CHECK (source IN ('polygon_usdt_vault','x402','marketplace','other'))`;      // 027 / migrate.js
  const NEW_CHECK = `CHECK (source IN ('polygon_usdt_vault','x402','dodo','marketplace','other'))`; // 031 / 035
  const insertDodo = (tx) =>
    pool.query(
      `INSERT INTO payment_sources (source, amount_usd, token, network, tx_hash, payer)
       VALUES ('dodo', 1, 'USD', 'dodo', $1, 'test') RETURNING id`, [tx]
    );

  before(async function () {
    if (!process.env.DATABASE_URL) this.skip();
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    try {
      await pool.query('SELECT 1');
    } catch {
      await pool.end().catch(() => {});
      pool = null;
      this.skip();
    }
    // Ensure the table exists (satelink_test may be sparse), then set the PRE-FIX
    // constraint so we can demonstrate the break and then the fix.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS payment_sources (
        id BIGSERIAL PRIMARY KEY,
        source TEXT NOT NULL,
        amount_usd NUMERIC(18,6) NOT NULL,
        token TEXT NOT NULL,
        network TEXT NOT NULL,
        tx_hash TEXT UNIQUE NOT NULL,
        payer TEXT NOT NULL,
        credited_api_key TEXT,
        is_test_data BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
    await pool.query(`ALTER TABLE payment_sources DROP CONSTRAINT IF EXISTS payment_sources_source_check`);
    await pool.query(`ALTER TABLE payment_sources ADD CONSTRAINT payment_sources_source_check ${OLD_CHECK}`);
  });

  after(async function () {
    if (!pool) return;
    await pool.query(`DELETE FROM payment_sources WHERE tx_hash IN ($1,$2)`, [TX, TX_BOGUS]).catch(() => {});
    await pool.end().catch(() => {});
  });

  it('pre-fix: a Dodo insert is REJECTED by the old CHECK (the prod bug)', async () => {
    let err;
    try { await insertDodo(TX); } catch (e) { err = e; }
    expect(err, 'expected a CHECK violation').to.exist;
    expect(err.code).to.equal('23514'); // check_violation
  });

  it('after migration 035: the Dodo insert SUCCEEDS', async () => {
    // Exactly what 035_dodo_source_check.sql / ensureBillingTables apply:
    await pool.query(`ALTER TABLE payment_sources DROP CONSTRAINT IF EXISTS payment_sources_source_check`);
    await pool.query(`ALTER TABLE payment_sources ADD CONSTRAINT payment_sources_source_check ${NEW_CHECK}`);
    const res = await insertDodo(TX);
    expect(res.rows[0].id).to.be.a('number');
  });

  it('a bogus source is still rejected (constraint not loosened away)', async () => {
    let err;
    try {
      await pool.query(
        `INSERT INTO payment_sources (source, amount_usd, token, network, tx_hash, payer)
         VALUES ('not_a_real_source', 1, 'USD', 'x', $1, 'test')`, [TX_BOGUS]
      );
    } catch (e) { err = e; }
    expect(err, 'expected a CHECK violation').to.exist;
    expect(err.code).to.equal('23514');
  });
});
