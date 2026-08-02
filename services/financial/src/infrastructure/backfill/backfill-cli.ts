/**
 * Backfill CLI entry.
 *
 *   dry-run (default):  node backfill-cli.js
 *   apply:              node backfill-cli.js --apply
 *
 * Reads DATABASE_URL from the environment. DRY-RUN is the default; writes happen
 * ONLY with the explicit --apply flag. Never run this against production.
 */

import { Pool } from 'pg';
import { runBackfill } from './backfill-principals.js';

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL is required');
    process.exitCode = 1;
    return;
  }

  const pool = new Pool({ connectionString });
  try {
    const report = await runBackfill(pool, { apply });
    console.log(JSON.stringify({ mode: apply ? 'APPLY' : 'DRY-RUN', ...report }, null, 2));
  } finally {
    await pool.end();
  }
}

void main();
