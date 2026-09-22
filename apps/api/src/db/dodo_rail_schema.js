// Boot-time DDL for the Dodo human payment rail (PR #386), HARDENED so it can
// never crash-loop prod:
//   - Serialized across concurrent instances via pg_advisory_xact_lock (1d).
//   - The payment_sources.source CHECK is recreated with EVERY value it already
//     allows + every value currently present in the table + 'dodo' — so an
//     unknown prod value is preserved, not dropped (1a). Unknowns are reported.
//   - Recreation is SKIPPED entirely if the live CHECK already allows 'dodo' (1c).
//   - The CHECK is added NOT VALID (no full-table scan at boot); VALIDATE lives
//     only in migration 035, run manually (1b).
//   - All columns are ADD COLUMN IF NOT EXISTS (1f).
//   - On ANY failure the whole unit rolls back, readiness is set false, an error
//     is logged + a Discord alert fired, and the caller keeps booting (1e).
//
// apps/api/migrations/*.sql have no auto-runner in prod; this function is the
// only thing that reliably applies the Dodo schema on deploy.

import { discord } from '../services/discord_notify.mjs';
import { setDodoSchemaReady } from './dodo_schema_state.js';

// Fixed advisory-lock key (arbitrary constant, unique to this migration unit).
const ADVISORY_KEY = 386_033_035;
const CONSTRAINT = 'payment_sources_source_check';
// Values this code knows about. Union with whatever prod already allows/has.
const KNOWN_SOURCES = ['polygon_usdt_vault', 'x402', 'dodo', 'marketplace', 'other'];

/** Extract quoted string literals from a CHECK constraint definition. */
function parseAllowedValues(def) {
  if (!def) return [];
  const out = [];
  const re = /'((?:[^']|'')*)'/g;
  let m;
  while ((m = re.exec(def)) !== null) out.push(m[1].replace(/''/g, "'"));
  return out;
}

/** Single-quote-escape a value for an inlined SQL string literal. */
function sqlLit(v) {
  return `'${String(v).replace(/'/g, "''")}'`;
}

/**
 * Ensure the Dodo-rail schema. Never throws.
 * @param {import('pg').Pool} pool
 * @param {object} [deps] - { logger, notifier } injectable for tests
 * @returns {Promise<{ok:boolean, ready:boolean, skippedConstraint?:boolean, unknownSources?:string[], reason?:string}>}
 */
