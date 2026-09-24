// Track B (P3.B) — the entitlement "Dodo bucket": a monthly included-call
// allowance consumed BEFORE credits, spendable ONLY on Trading Intelligence.
//
// IMPORTANT (money-path safety): this module does NOT modify the existing
// billing path (credit_service.authorizeAndMeter) or the existing Dodo webhook
// (internal_dodo.js), and it never writes to api_credits / revenue_events_v2.
// `consumeEntitlement` is the single integration point the serving path MAY call
// (guarded by PLANS_ENABLED) in a later, founder-approved money-path change.
// Until then it is exercised only by tests and the reconcile/reset jobs.
// `reconcileEntitlements` READS the existing `subscriptions` table to grant
// buckets — it does not touch it.

export const FREE_INCLUDED_CALLS = 300;

/** Maps the existing subscriptions.plan tiers → plans catalogue ids.
 *  The existing webhook records 'starter'/'pro'; the catalogue is free/pro/max.
 *  Founder-confirmed 2026-09-23: a Dodo subscription grants the monthly
 *  included-call ENTITLEMENT bucket (Trading Intelligence only, resets
 *  monthly, consumed before credits) — never fungible USD credits. Both
 *  existing subscription tiers map to the 'pro' entitlement bucket until a
 *  dedicated 'max' Dodo product exists. See docs/web/DECISIONS.md. */
export const SUB_PLAN_MAP = { pro: "pro", starter: "pro" };

/** One month after `from`. */
export function nextPeriodEnd(from = new Date()) {
  const d = new Date(from);
  d.setUTCMonth(d.getUTCMonth() + 1);
  return d;
}

/** Bonus-pack credit mapping (§4.5): base USD + bonus%. packId → credited USD.
 *  (packId ← Dodo product id is an env/config concern; founder-set.) */
export const CREDIT_PACKS = {
  starter: { usd: 9.99, bonusPct: 0 },
  "pack-50": { usd: 50, bonusPct: 5 },
  "pack-200": { usd: 200, bonusPct: 10 },
};

export function creditForPack(packId) {
  const p = CREDIT_PACKS[packId];
  if (!p) return null;
  return +(p.usd * (1 + p.bonusPct / 100)).toFixed(6);
}

/** Ensure a Free-tier entitlement exists for an account with no active plan. */
export async function ensureFreeEntitlement(pool, apiKey, now = new Date()) {
  await pool.query(
    `INSERT INTO plan_entitlements (api_key, plan_id, source, included_calls_total, included_calls_used, period_start, period_end, updated_at)
     VALUES ($1, 'free', 'free', $2, 0, $3, $4, now())
     ON CONFLICT (api_key) DO NOTHING`,
    [apiKey, FREE_INCLUDED_CALLS, now, nextPeriodEnd(now)]
  );
}

/** Grant / refresh a plan's monthly allowance for an account. */
export async function grantPlanAllowance(pool, apiKey, planId, includedCalls, periodStart, periodEnd) {
  await pool.query(
    `INSERT INTO plan_entitlements (api_key, plan_id, source, included_calls_total, included_calls_used, period_start, period_end, updated_at)
     VALUES ($1, $2, 'plan', $3, 0, $4, $5, now())
     ON CONFLICT (api_key) DO UPDATE SET
       plan_id = EXCLUDED.plan_id,
       source = 'plan',
       included_calls_total = EXCLUDED.included_calls_total,
       included_calls_used = 0,
       period_start = EXCLUDED.period_start,
       period_end = EXCLUDED.period_end,
       updated_at = now()`,
    [apiKey, planId, includedCalls, periodStart, periodEnd]
  );
}

/** Monthly reset: roll expired periods forward (used → 0, new window,
 *  total from the entitlement's own plan). Idempotent — only touches rows whose
 *  period_end < now. */
export async function resetExpired(pool, now = new Date()) {
  const { rowCount } = await pool.query(
    `UPDATE plan_entitlements e
        SET included_calls_used = 0,
            period_start = $1,
            period_end = $2,
            included_calls_total = COALESCE(
              (SELECT p.included_calls FROM plans p WHERE p.id = e.plan_id), $3),
            updated_at = now()
      WHERE e.period_end < $1`,
    [now, nextPeriodEnd(now), FREE_INCLUDED_CALLS]
  );
  return rowCount;
}

/** Consume `n` calls from the Dodo bucket for a Trading-Intelligence call.
 *  Atomic: only decrements if enough allowance remains in the current period.
 *  Returns { consumed, remaining }. TI-only by contract (RPC/x402 draw from
 *  crypto credits, never this bucket). NOT wired into the live billing path. */
export async function consumeEntitlement(pool, apiKey, n = 1, now = new Date()) {
  const { rows } = await pool.query(
    `UPDATE plan_entitlements
        SET included_calls_used = included_calls_used + $2, updated_at = now()
      WHERE api_key = $1
        AND period_end > $3
        AND included_calls_total - included_calls_used >= $2
      RETURNING included_calls_total - included_calls_used AS remaining`,
    [apiKey, n, now]
  );
  if (rows.length) return { consumed: true, remaining: Number(rows[0].remaining) };
  return { consumed: false, remaining: 0 };
}

/** Read an account's current entitlement (or null). */
export async function getEntitlement(pool, apiKey) {
  const { rows } = await pool.query(
    `SELECT api_key, plan_id, source, included_calls_total, included_calls_used, period_start, period_end
       FROM plan_entitlements WHERE api_key = $1`,
    [apiKey]
  );
  if (!rows.length) return null;
  const r = rows[0];
  return {
    apiKey: r.api_key,
    planId: r.plan_id,
    source: r.source,
    includedCallsTotal: Number(r.included_calls_total),
    includedCallsUsed: Number(r.included_calls_used),
    remaining: Number(r.included_calls_total) - Number(r.included_calls_used),
    periodStart: r.period_start,
    periodEnd: r.period_end,
  };
}

/** Reconcile buckets from the EXISTING subscriptions table (READ-only on it):
 *  every active dodo subscription with a mapped plan gets a current allowance.
 *  Does not modify subscriptions, api_credits, or the webhook. Idempotent. */
export async function reconcileEntitlements(pool, now = new Date()) {
  const { rows } = await pool.query(
    `SELECT api_key, plan, current_period_start, current_period_end
       FROM subscriptions
      WHERE provider = 'dodo' AND status = 'active' AND api_key IS NOT NULL`
  );
  let granted = 0;
  for (const sub of rows) {
    const planId = SUB_PLAN_MAP[sub.plan] || null;
    if (!planId) continue;
    const p = await pool.query(`SELECT included_calls FROM plans WHERE id = $1`, [planId]);
    const included = p.rows[0] ? Number(p.rows[0].included_calls) : 0;
    const start = sub.current_period_start || now;
    const end = sub.current_period_end || nextPeriodEnd(now);
    await grantPlanAllowance(pool, sub.api_key, planId, included, start, end);
    granted += 1;
  }
  return granted;
}
