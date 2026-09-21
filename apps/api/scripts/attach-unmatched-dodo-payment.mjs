#!/usr/bin/env node
// attach-unmatched-dodo-payment.mjs — manual reconciliation for a Dodo
// payment that landed in `unmatched_payments` (T-1.4: the webhook refuses to
// guess which account to credit — see apps/api/src/routes/internal_dodo.js).
//
// This script does NOT write money directly. It reconstructs the same
// request the webhook would have sent and POSTs it to the ALREADY-TESTED
// /internal/dodo/credit endpoint (same idempotency, same allowlist gate,
// same amount computation) with an operator-supplied api_key as the identity
// signal that was missing at delivery time. Only after a successful credit
// does it mark the unmatched_payments row resolved.
//
// Usage:
//   DATABASE_URL=postgres://...             (read the unmatched row, mark it resolved)
//   INTERNAL_API_URL=https://api.satelink.network   (default)
//   DODO_INTERNAL_SECRET=...                (same secret apps/web uses)
//
//   node scripts/attach-unmatched-dodo-payment.mjs \
//     --id 3 --api-key sk_dodo_abc123 --operator founder
//
//   # or resolve/create an account by email instead of an existing key:
//   node scripts/attach-unmatched-dodo-payment.mjs \
//     --id 3 --email buyer@example.com --operator founder
//
//   # list unresolved rows first:
//   node scripts/attach-unmatched-dodo-payment.mjs --list

import pg from 'pg';

const CONN = process.env.DATABASE_URL || process.env.DATABASE_PUBLIC_URL || process.env.PG_URL;
if (!CONN) { console.error('FATAL: set DATABASE_URL (or DATABASE_PUBLIC_URL).'); process.exit(1); }
const INTERNAL_API_URL = process.env.INTERNAL_API_URL || 'https://api.satelink.network';
const SECRET = process.env.DODO_INTERNAL_SECRET;
const needSsl = /sslmode=require/.test(CONN) || /proxy\.rlwy\.net|railway/.test(CONN);

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--list') { out.list = true; continue; }
    if (a.startsWith('--')) {
      const key = a.slice(2);
      out[key] = argv[i + 1];
      i++;
    }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const client = new pg.Client({ connectionString: CONN, ssl: needSsl ? { rejectUnauthorized: false } : undefined, statement_timeout: 30_000 });
  await client.connect();

  try {
    if (args.list) {
      const r = await client.query(
        `SELECT id, event_type, payment_id, product_id, customer_email, currency, amount_minor, reason, created_at
           FROM unmatched_payments WHERE resolved = false ORDER BY created_at DESC LIMIT 50`
      );
      console.table(r.rows);
      return;
    }

    if (!args.id) { console.error('FATAL: --id <unmatched_payments.id> required (or --list)'); process.exitCode = 1; return; }
    if (!args['api-key'] && !args.email) { console.error('FATAL: --api-key or --email required'); process.exitCode = 1; return; }
    if (!args.operator) { console.error('FATAL: --operator <your name> required (audit trail)'); process.exitCode = 1; return; }
    if (!SECRET) { console.error('FATAL: set DODO_INTERNAL_SECRET'); process.exitCode = 1; return; }

    const rowRes = await client.query(`SELECT * FROM unmatched_payments WHERE id = $1`, [Number(args.id)]);
    const row = rowRes.rows[0];
    if (!row) { console.error(`FATAL: no unmatched_payments row with id ${args.id}`); process.exitCode = 1; return; }
    if (row.resolved) { console.error(`FATAL: row ${args.id} is already resolved (api_key ${row.resolved_api_key})`); process.exitCode = 1; return; }

    let apiKey = args['api-key'];
    if (!apiKey) {
      // Resolve-or-create by email — same pre-payment provisioning the
      // checkout route uses. Never guesses an EXISTING account by email; if
      // one already exists for it, reuses it, otherwise provisions fresh.
      const res = await fetch(`${INTERNAL_API_URL}/internal/dodo/resolve-account`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dodo-internal-secret': SECRET },
        body: JSON.stringify({ email: args.email }),
      });
      if (!res.ok) { console.error(`FATAL: resolve-account failed: ${res.status} ${await res.text()}`); process.exitCode = 1; return; }
      const data = await res.json();
      apiKey = data.apiKey;
      console.log(`Resolved account for ${args.email}: ${apiKey}${data.created ? ' (newly created)' : ''}`);
    }

    console.log(`Crediting unmatched payment ${row.payment_id || row.subscription_id} (${row.event_type}) to ${apiKey}...`);

    const creditRes = await fetch(`${INTERNAL_API_URL}/internal/dodo/credit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dodo-internal-secret': SECRET },
      body: JSON.stringify({
        eventType: row.event_type,
        paymentId: row.payment_id,
        subscriptionId: row.subscription_id,
        planProductId: row.product_id,
        customerEmail: row.customer_email,
        apiKeyHint: apiKey,
        currency: row.currency,
        amountMinor: row.amount_minor,
        isTestMode: row.is_test_data,
        metadata: row.metadata,
      }),
    });
    const creditBody = await creditRes.json().catch(() => ({}));
    if (!creditRes.ok) {
      console.error(`FATAL: /internal/dodo/credit returned ${creditRes.status}:`, creditBody);
      process.exitCode = 1;
      return;
    }
    if (creditBody.entitled === false) {
      console.error(`NOT CREDITED — endpoint accepted the request but declined to credit (reason: ${creditBody.reason}). No row marked resolved.`, creditBody);
      process.exitCode = 1;
      return;
    }

    await client.query(
      `UPDATE unmatched_payments SET resolved = true, resolved_api_key = $1, resolved_by = $2, resolved_at = $3 WHERE id = $4`,
      [apiKey, args.operator, Date.now(), row.id]
    );
    console.log(`✅ Credited ${creditBody.creditedUsdt} to ${apiKey}. Row ${row.id} marked resolved by ${args.operator}.`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exitCode = 1;
});
