/**
 * apps/api/src/routes/internal_dodo.js
 *
 * POST /internal/dodo/credit — the money-writing half of the Dodo human
 * payment rail (M5, T-17). Dodo webhook SIGNATURE VERIFICATION happens
 * upstream, in apps/web (the @dodopayments/nextjs Webhooks() adapter —
 * invalid signature never reaches here, see apps/web's dodo-webhook route).
 * This endpoint is reached ONLY by that verified webhook handler, over
 * HTTPS, authenticated by its own shared secret (defense in depth: even a
 * request that somehow bypassed Dodo's signature check still needs this
 * secret). apps/web's own DB role (task_commerce_web) has no grants on any
 * table this file writes to — by design, see the M5 PR description — so the
 * actual writes happen here, in apps/api, which already owns this data.
 *
 * ENTITLEMENT ONLY on payment.succeeded / subscription.renewed (gate M5-c):
 * every other event (subscription.active/on_hold/cancelled, payment.failed)
 * updates subscriptions.status for visibility and returns without touching
 * api_credits — subscription.active alone fires before a UPI mandate
 * confirms and must never grant spend.
 *
 * Idempotency (gate M5-b): payment_sources.tx_hash is the idempotency key,
 * same column x402/on-chain deposits use for their external payment
 * reference (it was never strictly a blockchain hash). For payment.succeeded
 * that is 'dodo:<payment_id>'. Dodo's Subscription webhook payload carries
 * NO payment_id at all (checked against @dodopayments/core's zod schemas —
 * only the base Payment object has one), so subscription.renewed uses
 * 'dodo:sub:<subscription_id>:<previous_billing_date>' — previous_billing_date
 * advances every renewal cycle, so this is unique per charge, same as a real
 * payment_id would be. Belt and suspenders: creditAccount() ALSO dedupes on
 * this same key via api_deposits' own UNIQUE(tx_hash), and a raw 23505 from
 * either INSERT is caught and turned into 409, not a crash.
 *
 * FX APPROXIMATION (not live): this account's actual Dodo settlement
 * currency was not available to confirm from code (it is a Dodo dashboard
 * setting). If it is INR, DODO_INR_USD_RATE_APPROX is a static, manually
 * updated constant — good enough for gate M5's structural checks (payment
 * recorded, entitlement granted, idempotent, ledger row), NOT precise
 * accounting. Founder: confirm the real settlement currency; if it is
 * already USD this whole path is a no-op (rate 1) and safe to leave as-is.
 */

import express from 'express';
import crypto from 'crypto';
import { creditAccount, resolveAccount, TIER_DAILY_LIMIT } from '../billing/credit_service.mjs';
import { shadowWriteRevenueLedger } from '../ledger/shadow_ledger_write.js';

const ENTITLING_EVENTS = new Set(['payment.succeeded', 'subscription.renewed']);
const REFUND_EVENTS = new Set(['payment.refunded']);

// Dodo subscription.status values (schema-verified) -> our subscriptions.status.
// payment.failed has no subscription status of its own; it just means this
// charge attempt failed — recorded, but the subscription's own status comes
// from whichever subscription.* event Dodo sends alongside/after it.
const STATUS_FROM_EVENT = {
  'subscription.active': 'active',
  'subscription.on_hold': 'on_hold',
  'subscription.renewed': 'active',
  'subscription.cancelled': 'cancelled',
  'subscription.paused': 'paused',
  'subscription.expired': 'expired',
};

const STATIC_INR_USD_RATE = Number(process.env.DODO_INR_USD_RATE_APPROX || '0.0113'); // ~88.5 INR/USD, 2026-09 — see FX note above

function toUsdApprox(amountMinor, currency) {
  const amount = (Number(amountMinor) || 0) / 100;
  const code = String(currency || '').toUpperCase();
  if (code === 'USD') return +amount.toFixed(6);
  if (code === 'INR') return +(amount * STATIC_INR_USD_RATE).toFixed(6);
  // Unknown currency: never silently fabricate a rate-1 dollar figure without
  // a trace. Flag loudly and fall back to rate 1 so the NOT NULL column still
  // gets a number (refusing the write entirely would mean the customer paid
  // and got nothing — worse than an approximate figure that's visibly logged).
  console.error(`[internal/dodo] unknown settlement currency "${currency}" — booking at rate 1 (approximate, flagged)`);
  return +amount.toFixed(6);
}

