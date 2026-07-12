/**
 * Admin Command Center cron scheduler.
 *
 * Corrected vs the original design doc:
 *   - Takes (pool, redis); jobs use the pg Pool directly.
 *   - DROPPED the original "signer-monitor" cron. The repo already runs
 *     gas_manager_job.js (server.js step 12b3, PR #130) which watches the
 *     settlement signer's POL balance and posts Discord alerts when low.
 *     A second monitor would just double every alert.
 *   - Note: conversion_monitor_job.js (step 12b1b, PR #131) already posts
 *     Discord alerts for warm conversion leads from /system/free-tier. The
 *     outreach cron here only queues follow-ups for leads already marked
 *     'contacted' in developer_intel — it does not re-alert.
 *
 * Started from server.js only when ADMIN_CRONS_ENABLED=1, so deploying this
 * code does not silently start background ip-api lookups / Discord posts.
 */

import cron from 'node-cron';
import { IpClassifier }         from './jobs/ip_classifier.js';
import { CustomerZeroDetector } from './jobs/customer_zero_detector.js';
import { OutreachEngine }       from './jobs/outreach_engine.js';
import { evaluatePricing }      from '../economics/pricing_intelligence/index.js';
import { buildMachineCrm }      from '../reports/machine_crm_core.js';

// Additive, dedicated table — the only write this cron makes. Never touches
// existing tables. Idempotent; safe to call before every snapshot insert.
const CRM_SNAPSHOT_DDL = `
  CREATE TABLE IF NOT EXISTS machine_crm_snapshots (
    id           bigserial PRIMARY KEY,
    generated_at timestamptz NOT NULL DEFAULT now(),
    summary      jsonb NOT NULL,
    machines     jsonb NOT NULL
  )`;

export function startAdminCrons(pool, redis) {
  // IP classification — every 15 minutes
  cron.schedule('*/15 * * * *', async () => {
    try { console.log('[CRON] ip-classifier:', await new IpClassifier(pool, redis).run()); }
    catch (e) { console.error('[CRON] ip-classifier ERROR:', e.message); }
  });

  // Customer Zero detector — every 5 minutes
  cron.schedule('*/5 * * * *', async () => {
    try {
      const r = await new CustomerZeroDetector(pool).run();
      if (r.found) console.log('[CRON] customer-zero: FOUND', r);
    } catch (e) { console.error('[CRON] customer-zero ERROR:', e.message); }
  });

  // Outreach follow-ups — every 6 hours
  cron.schedule('0 */6 * * *', async () => {
    try { console.log('[CRON] outreach:', await new OutreachEngine(pool).run()); }
    catch (e) { console.error('[CRON] outreach ERROR:', e.message); }
  });

  // Pricing intelligence — every 6 hours, offset from outreach. Advisory only:
  // records a floor-clamped recommendation in pricing_decisions; never touches
  // billing (see docs/PRICING_INTELLIGENCE.md).
  cron.schedule('30 */6 * * *', async () => {
    try {
      const d = await evaluatePricing(pool, redis);
      console.log(`[CRON] pricing-intel: ${d.action} → $${d.recommended_price_usd} (${d.reason})`);
    } catch (e) { console.error('[CRON] pricing-intel ERROR:', e.message); }
  });

  // Machine CRM snapshot — top of every hour. Persists one lifecycle snapshot
  // (summary + per-machine records) to machine_crm_snapshots. Read-heavy build
  // + a single INSERT into its own additive table; no existing table touched.
  cron.schedule('0 * * * *', async () => {
    try {
      await pool.query(CRM_SNAPSHOT_DDL);
      const report = await buildMachineCrm(pool, Date.now(), { source: 'cron' });
      await pool.query(
        `INSERT INTO machine_crm_snapshots (generated_at, summary, machines) VALUES (now(), $1, $2)`,
        [report.summary, JSON.stringify(report.machines)]
      );
      const s = report.summary;
      console.log(`[CRON] machine-crm: ${s.machines} machines (active ${s.active}, at_risk ${s.at_risk}, dormant ${s.dormant}, dead ${s.dead}); recurring-external-real ${s.recurring_external_real}`);
    } catch (e) { console.error('[CRON] machine-crm ERROR:', e.message); }
  });

  console.log('[ADMIN] Crons started: ip-classifier(15m), customer-zero(5m), outreach(6h), pricing-intel(6h), machine-crm(1h)');
}
