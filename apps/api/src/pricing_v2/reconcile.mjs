// Daily reconciliation: Dodo payments (API) vs pv2_payments vs revenue events
// vs entitlements / pack grants. Read-only on Dodo; writes one report row.
// Mismatch kinds:
//   missing_locally       Dodo has a succeeded V2 payment we never recorded
//   missing_in_dodo       we recorded a payment Dodo does not list
//   amount_mismatch       amounts differ
//   missing_revenue       no revenue_events_v2 row for a recorded payment
//   missing_grant         plan payment without an entitlement row / pack without a grant
import { dodoRequest } from './dodo_client.mjs';
import { dodoMode } from './webhooks.mjs';
import { ensurePricingV2Schema } from './schema.mjs';

async function dodoPayments(mode, request, { maxPages = 20 } = {}) {
  const out = [];
  for (let page = 0; page < maxPages; page++) {
    const r = await request(mode, 'GET', `/payments?page_size=100&page_number=${page}`);
    const items = r?.items || [];
    out.push(...items);
    if (items.length < 100) break;
  }
  return out.filter((p) => p?.metadata?.satelink_checkout === 'v2');
}

export async function reconcilePricingV2(pool, { mode = dodoMode(), request = dodoRequest } = {}) {
  await ensurePricingV2Schema(pool);
  const remote = await dodoPayments(mode, request);
  const local = (await pool.query(`SELECT * FROM pv2_payments WHERE kind = 'payment' AND mode = $1`, [mode])).rows;
  const localById = new Map(local.map((p) => [p.dodo_id, p]));
  const remoteIds = new Set();
  const mismatches = [];
  for (const p of remote) {
    if (p.status !== 'succeeded') continue;
    remoteIds.add(p.payment_id);
    const l = localById.get(p.payment_id);
    if (!l) { mismatches.push({ kind: 'missing_locally', payment_id: p.payment_id }); continue; }
    if (Number(l.amount_minor) !== Number(p.total_amount)) mismatches.push({ kind: 'amount_mismatch', payment_id: p.payment_id, dodo: p.total_amount, local: Number(l.amount_minor) });
  }
  for (const l of local) {
    if (!remoteIds.has(l.dodo_id)) mismatches.push({ kind: 'missing_in_dodo', payment_id: l.dodo_id });
    const rev = await pool.query('SELECT 1 FROM revenue_events_v2 WHERE request_id = $1', [`dodo:v2:${l.dodo_id}`]);
    if (!rev.rowCount) mismatches.push({ kind: 'missing_revenue', payment_id: l.dodo_id });
    const isPack = l.item_id?.startsWith('pack_');
    const g = isPack
      ? await pool.query('SELECT 1 FROM pv2_pack_grants WHERE dodo_payment_id = $1', [l.dodo_id])
      : await pool.query('SELECT 1 FROM pv2_entitlements WHERE account_id = $1', [l.account_id]);
    if (!g.rowCount) mismatches.push({ kind: 'missing_grant', payment_id: l.dodo_id });
  }
  const run = await pool.query(
    'INSERT INTO pv2_reconciliation_runs (mode, dodo_count, local_count, mismatches) VALUES ($1, $2, $3, $4) RETURNING id, ran_at',
    [mode, remoteIds.size, local.length, JSON.stringify(mismatches)]
  );
  return { runId: Number(run.rows[0].id), ranAt: run.rows[0].ran_at, mode, dodoCount: remoteIds.size, localCount: local.length, mismatches };
}

/** Daily loop (flag-gated by the caller). Never throws into the process. */
export function startPricingReconcile(pool, { intervalMs = 24 * 3600e3, logger = console } = {}) {
  const tick = async () => {
    try {
      const r = await reconcilePricingV2(pool);
      if (r.mismatches.length) logger.warn?.(`[pricing-v2] reconciliation ${r.runId}: ${r.mismatches.length} mismatch(es)`);
    } catch (err) {
      logger.error?.('[pricing-v2] reconciliation failed:', err.message);
    }
  };
  const t = setInterval(tick, intervalMs);
  t.unref?.();
  setTimeout(tick, 60_000).unref?.();
  return () => clearInterval(t);
}
