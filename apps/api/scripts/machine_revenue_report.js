#!/usr/bin/env node
// machine_revenue_report.js
//
// READ-ONLY hourly machine-revenue reporter. Emits machine-readable JSON only —
// no frontend, no dashboard, no writes to production tables (SELECT-only).
//
// Usage:
//   DATABASE_URL=postgres://... node scripts/machine_revenue_report.js
//   RUN_EVERY_HOUR=1 node scripts/machine_revenue_report.js      # loop, one report/hour
//   REPORT_DIR=/path node scripts/machine_revenue_report.js       # output dir (default ./reports)
//
// Schedule hourly with cron:  0 * * * * cd apps/api && node scripts/machine_revenue_report.js
//
// Schema notes (verified against prod 2026-07-12):
//   * revenue_events_v2.created_at is epoch SECONDS (bigint) -> to_timestamp(created_at).
//   * There is NO dedicated partner / integration / SDK column. Each requested
//     dimension is mapped to the closest persisted signal and labelled in _meta.
//     `revenue_by_sdk` is not instrumented yet -> emitted with data_available:false.
//   * KPI is EXTERNAL REAL revenue: everything is split real (is_test_data=false)
//     vs test (founder). Recurring = a machine with >= 2 top-up deposits.

import pg from 'pg';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const CONN =
  process.env.DATABASE_URL ||
  process.env.DATABASE_PUBLIC_URL ||
  process.env.PG_URL;

if (!CONN) {
  console.error('FATAL: set DATABASE_URL (or DATABASE_PUBLIC_URL).');
  process.exit(1);
}

const REPORT_DIR = process.env.REPORT_DIR || path.resolve(process.cwd(), 'reports');
const needSsl = /sslmode=require/.test(CONN) || /proxy\.rlwy\.net|railway/.test(CONN);

function n(v) {
  // numeric -> Number, null-safe, 6dp
  return v == null ? 0 : Math.round(Number(v) * 1e6) / 1e6;
}

async function q(client, text, params = []) {
  const { rows } = await client.query(text, params);
  return rows;
}

// Split a grouped revenue query into total/real/test per bucket.
function shape(rows, keyField) {
  return rows.map((r) => ({
    [keyField]: r[keyField] ?? 'unknown',
    total_usdt: n(r.total_usdt),
    real_usdt: n(r.real_usdt),
    test_usdt: n(r.test_usdt),
    events: Number(r.events || 0),
  }));
}

