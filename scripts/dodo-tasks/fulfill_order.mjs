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
// Required env: DATABASE_URL, APIFY_ACCESS_TOKEN, BREVO_API_KEY, OPERATOR_ALERT_EMAIL
// Optional env: APIFY_ACTOR_ID (default compass~crawler-google-places)
//
// Actor input field names (searchStringsArray, locationQuery,
// maxCrawledPlacesPerSearch) were fetched from the actor's LIVE input schema
// via the Apify API before this script was written — not assumed.
//
// Failure handling (an order here has ALREADY been paid ₹499 — nothing fails
// silently on the customer):
//   - Apify run fails/times out/aborts, OR succeeds with zero results ->
//     status=failed, operator alerted (email), customer told it failed and a
//     refund is coming. Refund EXECUTION is manual, via Dodo's dashboard —
//     see REFUND_RUNBOOK.md — then run mark_refunded.mjs.
//   - Fewer than RESULTS_CAP results (thin city/category) -> DEFINED policy:
//     always deliver whatever was found (never withhold), customer email
//     says so plainly. If the shortfall is >10%, the operator ALSO gets a
//     separate alert suggesting a proportional partial refund — amount is a
//     suggestion, the operator decides and executes via Dodo's dashboard.
//   - Brevo send fails -> retried up to 3x with backoff. Still failing ->
//     operator alerted (best-effort — if Brevo itself is down this may also
//     fail, hence the loud console.error as a floor), order stays "paid"
//     (NOT marked fulfilled) for a manual retry later. Known limitation: a
//     later manual retry re-runs the Apify search rather than reusing the
//     first run's results — acceptable given this class of failure (Apify
//     succeeded AND Brevo down for an extended period) should be rare; not
//     solved here to avoid scope creep beyond what was asked.
//   - Same order run twice -> the top-level status guard below only proceeds
//     on status="paid", so an already-fulfilled/failed order refuses to
//     re-run (no double Apify spend, no double email). Webhook-side double
//     delivery of the SAME payment is a separate, already-handled path — see
//     markOrderPaid()'s dodo_payment_id idempotency check in apps/web.

import pg from 'pg';

const DATABASE_URL = process.env.DATABASE_URL;
const APIFY_ACCESS_TOKEN = process.env.APIFY_ACCESS_TOKEN;
const APIFY_ACTOR_ID = process.env.APIFY_ACTOR_ID || 'compass~crawler-google-places';
const BREVO_API_KEY = process.env.BREVO_API_KEY;
const OPERATOR_ALERT_EMAIL = process.env.OPERATOR_ALERT_EMAIL;
const RESULTS_CAP = 500;
const PRICE_INR = 499;
const PARTIAL_ALERT_THRESHOLD = 0.9; // alert operator if delivered < 90% of the cap
const POLL_INTERVAL_MS = 10_000;
const MAX_WAIT_MS = 20 * 60 * 1000; // 20 minutes — 500 places can take a while
const EMAIL_RETRY_DELAYS_MS = [2000, 5000, 10000]; // 3 attempts total