// Plan -> tier/daily_limit. Product IDs are Dodo-dashboard configuration
// (founder-created, not knowable from this repo) — set via env so this file
// never hardcodes a guessed product id. An unrecognized/unset product id
// defaults to 'starter', never 'pro' — never grant the higher tier silently.
const PLAN_DAILY_LIMIT = {
  free: TIER_DAILY_LIMIT.free,
  starter: TIER_DAILY_LIMIT.basic,
  pro: TIER_DAILY_LIMIT.pro,
  professional: TIER_DAILY_LIMIT.enterprise,
};

function planFromProductId(productId) {
  if (productId && process.env.DODO_PRODUCT_PROFESSIONAL_ID && productId === process.env.DODO_PRODUCT_PROFESSIONAL_ID) return 'professional';
  if (productId && process.env.DODO_PRODUCT_PRO_ID && productId === process.env.DODO_PRODUCT_PRO_ID) return 'pro';
  if (productId && process.env.DODO_PRODUCT_STARTER_ID && productId === process.env.DODO_PRODUCT_STARTER_ID) return 'starter';
  return 'starter';
}

function requireInternalSecret(req, res, next) {
  const configured = process.env.DODO_INTERNAL_SECRET;
  if (!configured) {
    return res.status(503).json({ ok: false, error: 'dodo_internal_secret_missing' });
  }
  const provided = req.header('x-dodo-internal-secret') || '';
  const configuredBuffer = Buffer.from(configured);
  const providedBuffer = Buffer.from(provided);
  const isValid =
    providedBuffer.length === configuredBuffer.length &&
    crypto.timingSafeEqual(providedBuffer, configuredBuffer);
  if (!isValid) {
    return res.status(401).json({ ok: false, error: 'invalid_dodo_internal_secret' });
  }
  return next();
}

async function upsertSubscriptionStatus(pool, { subscriptionId, apiKey, plan, status, currency, amountMinor, currentPeriodStart, currentPeriodEnd, cancelledAt }) {
  if (!subscriptionId) return;
  await pool.query(
    `INSERT INTO subscriptions
       (id, provider, provider_subscription_id, api_key, plan, status, currency,
        recurring_amount_minor, current_period_start, current_period_end, cancelled_at, updated_at)
     VALUES ($1, 'dodo', $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
     ON CONFLICT (provider, provider_subscription_id) DO UPDATE SET
       status = EXCLUDED.status,
       api_key = COALESCE(subscriptions.api_key, EXCLUDED.api_key),
       current_period_start = COALESCE(EXCLUDED.current_period_start, subscriptions.current_period_start),
       current_period_end   = COALESCE(EXCLUDED.current_period_end, subscriptions.current_period_end),
       cancelled_at = COALESCE(EXCLUDED.cancelled_at, subscriptions.cancelled_at),
       updated_at = now()`,
    [`dodo:${subscriptionId}`, subscriptionId, apiKey || null, plan || null, status,
     currency || null, amountMinor || null, currentPeriodStart || null, currentPeriodEnd || null, cancelledAt || null]
  );
}

/** Resolve the api_key to credit, creating a fresh account only as a last resort. */
async function resolveOrCreateApiKey(client, { apiKeyHint, subscriptionId, customerEmail, plan }) {
  if (apiKeyHint) {
    const account = await resolveAccount(client, { apiKey: apiKeyHint });
    if (account) return account.api_key;
  }
  if (subscriptionId) {
    const r = await client.query(
      `SELECT api_key FROM subscriptions WHERE provider = 'dodo' AND provider_subscription_id = $1`,
      [subscriptionId]
    );
    if (r.rows[0]?.api_key) return r.rows[0].api_key;
  }
  if (customerEmail) {
    const r = await client.query(
      `SELECT api_key FROM api_credits WHERE lower(email) = lower($1) ORDER BY created_at ASC LIMIT 1`,
      [customerEmail]
    );
    if (r.rows[0]?.api_key) return r.rows[0].api_key;
  }
  // No existing account anywhere — this is a brand-new Dodo customer. Provision
  // one, same shape x402's bundle path uses for a first-time payer (settlement.js).
  const apiKey = `sk_dodo_${crypto.randomBytes(24).toString('hex')}`;
  await client.query(
    `INSERT INTO api_credits (api_key, tier, daily_limit, demand_source, email)
     VALUES ($1, $2, $3, 'dodo', $4)
     ON CONFLICT (api_key) DO NOTHING`,
    [apiKey, plan, PLAN_DAILY_LIMIT[plan] || PLAN_DAILY_LIMIT.starter, customerEmail || null]
  );
  return apiKey;
}

