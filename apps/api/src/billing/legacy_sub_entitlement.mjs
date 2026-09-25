// fix/legacy-dodo-subscription-bucket — Dodo payments boundary on the LEGACY
// webhook (/internal/dodo/credit): money received through Dodo for a
// SUBSCRIPTION is Trading-Intelligence value only. It grants the plan's monthly
// included-call bucket (plan_entitlements, consumed before credits, TI only) —
// never fungible api_credits.credits_usdt that could pay for RPC / x402.
// One-time credit packs keep today's behaviour until Pricing V2 replaces them.
//
// Every grant is recorded against the payment (dodo_subscription_grants) so a
// refund / dispute reverses the ENTITLEMENT it created, not unrelated credits.
import { TIER_DAILY_LIMIT } from './credit_service.mjs';
import { SUB_PLAN_MAP, nextPeriodEnd } from '../plans/entitlement_service.mjs';

export const GRANTS_DDL = `
  CREATE TABLE IF NOT EXISTS dodo_subscription_grants (
    tx_hash          TEXT PRIMARY KEY,               -- the payment_sources idempotency key
    subscription_id  TEXT,
    api_key          TEXT        NOT NULL,
    plan_id          TEXT        NOT NULL,
    included_calls   INTEGER     NOT NULL,
    period_start     TIMESTAMPTZ NOT NULL,
    period_end       TIMESTAMPTZ NOT NULL,
    status           TEXT        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'revoked')),
    suspended_calls  INTEGER,
    granted_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS dodo_subscription_grants_sub ON dodo_subscription_grants (subscription_id);
`;

const PLAN_TIER = { starter: 'basic', pro: 'pro' };

/**
 * Founder-controlled rollout flag (default OFF). OFF = today's behaviour
 * exactly: renewals credit api_credits, first subscription payments are
 * refused unless allowlisted, and metering never draws a plan bucket.
 */
export function isLegacySubBucketEnabled() {
  return process.env.DODO_LEGACY_SUB_BUCKET_ENABLED === 'true';
}

/** A configured Dodo SUBSCRIPTION product (env, founder-set) — not a pack. */
export function isSubscriptionProduct(productId) {
  if (!productId) return false;
  return productId === process.env.DODO_PRODUCT_PRO_ID || productId === process.env.DODO_PRODUCT_STARTER_ID;
}

/** Does this entitling event pay for a subscription (vs a one-time pack)? */
export function isSubscriptionPayment({ eventType, subscriptionId, planProductId }) {
  return eventType === 'subscription.renewed' || Boolean(subscriptionId) || isSubscriptionProduct(planProductId);
}

export async function tableExists(client, name) {
  const r = await client.query('SELECT to_regclass($1) AS t', [name]);
  return Boolean(r.rows[0]?.t);
}

/**
 * Grant (or renew) the plan bucket for a subscription payment, in the caller's
 * transaction. Resets the period allowance (a new paid period), records the
 * grant against the payment, and lifts the key's rate-limit tier — no credits.
 */