async function build(client) {
  // ── Counters ─────────────────────────────────────────────────────────────
  const [counts] = await q(
    client,
    `SELECT
        count(*)                                            AS machines_discovered,
        count(*) FILTER (WHERE wallet_address IS NOT NULL)  AS named_api_keys,
        count(*) FILTER (WHERE wallet_address IS NULL)      AS anonymous_keys,
        count(DISTINCT lower(wallet_address))               AS distinct_wallets,
        coalesce(sum(total_deposited),0)                    AS credits_purchased_usdt,
        coalesce(sum(total_spent),0)                        AS credits_consumed_usdt,
        coalesce(sum(credits_usdt),0)                       AS credits_outstanding_usdt
     FROM api_credits`
  );

  // ── Deposits: purchases + top-up counts ──────────────────────────────────
  const [dep] = await q(
    client,
    `SELECT count(*)                       AS deposit_txs,
            coalesce(sum(amount_usdt),0)   AS deposited_usdt,
            count(DISTINCT api_key)        AS wallets_with_deposit
     FROM api_deposits`
  );
  const topupRows = await q(
    client,
    `SELECT api_key, count(*) AS topups, coalesce(sum(amount_usdt),0) AS deposited_usdt
     FROM api_deposits GROUP BY api_key`
  );
  const second_topups = topupRows.filter((r) => Number(r.topups) >= 2).length;
  const recurring_by_topups = topupRows
    .filter((r) => Number(r.topups) >= 2)
    .map((r) => ({ api_key: r.api_key, topups: Number(r.topups), deposited_usdt: n(r.deposited_usdt) }));

  // ── Per-machine activity (days active, real/test spend) ───────────────────
  const machineRows = await q(
    client,
    `SELECT client_id,
            count(*)                                                          AS events,
            count(DISTINCT date(to_timestamp(created_at)))                    AS days_active,
            min(to_timestamp(created_at))                                     AS first_seen,
            max(to_timestamp(created_at))                                     AS last_seen,
            coalesce(sum(amount_usdt),0)                                      AS total_usdt,
            coalesce(sum(amount_usdt) FILTER (WHERE is_test_data IS NOT TRUE),0) AS real_usdt,
            coalesce(sum(amount_usdt) FILTER (WHERE is_test_data IS TRUE),0)     AS test_usdt
     FROM revenue_events_v2
     GROUP BY client_id
     ORDER BY real_usdt DESC, total_usdt DESC`
  );
  const revenue_by_machine = machineRows.map((r) => ({
    machine: r.client_id,
    events: Number(r.events),
    days_active: Number(r.days_active),
    first_seen: r.first_seen,
    last_seen: r.last_seen,
    total_usdt: n(r.total_usdt),
    real_usdt: n(r.real_usdt),
    test_usdt: n(r.test_usdt),
  }));

  const recurring_by_usage = revenue_by_machine.filter(
    (m) => m.days_active >= 2 && m.real_usdt > 0
  ).length;
  const active_paying_machines_real = revenue_by_machine.filter((m) => m.real_usdt > 0).length;

  // ── Revenue by SOURCE (serving rail / upstream) ───────────────────────────
  const bySource = await q(
    client,
    `SELECT coalesce(source,'unknown') AS source,
            coalesce(sum(amount_usdt),0) AS total_usdt,
            coalesce(sum(amount_usdt) FILTER (WHERE is_test_data IS NOT TRUE),0) AS real_usdt,
            coalesce(sum(amount_usdt) FILTER (WHERE is_test_data IS TRUE),0) AS test_usdt,
            count(*) AS events
     FROM revenue_events_v2 GROUP BY source ORDER BY total_usdt DESC`
  );

  // ── Revenue by INTEGRATION (demand channel on the event) ──────────────────
  const byIntegration = await q(
    client,
    `SELECT coalesce(demand_source,'unknown') AS integration,
            coalesce(sum(amount_usdt),0) AS total_usdt,
            coalesce(sum(amount_usdt) FILTER (WHERE is_test_data IS NOT TRUE),0) AS real_usdt,
            coalesce(sum(amount_usdt) FILTER (WHERE is_test_data IS TRUE),0) AS test_usdt,
            count(*) AS events
     FROM revenue_events_v2 GROUP BY demand_source ORDER BY total_usdt DESC`
  );

  // ── Revenue by PARTNER (acquisition channel from api_credits.demand_source) ─
  // Resolve each revenue event's machine to its api_credits row (by api_key or
  // wallet_address), then group by that machine's demand_source = "partner".
  const byPartner = await q(
    client,
    `SELECT coalesce(ac.demand_source,'unattributed') AS partner,
            coalesce(sum(re.amount_usdt),0) AS total_usdt,
            coalesce(sum(re.amount_usdt) FILTER (WHERE re.is_test_data IS NOT TRUE),0) AS real_usdt,
            coalesce(sum(re.amount_usdt) FILTER (WHERE re.is_test_data IS TRUE),0) AS test_usdt,
            count(*) AS events
     FROM revenue_events_v2 re
     LEFT JOIN api_credits ac
       ON ac.api_key = re.client_id
       OR lower(ac.wallet_address) = lower(re.client_id)
     GROUP BY ac.demand_source ORDER BY total_usdt DESC`
  );

  // ── KPI: external real recurring revenue ──────────────────────────────────
  const recurringKeys = new Set(recurring_by_topups.map((r) => r.api_key));
  const external_recurring_revenue_usdt = n(
    revenue_by_machine
      .filter((m) => recurringKeys.has(m.machine))
      .reduce((s, m) => s + m.real_usdt, 0)
  );

  const totalReal = n(revenue_by_machine.reduce((s, m) => s + m.real_usdt, 0));
  const totalTest = n(revenue_by_machine.reduce((s, m) => s + m.test_usdt, 0));

  return {
    _meta: {
      report: 'machine_revenue_report',
      version: 1,
      generated_at: new Date().toISOString(),
      db_host: (CONN.match(/@([^:/]+)/) || [])[1] || 'unknown',
      read_only: true,
      notes: {
        created_at_unit: 'epoch_seconds',
        kpi: 'external real (non-founder) recurring revenue; recurring = machine with >= 2 top-up deposits',
      },
      dimension_sources: {
        revenue_by_source: 'revenue_events_v2.source (serving rail / upstream)',
        revenue_by_integration: 'revenue_events_v2.demand_source (per-event demand channel: direct/x402/...)',
        revenue_by_partner: 'api_credits.demand_source resolved via client_id -> api_key/wallet (acquisition partner)',
        revenue_by_sdk: 'NOT INSTRUMENTED — no SDK dimension persisted in revenue_events_v2/api_credits',
        revenue_by_machine: 'revenue_events_v2.client_id',
      },
    },

    kpi: {
      external_recurring_revenue_usdt,
      active_paying_machines_real,
      recurring_machines: recurring_by_topups.length,
      total_real_revenue_usdt: totalReal,
      total_test_revenue_usdt: totalTest,
    },

    machines_discovered: Number(counts.machines_discovered),
    named_api_keys: Number(counts.named_api_keys),
    anonymous_keys: Number(counts.anonymous_keys),
    distinct_wallets: Number(counts.distinct_wallets),

    credits_purchased_usdt: n(counts.credits_purchased_usdt),
    credits_purchased_deposit_txs: Number(dep.deposit_txs),
    credits_purchased_onchain_usdt: n(dep.deposited_usdt),
    credits_consumed_usdt: n(counts.credits_consumed_usdt),
    credits_outstanding_usdt: n(counts.credits_outstanding_usdt),

    days_active: {
      machines_active_1d_plus: revenue_by_machine.filter((m) => m.days_active >= 1).length,
      machines_active_2d_plus: revenue_by_machine.filter((m) => m.days_active >= 2).length,
      machines_active_7d_plus: revenue_by_machine.filter((m) => m.days_active >= 7).length,
      max_days_active: revenue_by_machine.reduce((mx, m) => Math.max(mx, m.days_active), 0),
    },

    second_topups,
    recurring_machines: {
      by_second_topup: recurring_by_topups.length,
      by_multi_day_usage: recurring_by_usage,
      detail: recurring_by_topups,
    },

    revenue_by_partner: shape(byPartner, 'partner'),
    revenue_by_integration: shape(byIntegration, 'integration'),
    revenue_by_sdk: {
      data_available: false,
      note: 'No SDK attribution is persisted. Populate this block once X-Satelink-SDK / SDK analytics are written to revenue_events_v2 or a dedicated table.',
      rows: [],
    },
    revenue_by_source: shape(bySource, 'source'),
    revenue_by_machine,
  };
}

