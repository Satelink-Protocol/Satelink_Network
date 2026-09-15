#!/usr/bin/env -S npx tsx
/**
 * sat-db — Sanctioned DB runner for Satelink production database.
 * Executes SQL query passed on STDIN or as argument 1 using Railway variables.
 * Never logs or echoes credentials.
 *
 * Usage:
 *   railway run --service Postgres-iQeW npx tsx scripts/ops/sat-db.ts "SELECT count(*) FROM authorizations"
 *   echo "SELECT 1" | railway run --service Postgres-iQeW npx tsx scripts/ops/sat-db.ts
 */
import { Pool } from 'pg';

async function main() {
  let query = process.argv[2]?.trim();
  if (!query) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
    query = Buffer.concat(chunks).toString('utf8').trim();
  }

  if (!query) {
    console.error('ERROR: No SQL query provided as argument or STDIN.');
    process.exit(1);
  }

  const pass = process.env.POSTGRES_PASSWORD;
  const user = process.env.POSTGRES_USER || 'postgres';
  const host = process.env.RAILWAY_TCP_PROXY_DOMAIN || 'roundhouse.proxy.rlwy.net';
  const port = process.env.RAILWAY_TCP_PROXY_PORT || '21238';
  const db = process.env.POSTGRES_DB || 'railway';

  if (!pass) {
    console.error('ERROR: POSTGRES_PASSWORD is not set in environment.');
    process.exit(1);
  }

  const connectionString = `postgresql://${user}:${encodeURIComponent(pass)}@${host}:${port}/${db}`;
  const pool = new Pool({ connectionString });
  try {
    const res = await pool.query(query);
    process.stdout.write(JSON.stringify(res.rows, null, 2) + '\n');
  } catch (err: any) {
    console.error(`DB Error: ${err.message}`);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
