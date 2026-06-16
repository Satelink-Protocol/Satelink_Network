/**
 * ensureAdminTables — creates the Admin Command Center tables on boot.
 *
 * Mirrors migrations/001_admin_tables.sql exactly, all IF NOT EXISTS, so it is
 * safe to run on every boot. Used because the Railway Postgres host
 * (postgres-iqew.railway.internal) is only reachable inside Railway's network,
 * so the migration cannot be applied from a developer machine.
 *
 * Follows the existing pattern in this repo (ensureWebhookTable, ensureBillingTables):
 * fire-and-forget with a logged catch — never blocks or crashes boot.
 */

export async function ensureAdminTables(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS developer_intel (
      id                SERIAL PRIMARY KEY,
      ip                VARCHAR(50)  UNIQUE NOT NULL,
      asn               VARCHAR(100),
      isp               VARCHAR(200),
      country           VARCHAR(10),
      city              VARCHAR(100),
      user_agent        TEXT,
      classification    VARCHAR(50)  DEFAULT 'unknown',
      score             INTEGER      DEFAULT 0,
      days_active       INTEGER      DEFAULT 0,
      calls_today       INTEGER      DEFAULT 0,
      avg_daily_calls   INTEGER      DEFAULT 0,
      status            VARCHAR(50)  DEFAULT 'identified',
      notes             TEXT,
      outreach_attempts INTEGER      DEFAULT 0,
      last_outreach_at  TIMESTAMPTZ,
      first_seen        TIMESTAMPTZ  DEFAULT NOW(),
      last_seen         TIMESTAMPTZ  DEFAULT NOW(),
      updated_at        TIMESTAMPTZ  DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS outreach_campaigns (
      id          SERIAL PRIMARY KEY,
      channel     VARCHAR(50),
      template_id VARCHAR(100) UNIQUE,
      target      VARCHAR(200),
      message     TEXT,
      status      VARCHAR(50)  DEFAULT 'draft',
      sent_at     TIMESTAMPTZ,
      created_at  TIMESTAMPTZ  DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS automation_logs (
      id          SERIAL PRIMARY KEY,
      job_name    VARCHAR(100),
      action      VARCHAR(500),
      result      JSONB,
      created_at  TIMESTAMPTZ  DEFAULT NOW()
    )
  `);

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_dev_intel_class_score ON developer_intel (classification, score DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_dev_intel_status ON developer_intel (status)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_auto_logs_job ON automation_logs (job_name, created_at DESC)`);

  return { ok: true, tables: ['developer_intel', 'outreach_campaigns', 'automation_logs'] };
}

export default ensureAdminTables;
