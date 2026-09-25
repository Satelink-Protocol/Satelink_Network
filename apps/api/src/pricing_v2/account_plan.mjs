// What the console shows under Billing / "See what I've spent": current plan,
// both UU windows, pack balance, recent consumption by bucket.
import { loadCatalog } from './catalog.mjs';
import { ensurePricingV2Schema } from './schema.mjs';

export async function accountPlan(pool, accountId, { tz = 'UTC', catalog = loadCatalog() } = {}) {
  await ensurePricingV2Schema(pool);
  const ent = (await pool.query('SELECT * FROM pv2_entitlements WHERE account_id = $1', [accountId])).rows[0];
  const free = catalog.plans.find((p) => p.id === 'free');
  const active = ent?.status === 'active';
  const w = (await pool.query(
    `SELECT
       COALESCE(SUM(uu) FILTER (WHERE bucket = 'plan' AND created_at > NOW() - make_interval(hours => $2)), 0)::int AS session_used,
       COALESCE(SUM(uu) FILTER (WHERE bucket = 'plan' AND created_at >= (date_trunc('week', NOW() AT TIME ZONE $3) AT TIME ZONE $3)), 0)::int AS weekly_used,
       MIN(created_at) FILTER (WHERE bucket = 'plan' AND created_at > NOW() - make_interval(hours => $2)) AS session_oldest,
       (date_trunc('week', NOW() AT TIME ZONE $3) AT TIME ZONE $3) + interval '7 days' AS week_resets,
       COALESCE(SUM(uu) FILTER (WHERE bucket = 'pack' AND created_at >= date_trunc('month', NOW())), 0)::int AS pack_month,
       COALESCE(SUM(credits_usdt) FILTER (WHERE bucket = 'credits' AND created_at >= date_trunc('month', NOW())), 0) AS credits_month
       FROM pv2_usage_ledger WHERE account_id = $1`,
    [accountId, catalog.windows.session_hours, tz]
  )).rows[0];
  const pack = (await pool.query('SELECT uu_balance FROM pv2_pack_balances WHERE account_id = $1', [accountId])).rows[0];
  const sub = (await pool.query(`SELECT plan_id, status, current_period_end, intro FROM pv2_subscriptions WHERE account_id = $1 ORDER BY updated_at DESC LIMIT 1`, [accountId])).rows[0];
  return {
    catalogVersion: catalog.version,
    plan: { id: active ? ent.plan_id : 'free', status: ent?.status ?? 'free', periodEnd: ent?.period_end ?? null },
    subscription: sub ? { planId: sub.plan_id, status: sub.status, renewsAt: sub.current_period_end, intro: sub.intro } : null,
    windows: {
      session: { usedUu: w.session_used, capUu: active ? ent.session_uu : free.allowance.session_uu, hours: catalog.windows.session_hours, resetsAt: w.session_oldest ? new Date(new Date(w.session_oldest).getTime() + catalog.windows.session_hours * 3600e3) : null },
      weekly: { usedUu: w.weekly_used, capUu: active ? ent.weekly_uu : free.allowance.weekly_uu, resetsAt: w.week_resets, timezone: tz },
    },
    packBalanceUu: Number(pack?.uu_balance ?? 0),
    thisMonth: { packUu: w.pack_month, creditsUsdt: Number(w.credits_month) },
  };
}