async function runOnce() {
  const client = new pg.Client({
    connectionString: CONN,
    ssl: needSsl ? { rejectUnauthorized: false } : undefined,
    statement_timeout: 30_000,
  });
  await client.connect();
  // Belt-and-suspenders: this session may not write.
  await client.query('SET default_transaction_read_only = on');
  try {
    const report = await build(client);
    await mkdir(REPORT_DIR, { recursive: true });
    const hourStamp = report._meta.generated_at.slice(0, 13).replace(/[:T]/g, '-'); // YYYY-MM-DD-HH
    const file = path.join(REPORT_DIR, `machine_revenue_${hourStamp}.json`);
    const json = JSON.stringify(report, null, 2);
    await writeFile(file, json);
    await writeFile(path.join(REPORT_DIR, 'latest.json'), json);
    console.error(
      `[machine_revenue_report] wrote ${file} | external_recurring=$${report.kpi.external_recurring_revenue_usdt} ` +
        `active_paying=${report.kpi.active_paying_machines_real} recurring=${report.kpi.recurring_machines}`
    );
    return report;
  } finally {
    await client.end();
  }
}

async function main() {
  await runOnce();
  if (process.env.RUN_EVERY_HOUR === '1' || process.argv.includes('--loop')) {
    const HOUR = 60 * 60 * 1000;
    setInterval(() => {
      runOnce().catch((e) => console.error('[machine_revenue_report] run failed:', e.message));
    }, HOUR);
    console.error('[machine_revenue_report] loop mode: regenerating every hour');
  }
}

main().catch((e) => {
  console.error('[machine_revenue_report] FATAL:', e.message);
  process.exit(1);
});