export async function grantSubscriptionBucket(client, { apiKey, plan, txHash, subscriptionId, periodStart, periodEnd }) {
  await client.query(GRANTS_DDL);
  const planId = SUB_PLAN_MAP[plan] || 'pro';
  const p = await client.query('SELECT included_calls FROM plans WHERE id = $1', [planId]);
  if (!p.rows[0]) throw Object.assign(new Error(`plan ${planId} missing from plans catalogue`), { code: 'plan_missing' });
  const included = Number(p.rows[0].included_calls);
  const start = periodStart ? new Date(periodStart) : new Date();
  const end = periodEnd ? new Date(periodEnd) : nextPeriodEnd(start);
  await client.query(
    `INSERT INTO plan_entitlements (api_key, plan_id, source, included_calls_total, included_calls_used, period_start, period_end, updated_at)
     VALUES ($1, $2, 'plan', $3, 0, $4, $5, now())
     ON CONFLICT (api_key) DO UPDATE SET plan_id = EXCLUDED.plan_id, source = 'plan',
       included_calls_total = EXCLUDED.included_calls_total, included_calls_used = 0,
       period_start = EXCLUDED.period_start, period_end = EXCLUDED.period_end, updated_at = now()`,
    [apiKey, planId, included, start, end]
  );
  await client.query(
    `INSERT INTO dodo_subscription_grants (tx_hash, subscription_id, api_key, plan_id, included_calls, period_start, period_end)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [txHash, subscriptionId || null, apiKey, planId, included, start, end]
  );
  // Rate-limit tier only (feature access stays broad). No money moves.
  const tier = PLAN_TIER[plan] || 'basic';
  await client.query(
    `UPDATE api_credits SET tier = $2, daily_limit = GREATEST(COALESCE(daily_limit, 0), $3) WHERE api_key = $1`,
    [apiKey, tier, TIER_DAILY_LIMIT[tier]]
  );
  return { planId, includedCalls: included, periodEnd: end };
}

/** Renewal identity fallback: the account a subscription's earlier grant funded. */
export async function accountForSubscription(client, subscriptionId) {
  if (!subscriptionId || !(await tableExists(client, 'dodo_subscription_grants'))) return null;
  const r = await client.query(
    `SELECT api_key FROM dodo_subscription_grants WHERE subscription_id = $1 ORDER BY granted_at DESC LIMIT 1`,
    [subscriptionId]
  );
  return r.rows[0]?.api_key ?? null;
}

/** The grant a Dodo payment created, if it was a subscription payment. */
export async function grantForPayment(client, paymentId) {
  if (!paymentId || !(await tableExists(client, 'dodo_subscription_grants'))) return null;
  const r = await client.query(`SELECT * FROM dodo_subscription_grants WHERE tx_hash = $1 FOR UPDATE`, [`dodo:${paymentId}`]);
  return r.rows[0] ?? null;
}

/** Refund / lost dispute: the bucket this payment granted is withdrawn (calls
 *  already used stay used; nothing further can be drawn this period). */
export async function revokeGrant(client, grant) {
  await client.query(
    `UPDATE plan_entitlements SET included_calls_total = included_calls_used, updated_at = now()
      WHERE api_key = $1 AND period_start = $2`,
    [grant.api_key, grant.period_start]
  );
  await client.query(`UPDATE dodo_subscription_grants SET status = 'revoked', updated_at = now() WHERE tx_hash = $1`, [grant.tx_hash]);
}

/** Dispute opened: pause the bucket (remember what was left). */
export async function suspendGrant(client, grant) {
  const cur = await client.query(
    `SELECT included_calls_total - included_calls_used AS left FROM plan_entitlements WHERE api_key = $1 AND period_start = $2 FOR UPDATE`,
    [grant.api_key, grant.period_start]
  );
  const left = Math.max(0, Number(cur.rows[0]?.left ?? 0));
  await client.query(
    `UPDATE plan_entitlements SET included_calls_total = included_calls_used, updated_at = now() WHERE api_key = $1 AND period_start = $2`,
    [grant.api_key, grant.period_start]
  );
  await client.query(`UPDATE dodo_subscription_grants SET status = 'suspended', suspended_calls = $2, updated_at = now() WHERE tx_hash = $1`, [grant.tx_hash, left]);
  return left;
}

/** Dispute won / cancelled: give back what was paused. */
export async function restoreGrant(client, grant) {
  const left = Number(grant.suspended_calls ?? 0);
  if (left > 0) {
    await client.query(
      `UPDATE plan_entitlements SET included_calls_total = included_calls_used + $3, updated_at = now()
        WHERE api_key = $1 AND period_start = $2`,
      [grant.api_key, grant.period_start, left]
    );
  }
  await client.query(`UPDATE dodo_subscription_grants SET status = 'active', suspended_calls = NULL, updated_at = now() WHERE tx_hash = $1`, [grant.tx_hash]);
  return left;
}

/**
 * Metering: draw ONE Trading-Intelligence call from a paid plan bucket.
 * Atomic (conditional UPDATE); only source='plan' rows in their period.
 */
export async function consumePlanBucket(pool, apiKey) {
  const r = await pool.query(
    `UPDATE plan_entitlements SET included_calls_used = included_calls_used + 1, updated_at = now()
      WHERE api_key = $1 AND source = 'plan' AND period_end > now()
        AND included_calls_total - included_calls_used >= 1
      RETURNING included_calls_total - included_calls_used AS remaining`,
    [apiKey]
  );
  return r.rowCount ? { consumed: true, remaining: Number(r.rows[0].remaining) } : { consumed: false };
}

/** Compensation: give back one call drawn by consumePlanBucket when the call
 *  is then refused (owner controls). Never goes below zero. */
export async function returnPlanBucketCall(pool, apiKey) {
  await pool.query(
    `UPDATE plan_entitlements SET included_calls_used = included_calls_used - 1, updated_at = now()
      WHERE api_key = $1 AND source = 'plan' AND included_calls_used > 0`,
    [apiKey]
  );
}
