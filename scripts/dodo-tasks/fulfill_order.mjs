#!/usr/bin/env node
// scripts/dodo-tasks/fulfill_order.mjs
//
// Manual fulfillment for the "500 Verified Local Business Leads" task-commerce
// product. Run by hand, once per paid order — deliberately NOT automated
// (fine for the first 10 orders per the product plan). Standalone script,
// separate from apps/api and apps/web's runtime — its own DB connection,
// touches ONLY the task_orders table.
//
// Usage:
//   node scripts/dodo-tasks/fulfill_order.mjs <order_ref>
//   node scripts/dodo-tasks/fulfill_order.mjs --list        (list paid, unfulfilled orders)
//
// Required env: DATABASE_URL, APIFY_ACCESS_TOKEN, BREVO_API_KEY
// Optional env: APIFY_ACTOR_ID (default compass~crawler-google-places)
//
// Actor input field names (searchStringsArray, locationQuery,
// maxCrawledPlacesPerSearch) were fetched from the actor's LIVE input schema
// via the Apify API before this script was written — not assumed. See the
// commit message / chat history for the schema dump.

import pg from 'pg';

const DATABASE_URL = process.env.DATABASE_URL;
const APIFY_ACCESS_TOKEN = process.env.APIFY_ACCESS_TOKEN;
const APIFY_ACTOR_ID = process.env.APIFY_ACTOR_ID || 'compass~crawler-google-places';
const BREVO_API_KEY = process.env.BREVO_API_KEY;
const RESULTS_CAP = 500;
const POLL_INTERVAL_MS = 10_000;
const MAX_WAIT_MS = 20 * 60 * 1000; // 20 minutes — 500 places can take a while

function requireEnv() {
  const missing = [];
  if (!DATABASE_URL) missing.push('DATABASE_URL');
  if (!APIFY_ACCESS_TOKEN) missing.push('APIFY_ACCESS_TOKEN');
  if (!BREVO_API_KEY) missing.push('BREVO_API_KEY');
  if (missing.length) {
    console.error(`Missing required env: ${missing.join(', ')}`);
    process.exit(1);
  }
}

async function main() {
  requireEnv();
  const orderRef = process.argv[2];

  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();

  try {
    if (!orderRef || orderRef === '--list') {
      const { rows } = await client.query(
        `SELECT order_ref, city, category, buyer_email, paid_at
           FROM task_orders WHERE status = 'paid' ORDER BY paid_at ASC`
      );
      if (!rows.length) {
        console.log('No paid, unfulfilled orders.');
      } else {
        console.log('Paid, unfulfilled orders:');
        for (const r of rows) {
          console.log(`  ${r.order_ref}  city="${r.city}" category="${r.category}" email=${r.buyer_email} paid_at=${r.paid_at}`);
        }
        console.log('\nRun: node scripts/dodo-tasks/fulfill_order.mjs <order_ref>');
      }
      return;
    }

    const { rows } = await client.query(`SELECT * FROM task_orders WHERE order_ref = $1`, [orderRef]);
    const order = rows[0];
    if (!order) {
      console.error(`No task_orders row for order_ref=${orderRef}`);
      process.exitCode = 1;
      return;
    }
    if (order.status !== 'paid') {
      console.error(`Order ${orderRef} has status="${order.status}", expected "paid". Refusing to run.`);
      process.exitCode = 1;
      return;
    }

    console.log(`Fulfilling order ${orderRef}: city="${order.city}" category="${order.category}" -> ${order.buyer_email}`);

    // ── 1. Start the Apify run ────────────────────────────────────────────
    const input = {
      searchStringsArray: [order.category],
      locationQuery: order.city,
      maxCrawledPlacesPerSearch: RESULTS_CAP,
    };
    console.log('Starting Apify run with input:', JSON.stringify(input));
    const startRes = await fetch(
      `https://api.apify.com/v2/acts/${APIFY_ACTOR_ID}/runs?token=${APIFY_ACCESS_TOKEN}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }
    );
    if (!startRes.ok) {
      const body = await startRes.text().catch(() => '');
      throw new Error(`Apify run start failed: HTTP ${startRes.status} ${body.slice(0, 300)}`);
    }
    const startData = (await startRes.json()).data;
    const runId = startData.id;
    console.log(`Run started: ${runId} (status=${startData.status})`);

    // ── 2. Poll until terminal ──────────────────────────────────────────
    const terminal = new Set(['SUCCEEDED', 'FAILED', 'TIMED-OUT', 'ABORTED']);
    const deadline = Date.now() + MAX_WAIT_MS;
    let run = startData;
    while (!terminal.has(run.status)) {
      if (Date.now() > deadline) {
        throw new Error(`Run ${runId} did not finish within ${MAX_WAIT_MS / 60000} minutes (last status=${run.status}). Check the Apify console.`);
      }
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      const pollRes = await fetch(`https://api.apify.com/v2/actor-runs/${runId}?token=${APIFY_ACCESS_TOKEN}`);
      if (!pollRes.ok) throw new Error(`Apify run poll failed: HTTP ${pollRes.status}`);
      run = (await pollRes.json()).data;
      console.log(`  ... status=${run.status}`);
    }

    if (run.status !== 'SUCCEEDED') {
      throw new Error(`Run ${runId} finished with status=${run.status}, not SUCCEEDED. Order left as "paid" for retry.`);
    }
    console.log(`Run succeeded. Dataset: ${run.defaultDatasetId}`);

    // ── 3. Fetch results as CSV — let Apify derive columns from whatever ──
    //    the actor actually produced, instead of guessing output field names.
    const csvRes = await fetch(
      `https://api.apify.com/v2/datasets/${run.defaultDatasetId}/items?token=${APIFY_ACCESS_TOKEN}&format=csv`
    );
    if (!csvRes.ok) throw new Error(`Dataset fetch failed: HTTP ${csvRes.status}`);
    const csv = await csvRes.text();
    const rowCount = Math.max(0, csv.trim().split('\n').length - 1); // minus header
    console.log(`Fetched ${rowCount} leads.`);

    // ── 4. Email via Brevo (same REST pattern as apps/api/src/admin/email.js) ──
    const csvBase64 = Buffer.from(csv, 'utf8').toString('base64');
    const emailRes = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': BREVO_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sender: { email: 'tasks@satelink.network', name: 'Satelink Tasks' },
        to: [{ email: order.buyer_email }],
        subject: `Your ${rowCount} leads: ${order.category} in ${order.city}`,
        htmlContent:
          `<p>Your order is ready — ${rowCount} verified leads for <b>${escapeHtml(order.category)}</b> in <b>${escapeHtml(order.city)}</b>.</p>` +
          `<p>The full list is attached as a CSV.</p>` +
          `<p>— Satelink Tasks</p>`,
        attachment: [{ content: csvBase64, name: 'leads.csv' }],
      }),
    });
    if (!emailRes.ok) {
      const body = await emailRes.text().catch(() => '');
      throw new Error(`Brevo send failed: HTTP ${emailRes.status} ${body.slice(0, 300)}`);
    }
    console.log(`Email sent to ${order.buyer_email}.`);

    // ── 5. Mark fulfilled ────────────────────────────────────────────────
    await client.query(
      `UPDATE task_orders SET status = 'fulfilled', apify_run_id = $2, fulfilled_at = now(), updated_at = now()
        WHERE order_ref = $1`,
      [orderRef, runId]
    );
    console.log(`Order ${orderRef} marked fulfilled.`);
  } finally {
    await client.end();
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

main().catch((err) => {
  console.error('FATAL:', err.message);
  process.exit(1);
});
