// Track B (P6) — GET /v1/console/summary. A read-only summary for the customer
// console Home, computed from EXISTING tables (api_credits, subscriptions,
// plan_entitlements). Additive and best-effort: any field whose source table is
// unavailable degrades to null so the console shows a designed empty state
// rather than erroring (never "—"). Auth: the caller's own API key.
import express from 'express';
import { resolveAccount } from '../billing/credit_service.mjs';
import { getEntitlement } from '../plans/entitlement_service.mjs';

function apiKeyFromReq(req) {
  const auth = req.header('authorization') || '';
  if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  return (req.header('x-api-key') || '').trim();
}

async function safe(fn, fallback = null) {
  try { return await fn(); } catch { return fallback; }
}

export function createConsoleRouter(pool) {
  const router = express.Router();

  router.get('/console/summary', async (req, res) => {
    const apiKey = apiKeyFromReq(req);
    if (!apiKey) return res.status(401).json({ ok: false, error: 'api_key_required' });

    const account = await safe(() => resolveAccount(pool, { apiKey }));
    if (!account) return res.status(401).json({ ok: false, error: 'invalid_api_key' });

    const balanceUsd = Number(account.credits_usdt ?? 0);

    const entitlement = await safe(() => getEntitlement(pool, apiKey));

    const subscription = await safe(async () => {
      const r = await pool.query(
        `SELECT plan, status, current_period_end FROM subscriptions
          WHERE api_key = $1 AND provider = 'dodo' ORDER BY updated_at DESC LIMIT 1`,
        [apiKey]
      );
      if (!r.rows[0]) return null;
      return { plan: r.rows[0].plan, status: r.rows[0].status, currentPeriodEnd: r.rows[0].current_period_end };
    });

    // Usage today / month from api_usage_daily (best-effort; null if unavailable).
    const usage = await safe(async () => {
      const today = await pool.query(
        `SELECT COALESCE(SUM(request_count),0) AS n FROM api_usage_daily
          WHERE api_key = $1 AND date = CURRENT_DATE`,
        [apiKey]
      );
      const month = await pool.query(
        `SELECT COALESCE(SUM(request_count),0) AS n FROM api_usage_daily
          WHERE api_key = $1 AND date >= date_trunc('month', CURRENT_DATE)::date`,
        [apiKey]
      );
      return { callsToday: Number(today.rows[0].n), callsThisMonth: Number(month.rows[0].n) };
    });

    res.json({
      ok: true,
      data: {
        apiKey: `${apiKey.slice(0, 7)}…`,
        balanceUsd,
        tier: account.tier ?? null,
        plan: subscription?.plan ?? 'free',
        subscription,           // null when none
        entitlement,            // null when none (Dodo bucket)
        usage,                  // null when unavailable
      },
    });
  });

  return router;
}
