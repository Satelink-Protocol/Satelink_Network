#!/usr/bin/env node
// machine_crm.js — CLI wrapper around src/reports/machine_crm_core.js
//
// READ-ONLY Machine CRM. One lifecycle record per machine, machine-readable
// JSON only (no frontend, no dashboard, no writes to prod tables). The build
// logic lives in ../src/reports/machine_crm_core.js and is shared with the
// hourly cron (admin/cron_scheduler.js).
//
// Usage:
//   DATABASE_URL=postgres://... node scripts/machine_crm.js
//   RUN_EVERY_HOUR=1 node scripts/machine_crm.js         # loop, one snapshot/hour
//   REPORT_DIR=/path node scripts/machine_crm.js          # output dir (default ./reports)
//
// Schedule hourly (standalone): 0 * * * * cd apps/api && node scripts/machine_crm.js
// (In production the cron is wired in-process via ADMIN_CRONS_ENABLED — this CLI
//  is for ad-hoc/local snapshots and writes to files rather than the DB.)

import pg from 'pg';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildMachineCrm } from '../src/reports/machine_crm_core.js';

const CONN = process.env.DATABASE_URL || process.env.DATABASE_PUBLIC_URL || process.env.PG_URL;
if (!CONN) { console.error('FATAL: set DATABASE_URL (or DATABASE_PUBLIC_URL).'); process.exit(1); }
const REPORT_DIR = process.env.REPORT_DIR || path.resolve(process.cwd(), 'reports');
const needSsl = /sslmode=require/.test(CONN) || /proxy\.rlwy\.net|railway/.test(CONN);

async function runOnce() {
  const client = new pg.Client({ connectionString: CONN, ssl: needSsl ? { rejectUnauthorized: false } : undefined, statement_timeout: 30_000 });
  await client.connect();
  await client.query('SET default_transaction_read_only = on'); // belt-and-suspenders: never write
  try {
    const dbHost = (CONN.match(/@([^:/]+)/) || [])[1] || 'unknown';
    const report = await buildMachineCrm(client, Date.now(), { db_host: dbHost, source: 'cli' });
    await mkdir(REPORT_DIR, { recursive: true });
    const stamp = report._meta.generated_at.slice(0, 13).replace(/[:T]/g, '-');
    const json = JSON.stringify(report, null, 2);
    await writeFile(path.join(REPORT_DIR, `machine_crm_${stamp}.json`), json);
    await writeFile(path.join(REPORT_DIR, 'machine_crm_latest.json'), json);
    const s = report.summary;
    console.error(`[machine_crm] ${s.machines} machines | active ${s.active} at_risk ${s.at_risk} dormant ${s.dormant} dead ${s.dead} | recurring ${s.recurring_machines} (external-real ${s.recurring_external_real})`);
    return report;
  } finally { await client.end(); }
}

async function main() {
  await runOnce();
  if (process.env.RUN_EVERY_HOUR === '1' || process.argv.includes('--loop')) {
    setInterval(() => runOnce().catch((e) => console.error('[machine_crm] run failed:', e.message)), 60 * 60 * 1000);
    console.error('[machine_crm] loop mode: regenerating every hour');
  }
}

main().catch((e) => { console.error('[machine_crm] FATAL:', e.message); process.exit(1); });
