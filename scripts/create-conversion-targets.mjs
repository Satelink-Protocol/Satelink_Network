#!/usr/bin/env node
// create-conversion-targets.mjs
// Builds a DURABLE conversion_targets table (Customer Zero infra) and seeds it
// from the live free-tier warm leads in Redis (ft:* counters).
//
// Why Redis, not a Postgres "free_tier_counters" table: the free-tier gate
// (apps/api/src/middleware/free_tier_gate.js) stores per-IP daily call counts in
// Redis keys `ft:<ip>` that EXPIRE at midnight UTC. There is no Postgres source
// table. This script promotes those volatile daily counters into a persistent,
// accumulating leads table so warm leads survive the daily reset.
//
// Run:  DATABASE_URL=<pg public url> REDIS_URL=<redis public url> node scripts/create-conversion-targets.mjs
// (URLs are injected from Railway service vars by the caller; never hardcode secrets.)

import pg from 'pg';
import Redis from 'ioredis';
import { createHash } from 'node:crypto';

const FREE_TIER_LIMIT = parseInt(process.env.FREE_TIER_LIMIT || '500', 10);
const WARM_THRESHOLD = Math.floor(FREE_TIER_LIMIT * 0.9); // matches getConversionTargets()
const IP_HASH_SALT = process.env.IP_HASH_SALT || 'satelink'; // matches free_tier_gate default

if (!process.env.DATABASE_URL) { console.error('FATAL: DATABASE_URL not set'); process.exit(1); }

// Same hashing the app uses so client IDs line up across systems.
const hashIp = (ip) =>
  'IP-' + createHash('sha256').update(ip + IP_HASH_SALT).digest('hex').substring(0, 12);

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function main() {
  // 1. Durable table + indexes (idempotent).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS conversion_targets (
      id            SERIAL PRIMARY KEY,
      ip_hash       TEXT NOT NULL,
      total_calls   INTEGER DEFAULT 0,
      days_active   INTEGER DEFAULT 1,
      last_seen     TIMESTAMPTZ,
      first_seen    TIMESTAMPTZ,
      intent_score  INTEGER DEFAULT 0,
      converted     BOOLEAN DEFAULT false,
      converted_at  TIMESTAMPTZ,
      wallet_address TEXT,
      notes         TEXT,
      created_at    TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS conversion_targets_ip_hash_idx ON conversion_targets(ip_hash);
    CREATE INDEX IF NOT EXISTS conversion_targets_intent_score_idx ON conversion_targets(intent_score DESC);
  `);
  console.log('conversion_targets table ready');

  // 2. Pull live warm leads from Redis (graceful if Redis is unreachable).
  if (!process.env.REDIS_URL) {
    console.log('REDIS_URL not set — table created but not seeded (no live source).');
    return;
  }
  const redis = new Redis(process.env.REDIS_URL, {
    tls: process.env.REDIS_URL.startsWith('rediss://') ? {} : undefined,
    maxRetriesPerRequest: 2,
    lazyConnect: true,
  });
  await redis.connect();

  const keys = await redis.keys('ft:*');
  if (!keys.length) { console.log('No ft:* keys in Redis — nothing to seed.'); await redis.quit(); return; }
  const vals = keys.length ? await redis.mget(...keys) : [];

  const leads = [];
  for (let i = 0; i < keys.length; i++) {
    const count = parseInt(vals[i], 10) || 0;
    if (count >= WARM_THRESHOLD) {
      leads.push({
        ip_hash: hashIp(keys[i].slice(3)), // strip 'ft:'
        calls: count,
        // honest scoring from the only signal we have today (no daily history in Redis):
        score: count > FREE_TIER_LIMIT ? 100 : count >= FREE_TIER_LIMIT * 0.95 ? 70 : 40,
      });
    }
  }
  await redis.quit();
  console.log(`Found ${leads.length} warm leads (>=${WARM_THRESHOLD} calls today) out of ${keys.length} active IPs`);

  // 3. UPSERT — accumulate across runs: keep peak calls, bump days_active on a new day, keep max score.
  let seeded = 0;
  for (const l of leads) {
    const r = await pool.query(
      `INSERT INTO conversion_targets (ip_hash, total_calls, intent_score, first_seen, last_seen, days_active)
       VALUES ($1, $2, $3, NOW(), NOW(), 1)
       ON CONFLICT (ip_hash) DO UPDATE SET
         total_calls  = GREATEST(conversion_targets.total_calls, EXCLUDED.total_calls),
         intent_score = GREATEST(conversion_targets.intent_score, EXCLUDED.intent_score),
         days_active  = conversion_targets.days_active
                        + (CASE WHEN conversion_targets.last_seen < date_trunc('day', NOW()) THEN 1 ELSE 0 END),
         last_seen    = NOW()`,
      [l.ip_hash, l.calls, l.score]
    );
    seeded += r.rowCount;
  }
  console.log(`Upserted ${seeded} warm leads into conversion_targets`);

  const summary = await pool.query(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE intent_score >= 100)::int AS hot,
            MAX(total_calls)::int AS top_calls
     FROM conversion_targets`
  );
  console.log('conversion_targets summary:', summary.rows[0]);
}

main()
  .then(() => pool.end())
  .catch((e) => { console.error('ERROR:', e.message); pool.end().finally(() => process.exit(1)); });
