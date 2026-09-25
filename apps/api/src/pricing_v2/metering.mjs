// UU metering for Trading Intelligence (SATELINK_USAGE_LIMITS_V2_ENABLED).
//
// Runs INSIDE the CONSOLE_ACCOUNTS_V1 metering transaction (limits.mjs) for a
// key linked to an account, before the crypto-credit deduction. Order:
//   1. plan allowance — both windows must have room:
//        session: rolling `session_hours` (5h)   · weekly: calendar week in the
//        account's timezone (Monday 00:00)
//   2. pack UU balance (Dodo-funded, never expires)
//   3. crypto credits — returned as { bucket: 'credits' } so the caller runs its
//      unchanged conditional deduction (only if credit auto-use is on)
//   4. hard stop → 402 with the actions the user can take.
// Atomic per account: pg_advisory_xact_lock(account) serialises this account's
// concurrent requests for the rest of the transaction, so window sums cannot be
// read stale and both windows are enforced exactly under concurrency. Other
// accounts are unaffected.
//
// Dodo money reaches Trading Intelligence only (payments boundary): this is
// called for product === 'intelligence' and nothing else.
import { loadCatalog } from './catalog.mjs';
import { ensurePricingV2Schema } from './schema.mjs';

export function isUsageLimitsV2Enabled() {
  return process.env.SATELINK_USAGE_LIMITS_V2_ENABLED === 'true';
}

const FREE_FALLBACK = (c) => c.plans.find((p) => p.id === 'free');

/**
 * @returns {Promise<
 *   {covered:true, bucket:'plan'|'pack', uu:number, usage:object}
 * | {covered:false, bucket:'credits', uu:number, usage:object}
 * | {covered:false, stop:true, code:'usage_limit_reached', http:402, ...}>}
 */
export async function meterIntelligence(client, { accountId, apiKeyId, tz = 'UTC', creditAutoUse = true, catalog = loadCatalog() }) {
  await ensurePricingV2Schema(client);
  const uu = catalog.meters.intelligence_request.uu;
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['pv2:' + accountId]);

  const ent = (await client.query(
    `SELECT plan_id, session_uu, weekly_uu, status FROM pv2_entitlements WHERE account_id = $1`, [accountId]
  )).rows[0];
  const free = FREE_FALLBACK(catalog);
  const active = ent && ent.status === 'active';
  const planId = active ? ent.plan_id : 'free';
  const sessionCap = active ? ent.session_uu : free.allowance.session_uu;
  const weeklyCap = active ? ent.weekly_uu : free.allowance.weekly_uu;

  const w = (await client.query(
    `SELECT
       COALESCE(SUM(uu) FILTER (WHERE created_at > NOW() - make_interval(hours => $2)), 0)::int AS session_used,
       COALESCE(SUM(uu) FILTER (WHERE created_at >= (date_trunc('week', NOW() AT TIME ZONE $3) AT TIME ZONE $3)), 0)::int AS weekly_used,
       MIN(created_at) FILTER (WHERE created_at > NOW() - make_interval(hours => $2)) AS session_oldest,
       (date_trunc('week', NOW() AT TIME ZONE $3) AT TIME ZONE $3) + interval '7 days' AS week_resets
       FROM pv2_usage_ledger
      WHERE account_id = $1 AND bucket = 'plan'
        AND created_at > LEAST(NOW() - make_interval(hours => $2), (date_trunc('week', NOW() AT TIME ZONE $3) AT TIME ZONE $3))`,
    [accountId, catalog.windows.session_hours, tz]
  )).rows[0];

  const usage = {
    planId,
    session: { used: w.session_used, cap: sessionCap, resetsAt: w.session_oldest ? new Date(new Date(w.session_oldest).getTime() + catalog.windows.session_hours * 3600e3).toISOString() : null },
    weekly: { used: w.weekly_used, cap: weeklyCap, resetsAt: new Date(w.week_resets).toISOString() },
  };

  const ledger = (bucket, credits = 0) => client.query(
    `INSERT INTO pv2_usage_ledger (account_id, api_key_id, meter, native_units, uu, pricing_version, bucket, credits_usdt)
     VALUES ($1, $2, 'intelligence_request', 1, $3, $4, $5, $6)`,
    [accountId, apiKeyId, uu, catalog.version, bucket, credits]
  );

  if (w.session_used + uu <= sessionCap && w.weekly_used + uu <= weeklyCap) {
    await ledger('plan');
    const th = catalog.notify_thresholds_pct || [];
    const notices = [
      ...crossedThresholds(w.session_used, w.session_used + uu, sessionCap, th).map((t) => ['session', usage.session.resetsAt || 'rolling', t]),
      ...crossedThresholds(w.weekly_used, w.weekly_used + uu, weeklyCap, th).map((t) => ['weekly', usage.weekly.resetsAt, t]),
    ];
    for (const [win, key, t] of notices) {
      // Recorded once per window/threshold; the notifier job sends them.
      await client.query(
        'INSERT INTO pv2_usage_notices (account_id, win, window_key, threshold) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
        [accountId, win, String(key), t]
      );
    }
    usage.session.used += uu;
    usage.weekly.used += uu;
    return { covered: true, bucket: 'plan', uu, usage, notices: notices.map(([win, , t]) => ({ win, threshold: t })) };
  }

  const pack = await client.query(
    `UPDATE pv2_pack_balances SET uu_balance = uu_balance - $2, updated_at = NOW()
      WHERE account_id = $1 AND uu_balance >= $2 RETURNING uu_balance`,
    [accountId, uu]
  );
  if (pack.rowCount) {
    await ledger('pack');
    return { covered: true, bucket: 'pack', uu, usage, packBalanceUu: Number(pack.rows[0].uu_balance) };
  }

  if (creditAutoUse) {
    // The caller records the ledger row after its credit deduction commits.
    return { covered: false, bucket: 'credits', uu, usage, recordCredits: (usdt) => ledger('credits', usdt) };
  }

  const limited = w.session_used + uu > sessionCap ? 'session' : 'weekly';
  return {
    covered: false,
    stop: true,
    terminal: true,
    code: 'usage_limit_reached',
    http: 402,
    window: limited,
    usage,
    message: limited === 'session'
      ? `You've used this session's allowance. It frees up by ${usage.session.resetsAt}.`
      : `You've used this week's allowance. It resets ${usage.weekly.resetsAt}.`,
    actions: [
      { action: 'wait', until: limited === 'session' ? usage.session.resetsAt : usage.weekly.resetsAt },
      { action: 'enable_credits', note: 'Turn on credit auto-use to continue on prepaid credits.' },
      { action: 'upgrade', plans: ['pro', 'max'].filter((p) => p !== planId) },
    ],
  };
}

/** Thresholds crossed by this consumption (for 70/85/95/100% notices). */
export function crossedThresholds(before, after, cap, thresholds) {
  if (!cap) return [];
  return thresholds.filter((t) => (before / cap) * 100 < t && (after / cap) * 100 >= t);
}