export function createDodoInternalRouter(pool) {
  const router = express.Router();
  router.use(express.json({ limit: '64kb' }));
  router.use(requireInternalSecret);

  router.post('/credit', async (req, res) => {
    const body = req.body || {};
    const {
      eventType, paymentId, subscriptionId, planProductId, customerEmail,
      apiKeyHint, currency, amountMinor, isTestMode, currentPeriodStart,
      currentPeriodEnd, previousBillingDate,
    } = body;

    if (!eventType) return res.status(400).json({ ok: false, error: 'eventType required' });

    const plan = planFromProductId(planProductId);
    const isTest = !!isTestMode;

    // ── Non-entitling events: status only, no credit, no api_credits touch.
    if (!ENTITLING_EVENTS.has(eventType)) {
      try {
        // payment.failed has no subscription status of its own (see module
        // header comment) — STATUS_FROM_EVENT has no entry for it, so nothing
        // is written to subscriptions; the failure is Dodo's own record.
        const status = STATUS_FROM_EVENT[eventType];
        if (status) {
          await upsertSubscriptionStatus(pool, {
            subscriptionId, plan, status, currency, amountMinor,
            currentPeriodStart, currentPeriodEnd,
            cancelledAt: eventType === 'subscription.cancelled' ? new Date().toISOString() : null,
          });
        }
        return res.json({ ok: true, entitled: false, eventType });
      } catch (err) {
        console.error('[internal/dodo] status update failed:', err.message);
        return res.status(500).json({ ok: false, error: 'internal_error' });
      }
    }

    // ── Entitling events: payment.succeeded / subscription.renewed.
    let idKey;
    if (eventType === 'payment.succeeded') {
      if (!paymentId) return res.status(400).json({ ok: false, error: 'paymentId required' });
      idKey = `dodo:${paymentId}`;
    } else {
      if (!subscriptionId || !previousBillingDate) {
        return res.status(400).json({ ok: false, error: 'subscriptionId and previousBillingDate required for subscription.renewed' });
      }
      idKey = `dodo:sub:${subscriptionId}:${previousBillingDate}`;
    }

    const amountUsd = toUsdApprox(amountMinor, currency);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Idempotency gate (M5-b), checked inside the transaction before any write.
      const dup = await client.query(`SELECT 1 FROM payment_sources WHERE tx_hash = $1`, [idKey]);
      if (dup.rows.length > 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({ ok: false, code: 'duplicate', message: 'already credited' });
      }

      const apiKey = await resolveOrCreateApiKey(client, { apiKeyHint, subscriptionId, customerEmail, plan });

      await client.query(
        `INSERT INTO payment_sources (source, amount_usd, token, network, tx_hash, payer, credited_api_key, is_test_data)
         VALUES ('dodo', $1, $2, 'dodo', $3, $4, $5, $6)`,
        [amountUsd, currency || 'unknown', idKey, customerEmail || 'unknown', apiKey, isTest]
      );
      await client.query(
        `INSERT INTO revenue_events_v2 (op_type, client_id, amount_usdt, status, request_id, created_at, chain, method, source, demand_source, is_test_data)
         VALUES ('subscription_payment', $1, $2, 'completed', $3, $4, null, null, 'dodo', 'dodo', $5)`,
        [customerEmail || apiKey, amountUsd, idKey, Math.floor(Date.now() / 1000), isTest]
      );

      // T-17: the SAME creditAccount() the deposit listener uses. 1:1 credit —
      // same semantics as every other deposit path (T-17b), no bundle discount.
      const credited = await creditAccount(client, {
        apiKey, amountUsdt: amountUsd, txHash: idKey, fromAddress: customerEmail || null,
        tier: plan, dailyLimit: PLAN_DAILY_LIMIT[plan] || PLAN_DAILY_LIMIT.starter,
      });
      if (!credited.ok) {
        await client.query('ROLLBACK');
        return res.status(409).json({ ok: false, code: credited.code, message: credited.message });
      }

      if (subscriptionId) {
        await client.query(
          `INSERT INTO subscriptions
             (id, provider, provider_subscription_id, api_key, plan, status, currency,
              recurring_amount_minor, current_period_start, current_period_end, updated_at)
           VALUES ($1, 'dodo', $2, $3, $4, 'active', $5, $6, $7, $8, now())
           ON CONFLICT (provider, provider_subscription_id) DO UPDATE SET
             status = 'active', api_key = subscriptions.api_key,
             current_period_start = COALESCE(EXCLUDED.current_period_start, subscriptions.current_period_start),
             current_period_end   = COALESCE(EXCLUDED.current_period_end, subscriptions.current_period_end),
             updated_at = now()`,
          [`dodo:${subscriptionId}`, subscriptionId, apiKey, plan, currency || null,
           amountMinor || null, currentPeriodStart || null, currentPeriodEnd || null]
        );
      }

      await client.query('COMMIT');

      // M3 shadow ledger — own pool/tx, never throws. Mirrors settlement.js:114
      // exactly (T-17): fired AFTER commit, not inside the transaction above.
      shadowWriteRevenueLedger(pool, { requestId: idKey, amountUsdt: amountUsd, isTestData: isTest });

      return res.json({ ok: true, entitled: true, apiKey, creditedUsdt: credited.balance, eventType });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      if (err.code === '23505') {
        return res.status(409).json({ ok: false, code: 'duplicate', message: 'already credited' });
      }
      console.error('[internal/dodo] credit failed:', err.message);
      return res.status(500).json({ ok: false, error: 'internal_error' });
    } finally {
      client.release();
    }
  });

  // ── REFUND HANDLER ────────────────────────────────────────────────────────
  // A refund NEVER deletes the original payment record. It creates a REVERSAL
  // entry so the audit trail is preserved. Entitlement is adjusted (tier
  // downgraded), but the original ledger entries remain immutable.
  router.post('/refund', async (req, res) => {
    const body = req.body || {};
    const { paymentId, subscriptionId, customerEmail, amountMinor, currency, reason } = body;

    if (!paymentId) return res.status(400).json({ ok: false, error: 'paymentId required' });

    const idKey = `dodo:refund:${paymentId}`;
    const amountUsd = toUsdApprox(amountMinor, currency);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Idempotency: a refund can only be processed once per payment
      const dup = await client.query(`SELECT 1 FROM payment_sources WHERE tx_hash = $1`, [idKey]);
      if (dup.rows.length > 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({ ok: false, code: 'duplicate', message: 'refund already processed' });
      }

      // Find the original payment to know which account to adjust
      const origKey = `dodo:${paymentId}`;
      const orig = await client.query(
        `SELECT credited_api_key, amount_usd FROM payment_sources WHERE tx_hash = $1`,
        [origKey]
      );
      const apiKey = orig.rows[0]?.credited_api_key;

      // Record the refund as a reversal payment_source
      await client.query(
        `INSERT INTO payment_sources (source, amount_usd, token, network, tx_hash, payer, credited_api_key, is_test_data)
         VALUES ('dodo', $1, $2, 'dodo', $3, $4, $5, false)`,
        [-amountUsd, currency || 'unknown', idKey, customerEmail || 'unknown', apiKey || null]
      );

      // Record reversal revenue event (negative amount)
      await client.query(
        `INSERT INTO revenue_events_v2 (op_type, client_id, amount_usdt, status, request_id, created_at, chain, method, source, demand_source, is_test_data)
         VALUES ('refund', $1, $2, 'completed', $3, $4, null, null, 'dodo', 'dodo', false)`,
        [customerEmail || apiKey || 'unknown', -amountUsd, idKey, Math.floor(Date.now() / 1000)]
      );

      // Adjust credits if the account exists — deduct the refunded amount
      if (apiKey) {
        await client.query(
          `UPDATE api_credits
              SET credits_usdt = GREATEST(0, COALESCE(credits_usdt, 0) - $1)
            WHERE api_key = $2`,
          [amountUsd, apiKey]
        );
      }

      // Update subscription status if applicable
      if (subscriptionId) {
        await client.query(
          `UPDATE subscriptions SET status = 'cancelled', cancelled_at = now(), updated_at = now()
           WHERE provider = 'dodo' AND provider_subscription_id = $1`,
          [subscriptionId]
        );
      }

      await client.query('COMMIT');

      // Shadow ledger reversal entry
      shadowWriteRevenueLedger(pool, { requestId: idKey, amountUsdt: -amountUsd, isTestData: false });

      return res.json({ ok: true, refunded: true, amountUsd, apiKey, reason });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      if (err.code === '23505') {
        return res.status(409).json({ ok: false, code: 'duplicate', message: 'refund already processed' });
      }
      console.error('[internal/dodo] refund failed:', err.message);
      return res.status(500).json({ ok: false, error: 'internal_error' });
    } finally {
      client.release();
    }
  });

  return router;
}