export async function ensureDodoRailSchema(pool, deps = {}) {
  const logger = deps.logger || console;
  const notifier = deps.notifier || ((title, msg) => discord.alert(title, msg, 'critical').catch(() => {}));

  if (!pool || typeof pool.connect !== 'function') {
    setDodoSchemaReady(false);
    return { ok: false, ready: false, reason: 'no_pool' };
  }

  const client = await pool.connect();
  let unknownSources = [];
  try {
    await client.query('BEGIN');
    // Serialize concurrent instances — auto-released at COMMIT/ROLLBACK.
    await client.query('SELECT pg_advisory_xact_lock($1)', [ADVISORY_KEY]);

    // Current CHECK definition (if the constraint exists at all).
    const defRow = await client.query(
      `SELECT pg_get_constraintdef(c.oid) AS def
         FROM pg_constraint c
        WHERE c.conrelid = 'payment_sources'::regclass
          AND c.conname = $1 AND c.contype = 'c'`,
      [CONSTRAINT]
    );
    const currentDef = defRow.rows[0]?.def || null;
    const alreadyAllowsDodo = !!currentDef && /'dodo'/.test(currentDef);

    let skippedConstraint = false;
    if (alreadyAllowsDodo) {
      // (1c) Nothing to do for the constraint — do NOT churn it every boot.
      skippedConstraint = true;
      logger.log?.(`[dodo-schema] ${CONSTRAINT} already allows 'dodo' — skipping recreate`);
    } else {
      // (1a) Preserve every value the constraint allows + every value present in
      // the table, union with KNOWN + 'dodo'. Never drop a value prod uses.
      const present = (await client.query(`SELECT DISTINCT source FROM payment_sources`)).rows
        .map((r) => r.source).filter((v) => v != null);
      const fromDef = parseAllowedValues(currentDef);
      unknownSources = [...new Set([...present, ...fromDef])].filter((v) => !KNOWN_SOURCES.includes(v));
      if (unknownSources.length) {
        logger.error?.(`[dodo-schema] payment_sources has source values the code did not know: ${unknownSources.join(', ')} — preserving them in the CHECK`);
        notifier('Dodo schema — unknown payment_sources.source values preserved',
          `Preserved in the recreated CHECK (not dropped): ${unknownSources.join(', ')}`);
      }
      const allowed = [...new Set([...KNOWN_SOURCES, ...present, ...fromDef])];
      const inList = allowed.map(sqlLit).join(', ');
      await client.query(`ALTER TABLE payment_sources DROP CONSTRAINT IF EXISTS ${CONSTRAINT}`);
      // (1b) NOT VALID — no full-table validation scan at boot. VALIDATE is in 035.
      await client.query(
        `ALTER TABLE payment_sources ADD CONSTRAINT ${CONSTRAINT} CHECK (source IN (${inList})) NOT VALID`
      );
      logger.log?.(`[dodo-schema] recreated ${CONSTRAINT} (NOT VALID) allowing: ${allowed.join(', ')}`);
    }

    // (1f) Additive columns — safe to run every boot.
    await client.query(`ALTER TABLE revenue_events_v2 ADD COLUMN IF NOT EXISTS demand_source TEXT NOT NULL DEFAULT 'direct'`);
    await client.query(`ALTER TABLE revenue_events_v2 ADD COLUMN IF NOT EXISTS is_billable BOOLEAN NOT NULL DEFAULT true`);
    await client.query(`ALTER TABLE api_credits ADD COLUMN IF NOT EXISTS frozen_usdt NUMERIC(18,6) NOT NULL DEFAULT 0`);
    await client.query(`ALTER TABLE api_credits ADD COLUMN IF NOT EXISTS payment_hold BOOLEAN NOT NULL DEFAULT false`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS dodo_refund_dispute_log (
        id BIGSERIAL PRIMARY KEY,
        event_id TEXT UNIQUE NOT NULL,
        kind TEXT NOT NULL,
        event_type TEXT NOT NULL,
        dodo_ref TEXT NOT NULL,
        payment_id TEXT,
        api_key TEXT,
        amount_usd NUMERIC(18,6) NOT NULL DEFAULT 0,
        shortfall_usd NUMERIC(18,6) NOT NULL DEFAULT 0,
        is_test_data BOOLEAN NOT NULL DEFAULT false,
        created_at BIGINT NOT NULL
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_dodo_rd_log_payment ON dodo_refund_dispute_log(payment_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_dodo_rd_log_ref ON dodo_refund_dispute_log(dodo_ref)`);

    // 036: identity-mapping fallback — payments whose checkout metadata does
    // not resolve to an existing account land here instead of being credited,
    // dropped, or matched by email guess. See migrations/036_dodo_unmatched_payments.sql.
    await client.query(`
      CREATE TABLE IF NOT EXISTS unmatched_payments (
        id                BIGSERIAL PRIMARY KEY,
        provider          TEXT NOT NULL DEFAULT 'dodo',
        event_type        TEXT NOT NULL,
        payment_id        TEXT,
        subscription_id   TEXT,
        product_id        TEXT,
        customer_email    TEXT,
        currency          TEXT,
        amount_minor      BIGINT,
        metadata          JSONB,
        reason            TEXT NOT NULL,
        raw_payload       JSONB,
        resolved          BOOLEAN NOT NULL DEFAULT false,
        resolved_api_key  TEXT,
        resolved_by       TEXT,
        resolved_at       BIGINT,
        is_test_data      BOOLEAN NOT NULL DEFAULT false,
        created_at        BIGINT NOT NULL
      )
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_unmatched_payments_payment_id
        ON unmatched_payments(provider, payment_id) WHERE payment_id IS NOT NULL
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_unmatched_payments_resolved ON unmatched_payments(resolved)`);

    // 037: one-time checkout claim tokens (T-1.4 security fix) — the success
    // redirect carries an opaque token instead of the raw api_key. See
    // migrations/037_dodo_checkout_claims.sql.
    await client.query(`
      CREATE TABLE IF NOT EXISTS dodo_checkout_claims (
        token       TEXT PRIMARY KEY,
        api_key     TEXT NOT NULL,
        created_at  BIGINT NOT NULL,
        expires_at  BIGINT NOT NULL,
        claimed_at  BIGINT
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_dodo_checkout_claims_expires ON dodo_checkout_claims(expires_at)`);

    await client.query('COMMIT');
    setDodoSchemaReady(true);
    logger.log?.('[dodo-schema] ✅ Dodo-rail schema ensured');
    return { ok: true, ready: true, skippedConstraint, unknownSources };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    // (1e) Do NOT rethrow — the server keeps booting (RPC + x402 stay up). The
    // webhook fails closed (503) via the readiness flag until this succeeds.
    setDodoSchemaReady(false);
    logger.error?.('[dodo-schema] ❌ Dodo-rail schema DDL failed — webhook will fail closed (503):', err?.message ?? err);
    notifier('Dodo schema DDL failed — webhook fails closed (503)',
      `ensureDodoRailSchema error: ${err?.message ?? err}. RPC/x402 unaffected; Dodo credit/reversal returns 503 until fixed.`);
    return { ok: false, ready: false, reason: err?.message ?? String(err) };
  } finally {
    client.release();
  }
}