function requireEnv() {
  const missing = [];
  if (!DATABASE_URL) missing.push('DATABASE_URL');
  if (!APIFY_ACCESS_TOKEN) missing.push('APIFY_ACCESS_TOKEN');
  if (!BREVO_API_KEY) missing.push('BREVO_API_KEY');
  if (!OPERATOR_ALERT_EMAIL) missing.push('OPERATOR_ALERT_EMAIL');
  if (missing.length) {
    console.error(`Missing required env: ${missing.join(', ')}`);
    process.exit(1);
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Single-attempt raw send — throws on failure, otherwise returns Brevo's
// messageId (a concrete, checkable artifact — not just "no error was thrown").
async function sendBrevoEmail({ to, subject, html, attachment }) {
  const body = {
    sender: { email: 'tasks@satelink.network', name: 'Satelink Tasks' },
    to: [{ email: to }],
    subject,
    htmlContent: html,
  };
  if (attachment) body.attachment = attachment;

  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': BREVO_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`Brevo send failed: HTTP ${res.status} ${errBody.slice(0, 300)}`);
  }
  const data = await res.json().catch(() => ({}));
  return data.messageId;
}

// Retries the SAME send up to 3 times with backoff. Throws only after the
// final attempt fails. Logs the messageId explicitly on success.
async function sendBrevoEmailWithRetry(params) {
  let lastErr;
  for (let attempt = 1; attempt <= EMAIL_RETRY_DELAYS_MS.length + 1; attempt++) {
    try {
      const messageId = await sendBrevoEmail(params);
      console.log(`  email accepted by Brevo: to=${params.to} messageId=${messageId}`);
      return messageId;
    } catch (err) {
      lastErr = err;
      console.warn(`  email attempt ${attempt}/${EMAIL_RETRY_DELAYS_MS.length + 1} to ${params.to} failed: ${err.message}`);
      const delay = EMAIL_RETRY_DELAYS_MS[attempt - 1];
      if (delay) await sleep(delay);
    }
  }
  throw lastErr;
}

// Best-effort — never throws (a failed alert must not crash the script or
// mask the original failure). Always logs loudly regardless, as a floor.
async function alertOperator(subject, html) {
  console.error(`[OPERATOR ALERT] ${subject}`);
  try {
    const messageId = await sendBrevoEmail({ to: OPERATOR_ALERT_EMAIL, subject: `[Task Order] ${subject}`, html });
    console.log(`  operator alert accepted by Brevo: to=${OPERATOR_ALERT_EMAIL} messageId=${messageId}`);
  } catch (err) {
    console.error(`  (also failed to send this as an email — Brevo may be down: ${err.message})`);
  }
}

async function markFailed(client, orderRef, reason) {
  await client.query(`UPDATE task_orders SET status = 'failed', updated_at = now() WHERE order_ref = $1`, [orderRef]);
  console.error(`Order ${orderRef} marked FAILED: ${reason}`);
}

async function notifyCustomerOfFailure(order) {
  await sendBrevoEmailWithRetry({
    to: order.buyer_email,
    subject: `Your order for ${order.category} in ${order.city} could not be completed`,
    html:
      `<p>We're sorry — we were unable to complete your order for <b>${escapeHtml(order.category)}</b> leads in <b>${escapeHtml(order.city)}</b>.</p>` +
      `<p>A full refund of your ₹${PRICE_INR} payment is on its way and will be processed shortly.</p>` +
      `<p>If you have questions, just reply to this email.</p>` +
      `<p>— Satelink Tasks</p>`,
  });
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

    // ── 1+2+3. Start the Apify run, poll to a terminal status, fetch the
    //    dataset. All three in one try/catch: a truly empty dataset isn't a
    //    200-with-empty-CSV as might be assumed — Apify's items?format=csv
    //    returns HTTP 400 { error.type: "no-columns-in-exported-dataset" }
    //    when there are zero rows (confirmed empirically, not assumed —
    //    the first version of this script treated this as an uncaught crash
    //    before that was caught in testing). Detected below and routed to
    //    the SAME "zero results" messaging as an empty-but-200 response
    //    would have gotten, via the isZeroResults tag on the thrown error.
    let run;
    let csv;
    try {
      const input = {
        searchStringsArray: [order.category],
        locationQuery: order.city,
        maxCrawledPlacesPerSearch: RESULTS_CAP,
      };
      console.log('Starting Apify run with input:', JSON.stringify(input));
      const startRes = await fetch(
        `https://api.apify.com/v2/acts/${APIFY_ACTOR_ID}/runs?token=${APIFY_ACCESS_TOKEN}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }
      );
      if (!startRes.ok) {
        const body = await startRes.text().catch(() => '');
        throw new Error(`Apify run start failed: HTTP ${startRes.status} ${body.slice(0, 300)}`);
      }
      run = (await startRes.json()).data;
      console.log(`Run started: ${run.id} (status=${run.status})`);

      const terminal = new Set(['SUCCEEDED', 'FAILED', 'TIMED-OUT', 'ABORTED']);
      const deadline = Date.now() + MAX_WAIT_MS;
      while (!terminal.has(run.status)) {
        if (Date.now() > deadline) {
          throw new Error(`Run ${run.id} did not finish within ${MAX_WAIT_MS / 60000} minutes (last status=${run.status}). Check the Apify console.`);
        }
        await sleep(POLL_INTERVAL_MS);
        const pollRes = await fetch(`https://api.apify.com/v2/actor-runs/${run.id}?token=${APIFY_ACCESS_TOKEN}`);
        if (!pollRes.ok) throw new Error(`Apify run poll failed: HTTP ${pollRes.status}`);
        run = (await pollRes.json()).data;
        console.log(`  ... status=${run.status}`);
      }
      if (run.status !== 'SUCCEEDED') {
        throw new Error(`Run ${run.id} finished with status=${run.status}, not SUCCEEDED.`);
      }
      console.log(`Run succeeded. Dataset: ${run.defaultDatasetId}`);

      // Fetch results as CSV — let Apify derive columns from whatever the
      // actor actually produced, instead of guessing output field names.
      const csvRes = await fetch(
        `https://api.apify.com/v2/datasets/${run.defaultDatasetId}/items?token=${APIFY_ACCESS_TOKEN}&format=csv`
      );
      if (!csvRes.ok) {
        const body = await csvRes.text().catch(() => '');
        let parsedType;
        try { parsedType = JSON.parse(body)?.error?.type; } catch { /* not JSON */ }
        if (csvRes.status === 400 && parsedType === 'no-columns-in-exported-dataset') {
          const zeroErr = new Error('Apify run succeeded but returned zero results');
          zeroErr.isZeroResults = true;
          throw zeroErr;
        }
        throw new Error(`Dataset fetch failed: HTTP ${csvRes.status} ${body.slice(0, 300)}`);
      }
      csv = await csvRes.text();
    } catch (err) {
      const isZeroResults = err.isZeroResults === true;
      await markFailed(client, orderRef, err.message);
      await alertOperator(
        isZeroResults ? `Order FAILED (zero results): ${orderRef}` : `Order FAILED (Apify): ${orderRef}`,
        `<p>city="${escapeHtml(order.city)}" category="${escapeHtml(order.category)}" buyer=${escapeHtml(order.buyer_email)}</p>` +
          `<p>Reason: ${escapeHtml(err.message)}` +
          (isZeroResults ? ' — check whether the city/category combination is valid.' : '') +
          `</p>` +
          `<p>Needs a manual refund via the Dodo dashboard, then run: node scripts/dodo-tasks/mark_refunded.mjs ${orderRef}</p>`
      );
      await notifyCustomerOfFailure(order).catch((e) =>
        console.error(`Also failed to notify the customer: ${e.message}`)
      );
      process.exitCode = 1;
      return;
    }
    const apifyCostUsd = typeof run.usageTotalUsd === 'number' ? run.usageTotalUsd : null;
    const rowCount = Math.max(0, csv.trim().split('\n').length - 1); // minus header
    console.log(`Fetched ${rowCount} leads.`);

    // ── 4. Email via Brevo (retried) ────────────────────────────────────
    const isPartial = rowCount < RESULTS_CAP;
    const isSignificantShortfall = rowCount < RESULTS_CAP * PARTIAL_ALERT_THRESHOLD;
    const csvBase64 = Buffer.from(csv, 'utf8').toString('base64');
    const subject = isPartial
      ? `Your ${rowCount} leads: ${order.category} in ${order.city} (fewer than 500 found)`
      : `Your ${rowCount} leads: ${order.category} in ${order.city}`;
    const partialNote = isPartial
      ? `<p>We found <b>${rowCount}</b> businesses matching this search — fewer than the usual 500, because ` +
        `"${escapeHtml(order.category)}" in "${escapeHtml(order.city)}" is a smaller market than most. ` +
        `This is everything real that matches; we don't pad the list with unrelated results.</p>`
      : '';
    const html =
      `<p>Your order is ready — ${rowCount} verified leads for <b>${escapeHtml(order.category)}</b> in <b>${escapeHtml(order.city)}</b>.</p>` +
      partialNote +
      `<p>The full list is attached as a CSV.</p>` +
      `<p>— Satelink Tasks</p>`;

    try {
      await sendBrevoEmailWithRetry({
        to: order.buyer_email,
        subject,
        html,
        attachment: [{ content: csvBase64, name: 'leads.csv' }],
      });
    } catch (err) {
      // A3 — Brevo send failed after retries. Order stays "paid", NOT fulfilled.
      console.error(`Email delivery FAILED after retries: ${err.message}`);
      await alertOperator(
        `Order ${orderRef}: Apify succeeded (${rowCount} leads) but EMAIL DELIVERY FAILED`,
        `<p>buyer=${escapeHtml(order.buyer_email)} — retry by re-running: node scripts/dodo-tasks/fulfill_order.mjs ${orderRef}</p>` +
          `<p>Order is still "paid", not marked fulfilled. Last error: ${escapeHtml(err.message)}</p>`
      );
      process.exitCode = 1;
      return;
    }
    console.log(`Email sent to ${order.buyer_email}.`);

    // ── 5. Mark fulfilled — only reached once delivery actually succeeded ──
    await client.query(
      `UPDATE task_orders
          SET status = 'fulfilled', apify_run_id = $2, apify_cost_usd = $3, fulfilled_at = now(), updated_at = now()
        WHERE order_ref = $1`,
      [orderRef, run.id, apifyCostUsd]
    );
    console.log(`Order ${orderRef} marked fulfilled.`);

    // ── A2 — significant shortfall: flag for a possible partial refund ────
    if (isSignificantShortfall) {
      const suggestedRefund = (PRICE_INR * (1 - rowCount / RESULTS_CAP)).toFixed(2);
      await alertOperator(
        `Order ${orderRef}: partial delivery (${rowCount}/${RESULTS_CAP}) — consider a partial refund`,
        `<p>city="${escapeHtml(order.city)}" category="${escapeHtml(order.category)}" buyer=${escapeHtml(order.buyer_email)}</p>` +
          `<p>Delivered ${rowCount} of ${RESULTS_CAP} (${Math.round((rowCount / RESULTS_CAP) * 100)}%). Suggested proportional partial refund: ~₹${suggestedRefund}.</p>` +
          `<p>This is a suggestion, not automatic — decide via the Dodo dashboard, then run: ` +
          `node scripts/dodo-tasks/mark_refunded.mjs ${orderRef} (only if you actually issue one).</p>`
      );
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('FATAL:', err.message);
  process.exit(1);
});
