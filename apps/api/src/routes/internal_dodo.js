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
import { shadowWriteRevenueLedger, shadowReverseRevenueLedger } from '../ledger/shadow_ledger_write.js';
import { discord } from '../services/discord_notify.mjs';
import { isDodoSchemaReady } from '../db/dodo_schema_state.js';
import {
  isLegacySubBucketEnabled, isSubscriptionPayment, grantSubscriptionBucket, accountForSubscription, grantForPayment,
  revokeGrant, suspendGrant, restoreGrant, tableExists,
} from '../billing/legacy_sub_entitlement.mjs';

const ENTITLING_EVENTS = new Set(['payment.succeeded', 'subscription.renewed']);

// Dodo subscription.status values (schema-verified) -> our subscriptions.status.
// payment.failed has no subscription status of its own; it just means this
// charge attempt failed — recorded, but the subscription's own status comes
// from whichever subscription.* event Dodo sends alongside/after it.
const STATUS_FROM_EVENT = {
  'subscription.active': 'active',
  'subscription.on_hold': 'on_hold',
  'subscription.renewed': 'active',
  'subscription.cancelled': 'cancelled',
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
  starter: TIER_DAILY_LIMIT.basic,
  pro: TIER_DAILY_LIMIT.pro,
};

function planFromProductId(productId) {
  if (productId && process.env.DODO_PRODUCT_PRO_ID && productId === process.env.DODO_PRODUCT_PRO_ID) return 'pro';
  if (productId && process.env.DODO_PRODUCT_STARTER_ID && productId === process.env.DODO_PRODUCT_STARTER_ID) return 'starter';
  return 'starter';
}

// ── Credit-pack product allowlist + USD value map (money-leak fix, T-1.3/1.4) ─
//
// apps/web's dodo-webhook handles TWO surfaces on one Dodo account/webhook:
// task-commerce one-shot purchases and /intelligence one-time credit packs.
// It discriminates them by metadata.order_ref — a soft signal that file's own
// comments flag as unconfirmed against a live account ("static-link metadata
// pass-through may not be reaching webhooks as documented"). If that metadata
// is ever dropped, a task-commerce payment.succeeded would fall through to
// this router's entitling path with no product check and get credited as if
// it were a credit-pack payment.
//
// DODO_CREDIT_PACK_USD_VALUES is the authoritative, server-side source for
// BOTH the allowlist gate AND the USD amount credited — "productId:usdValue"
// pairs, comma-separated (e.g. "pdt_abc:9.99,pdt_def:49.99"). A product not
// listed here is NEVER credited, no matter what apps/web believed it was.
// Fail CLOSED — unset/empty credits NOTHING; it never falls back to "credit
// everything". Read live (not cached at module load), same pattern as
// DODO_PRODUCT_PRO_ID/STARTER_ID above, and required for the env var to be
// testable.
//
// DODO_CREDIT_PACK_PRODUCT_IDS (the older, value-less allowlist) is still
// honored for backward compatibility: a product listed there but NOT in
// DODO_CREDIT_PACK_USD_VALUES is still allowlisted, but its credited amount
// falls back to toUsdApprox(settlement_amount) with a loud warning — the
// product's configured USD value is always preferred when available (Phase
// 1.3: never derive credits from total_amount, and prefer the product's own
// configured value over the FX-approximated settlement amount).
function parseCreditPackUsdValues() {
  const map = new Map();
  for (const entry of (process.env.DODO_CREDIT_PACK_USD_VALUES || '').split(',')) {
    const [productId, usdRaw] = entry.split(':').map((s) => (s || '').trim());
    const usd = Number(usdRaw);
    if (productId && Number.isFinite(usd) && usd > 0) map.set(productId, usd);
  }
  return map;
}

function legacyAllowlistedIds() {
  return new Set(
    (process.env.DODO_CREDIT_PACK_PRODUCT_IDS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  );
}

function isAllowlistedCreditPackProduct(productId) {
  if (!productId) return false;
  return parseCreditPackUsdValues().has(productId) || legacyAllowlistedIds().has(productId);
}

/**
 * The USD amount to credit for an allowlisted credit-pack product.
 * Preferred: the product's own configured value (DODO_CREDIT_PACK_USD_VALUES)
 * — a fixed dashboard price, immune to FX drift and to which amount field
 * Dodo happened to populate. Falls back to toUsdApprox(settlement/total
 * amount) ONLY for a product allowlisted the old (value-less) way.
 * @returns {{usd: number, source: 'product_config'|'settlement_fallback'}}
 */
function resolveCreditPackUsd(productId, amountMinor, currency) {
  const configured = parseCreditPackUsdValues().get(productId);
  if (configured !== undefined) return { usd: configured, source: 'product_config' };
  console.error(
    `[internal/dodo] product "${productId}" allowlisted via legacy DODO_CREDIT_PACK_PRODUCT_IDS ` +
    `with no configured USD value in DODO_CREDIT_PACK_USD_VALUES — falling back to settlement-amount approximation`
  );
  return { usd: toUsdApprox(amountMinor, currency), source: 'settlement_fallback' };
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
  // The subscriptions table (migration 018) is not applied everywhere yet; a
  // missing table must not turn a status event into a 500 retry loop.
  if (!(await tableExists(pool, 'subscriptions'))) return;
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

// ── Identity mapping (T-1.4) ─────────────────────────────────────────────────
//
// The MONEY-CREDITING path (payment.succeeded / subscription.renewed) must
// NEVER guess which account to fund. It used to: fall back to matching by
// raw customer email, or silently provision a brand-new account if nothing
// matched. Both are money-safety bugs — an email typo, a shared email, or a
// payment made before this existed could credit the wrong account or create
// an orphan one nobody can reach. The only accepted identity signal now is
// apiKeyHint (metadata.satelink_account_id, set by /api/dodo-checkout at
// session-creation time — see apps/web's dodo-checkout route) resolving to
// an account that ALREADY exists. Anything else is unmatched, not guessed.
//
// Account PROVISIONING (creating a brand-new account for a first-time buyer)
// is a SEPARATE, pre-payment concern — see resolveOrCreateAccountForCheckout
// below, called by /internal/dodo/resolve-account at checkout-session
// creation time, before any money has moved. That's the "email sign-up"
// half of "Buy credits requires an account/API key first."

/** Strict resolution for the payment.succeeded entitling path: apiKeyHint must already exist. No fallback, no creation. */
async function resolveAccountForOneTimePayment(client, { apiKeyHint }) {
  if (!apiKeyHint) return null;
  const account = await resolveAccount(client, { apiKey: apiKeyHint });
  return account ? account.api_key : null;
}

/** Strict resolution for subscription.renewed: the api_key linked at subscription.active time. No email fallback, no creation. */
async function resolveAccountForSubscriptionRenewal(client, { subscriptionId }) {
  if (!subscriptionId) return null;
  if (await tableExists(client, 'subscriptions')) {
    const r = await client.query(
      `SELECT api_key FROM subscriptions WHERE provider = 'dodo' AND provider_subscription_id = $1`,
      [subscriptionId]
    );
    if (r.rows[0]?.api_key) return r.rows[0].api_key;
  }
  // The account an earlier payment of this subscription funded.
  return accountForSubscription(client, subscriptionId);
}

/**
 * Pre-payment account resolution for the checkout-session route — the ONLY
 * place in this file allowed to create a brand-new account, because no money
 * has moved yet (a checkout session can be abandoned with zero consequence).
 * Resolves an existing key/email if given, otherwise provisions a fresh
 * account (same shape x402's bundle path uses for a first-time payer,
 * settlement.js) so /api/dodo-checkout has an api_key to embed as
 * metadata.satelink_account_id before redirecting to Dodo.
 */
async function resolveOrCreateAccountForCheckout(client, { apiKeyHint, customerEmail }) {
  if (apiKeyHint) {
    const account = await resolveAccount(client, { apiKey: apiKeyHint });
    if (account) return { apiKey: account.api_key, created: false };
  }
  if (customerEmail) {
    const r = await client.query(
      `SELECT api_key FROM api_credits WHERE lower(email) = lower($1) ORDER BY created_at ASC LIMIT 1`,
      [customerEmail]
    );
    if (r.rows[0]?.api_key) return { apiKey: r.rows[0].api_key, created: false };
  }
  const apiKey = `sk_dodo_${crypto.randomBytes(24).toString('hex')}`;
  await client.query(
    `INSERT INTO api_credits (api_key, tier, daily_limit, demand_source, email)
     VALUES ($1, $2, $3, 'dodo', $4)
     ON CONFLICT (api_key) DO NOTHING`,
    [apiKey, 'free', TIER_DAILY_LIMIT.free, customerEmail || null]
  );
  return { apiKey, created: true };
}

/** Additive, idempotent (payment_id) record of a payment that could not be matched to an account. Never throws. */
async function insertUnmatchedPayment(client, {
  eventType, paymentId, subscriptionId, productId, customerEmail, currency, amountMinor, metadata, reason, rawPayload, isTest,
}) {
  await client.query(
    `INSERT INTO unmatched_payments
       (provider, event_type, payment_id, subscription_id, product_id, customer_email, currency, amount_minor, metadata, reason, raw_payload, is_test_data, created_at)
     VALUES ('dodo', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     ON CONFLICT (provider, payment_id) WHERE payment_id IS NOT NULL DO NOTHING`,
    [eventType, paymentId || null, subscriptionId || null, productId || null, customerEmail || null, currency || null,
     amountMinor ?? null, metadata ? JSON.stringify(metadata) : null, reason,
     rawPayload ? JSON.stringify(rawPayload) : null, !!isTest, Date.now()]
  );
}

// ── One-time checkout claim tokens (T-1.4 security fix) ──────────────────────
//
// Replaces embedding the raw api_key in the Dodo checkout return_url.
// 10-minute TTL: long enough to cover a slow card-entry + redirect, short
// enough that a leaked token (browser history, a proxy log somewhere
// upstream of this fix) is worthless soon after checkout. crypto.randomBytes
// (not a sequential id) so a token can't be guessed or enumerated.
const CLAIM_TTL_MS = 10 * 60 * 1000;

async function createCheckoutClaim(client, apiKey) {
  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  await client.query(
    `INSERT INTO dodo_checkout_claims (token, api_key, created_at, expires_at) VALUES ($1, $2, $3, $4)`,
    [token, apiKey, now, now + CLAIM_TTL_MS]
  );
  return token;
}

/** Single-use: UPDATE ... WHERE claimed_at IS NULL AND not expired, RETURNING — atomic claim-and-consume, no separate read-then-write race. */
async function exchangeCheckoutClaim(client, token) {
  const now = Date.now();
  const r = await client.query(
    `UPDATE dodo_checkout_claims
        SET claimed_at = $1
      WHERE token = $2 AND claimed_at IS NULL AND expires_at > $1
      RETURNING api_key`,
    [now, token]
  );
  return r.rows[0]?.api_key || null;
}

// ── Refund & dispute reversal (M5 follow-up) ─────────────────────────────────
//
// Event names & payload fields are SDK-verified against the INSTALLED
// @dodopayments/core zod schemas (node_modules/@dodopayments/core/dist/
// chunk-F4N6VZ2P.js): refund.succeeded/refund.failed (RefundSchema:292 —
// refund_id, payment_id, is_partial, amount) and dispute.{opened,accepted,
// cancelled,challenged,expired,won,lost} (DisputeSchema:307 — dispute_id,
// payment_id, dispute_status).
//
// Money direction per event. The task specifies opened→freeze, won→unfreeze,
// lost→clawback; the other dispute terminals are mapped by their obvious
// favourability so funds are never left frozen forever (documented, beyond the
// literal spec — founder to confirm Dodo's exact semantics):
//   MERCHANT-FAVOURABLE  (unfreeze): dispute.won, dispute.cancelled, dispute.expired
//   MERCHANT-LOSES       (clawback): dispute.lost, dispute.accepted
//   IN-PROGRESS          (log only) : dispute.challenged
const DISPUTE_UNFREEZE = new Set(['dispute.won', 'dispute.cancelled']);
const DISPUTE_CLAWBACK = new Set(['dispute.lost', 'dispute.accepted']);
const NO_MONEY_EVENTS = new Set(['refund.failed', 'dispute.challenged']);
// dispute.expired: the installed @dodopayments SDK defines 'dispute_expired'
// ONLY as a bare enum value (disputes.d.ts:55 / webhook.d.ts:58) — there is NO
// documented semantics for whether an expired dispute favours the merchant or
// the customer. Because it is genuinely ambiguous, we take NO automatic money
// action: the credits stay FROZEN (as set at dispute.opened) and a human is
// alerted to resolve it. Never auto-unfreeze or auto-clawback on expiry.
const DISPUTE_HOLD_ALERT = new Set(['dispute.expired']);

/** Resolve which api_key a Dodo payment funded, and how much it credited (USD). */
async function resolveFunding(client, paymentId) {
  if (!paymentId) return null;
  const key = `dodo:${paymentId}`;
  const dep = await client.query(
    `SELECT api_key, credited_usdt, is_test_data FROM api_deposits WHERE tx_hash = $1`, [key]
  );
  if (dep.rows[0]?.api_key) {
    return { apiKey: dep.rows[0].api_key, creditedUsd: Number(dep.rows[0].credited_usdt) || 0, isTestData: !!dep.rows[0].is_test_data };
  }
  const ps = await client.query(
    `SELECT credited_api_key, amount_usd, is_test_data FROM payment_sources WHERE tx_hash = $1`, [key]
  );
  if (ps.rows[0]?.credited_api_key) {
    return { apiKey: ps.rows[0].credited_api_key, creditedUsd: Number(ps.rows[0].amount_usd) || 0, isTestData: !!ps.rows[0].is_test_data };
  }
  return null;
}

/** Claw back up to `amount` from spendable credits, floored at 0. */
async function clawbackCredits(client, apiKey, amount) {
  const cur = await client.query(
    `SELECT credits_usdt FROM api_credits WHERE api_key = $1 FOR UPDATE`, [apiKey]
  );
  const bal = cur.rows[0] ? Number(cur.rows[0].credits_usdt) : 0;
  const actual = Math.min(amount, bal);
  if (actual > 0) {
    await client.query(
      `UPDATE api_credits SET credits_usdt = credits_usdt - $1 WHERE api_key = $2`,
      [actual, apiKey]
    );
  }
  return { actual: +actual.toFixed(6), shortfall: +(amount - actual).toFixed(6) };
}

/** Flag an account so authorizeAndMeter blocks paid calls with 402 payment_hold. */
async function setPaymentHold(client, apiKey) {
  await client.query(
    `UPDATE api_credits SET payment_hold = true WHERE api_key = $1`, [apiKey]
  );
}

/** Move up to `amount` from spendable into frozen (not spendable). */
async function freezeCredits(client, apiKey, amount) {
  const cur = await client.query(
    `SELECT credits_usdt FROM api_credits WHERE api_key = $1 FOR UPDATE`, [apiKey]
  );
  const bal = cur.rows[0] ? Number(cur.rows[0].credits_usdt) : 0;
  const frozen = Math.min(amount, bal);
  if (frozen > 0) {
    await client.query(
      `UPDATE api_credits SET credits_usdt = credits_usdt - $1, frozen_usdt = frozen_usdt + $1 WHERE api_key = $2`,
      [frozen, apiKey]
    );
  }
  return { frozen: +frozen.toFixed(6), shortfall: +(amount - frozen).toFixed(6) };
}

/** Return `amount` from frozen back to spendable. */
async function unfreezeCredits(client, apiKey, amount) {
  if (amount > 0) {
    await client.query(
      `UPDATE api_credits SET credits_usdt = credits_usdt + $1, frozen_usdt = GREATEST(0, frozen_usdt - $1) WHERE api_key = $2`,
      [amount, apiKey]
    );
  }
}

/** Forfeit `amount` of frozen funds (dispute lost — funds are gone). */
async function releaseFrozen(client, apiKey, amount) {
  if (amount > 0) {
    await client.query(
      `UPDATE api_credits SET frozen_usdt = GREATEST(0, frozen_usdt - $1) WHERE api_key = $2`,
      [amount, apiKey]
    );
  }
}

/** Append-only reversal row in revenue_events_v2 (negative; is_billable=false to
 *  satisfy 015's CHECK). NEVER mutates or deletes the original revenue row. */
async function insertReversalRow(client, { clientId, magnitude, requestId, isTest }) {
  await client.query(
    `INSERT INTO revenue_events_v2
       (op_type, client_id, amount_usdt, status, request_id, created_at, chain, method, source, demand_source, is_test_data, is_billable)
     VALUES ('refund_reversal', $1, $2, 'reversed', $3, $4, null, null, 'dodo', 'dodo', $5, false)
     ON CONFLICT (client_id, op_type, request_id) DO NOTHING`,
    [clientId, -Math.abs(magnitude), requestId, Math.floor(Date.now() / 1000), isTest]
  );
}

/** Full refund / dispute lost on a subscription payment → expire the entitlement. */
async function cancelEntitlementIfSubscription(client, apiKey) {
  // Migration 018 (subscriptions) is not applied everywhere; a failed statement
  // would abort the caller's transaction (a .catch() cannot undo that).
  if (!(await tableExists(client, 'subscriptions'))) return;
  await client.query(
    `UPDATE subscriptions
        SET status = 'cancelled', cancelled_at = COALESCE(cancelled_at, now()), updated_at = now()
      WHERE api_key = $1 AND provider = 'dodo' AND status <> 'cancelled'`,
    [apiKey]
  );
}

/** The prior dispute.opened log row (how much was frozen), if any. */
async function getOpenedFreeze(client, disputeId) {
  const r = await client.query(
    `SELECT amount_usd, shortfall_usd FROM dodo_refund_dispute_log WHERE event_id = $1`,
    [`dispute:${disputeId}:opened`]
  );
  if (!r.rows[0]) return null;
  return { frozen: Number(r.rows[0].amount_usd) || 0, shortfall: Number(r.rows[0].shortfall_usd) || 0 };
}

async function logReversalEvent(client, { eventId, kind, eventType, dodoRef, paymentId, apiKey, amount, shortfall, isTest }) {
  await client.query(
    `INSERT INTO dodo_refund_dispute_log
       (event_id, kind, event_type, dodo_ref, payment_id, api_key, amount_usd, shortfall_usd, is_test_data, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [eventId, kind, eventType, dodoRef, paymentId || null, apiKey || null,
     amount || 0, shortfall || 0, !!isTest, Date.now()]
  );
}

export function createDodoInternalRouter(pool) {
  const router = express.Router();
  router.use(express.json({ limit: '64kb' }));
  router.use(requireInternalSecret);

  // POST /internal/dodo/resolve-account — pre-payment account resolution for
  // apps/web's checkout-session route. Registered BEFORE the isDodoSchemaReady
  // gate below: it only touches api_credits (a core table that always
  // exists), not the Dodo-rail-specific columns/tables that gate guards, so a
  // buyer can still get an api_key to embed in checkout metadata even if the
  // boot DDL for refunds/disputes/unmatched_payments hasn't caught up yet.
  router.post('/resolve-account', async (req, res) => {
    const { email, apiKeyHint } = req.body || {};
    const customerEmail = typeof email === 'string' ? email.trim() : '';
    const hint = typeof apiKeyHint === 'string' ? apiKeyHint.trim() : '';
    if (!customerEmail && !hint) {
      return res.status(400).json({ ok: false, error: 'email or apiKeyHint required' });
    }
    if (customerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)) {
      return res.status(400).json({ ok: false, error: 'invalid email' });
    }
    const client = await pool.connect();
    try {
      const { apiKey, created } = await resolveOrCreateAccountForCheckout(client, {
        apiKeyHint: hint || undefined,
        customerEmail: customerEmail || undefined,
      });
      return res.json({ ok: true, apiKey, created });
    } catch (err) {
      console.error('[internal/dodo] resolve-account failed:', err.message);
      return res.status(500).json({ ok: false, error: 'internal_error' });
    } finally {
      client.release();
    }
  });

  // Fail closed if the Dodo-rail boot DDL failed (schema not ready): never write
  // credits/reversals against a half-migrated schema. 503 → apps/web throws →
  // Dodo retries later, by which time a fixed deploy has made the schema ready.
  router.use((req, res, next) => {
    if (!isDodoSchemaReady()) {
      return res.status(503).json({ ok: false, error: 'dodo_schema_not_ready' });
    }
    return next();
  });

  // POST /internal/dodo/create-claim — T-1.4 security fix: the checkout
  // route calls this AFTER resolve-account to mint a one-time, short-lived,
  // opaque token standing in for the api_key in the Dodo return_url. The key
  // itself never reaches the browser's address bar, history, or any Referer
  // header this way — only the token does, and the token is useless on its
  // own (it must be exchanged server-side, exactly once, before it expires).
  router.post('/create-claim', async (req, res) => {
    const apiKey = typeof req.body?.apiKey === 'string' ? req.body.apiKey.trim() : '';
    if (!apiKey) return res.status(400).json({ ok: false, error: 'apiKey required' });
    const client = await pool.connect();
    try {
      const token = await createCheckoutClaim(client, apiKey);
      return res.json({ ok: true, claimToken: token });
    } catch (err) {
      console.error('[internal/dodo] create-claim failed:', err.message);
      return res.status(500).json({ ok: false, error: 'internal_error' });
    } finally {
      client.release();
    }
  });

  // POST /internal/dodo/exchange-claim — the success page's ONE allowed
  // read of the api_key, via a POST body, never a URL. Single-use: the row
  // is marked claimed_at in the same statement that reads it, so a replayed
  // or leaked token (e.g. from a proxy log) is worthless after the first
  // legitimate exchange.
  router.post('/exchange-claim', async (req, res) => {
    const token = typeof req.body?.claimToken === 'string' ? req.body.claimToken.trim() : '';
    if (!token) return res.status(400).json({ ok: false, error: 'claimToken required' });
    const client = await pool.connect();
    try {
      const apiKey = await exchangeCheckoutClaim(client, token);
      if (!apiKey) return res.status(410).json({ ok: false, error: 'claim_invalid_expired_or_used' });
      return res.json({ ok: true, apiKey });
    } catch (err) {
      console.error('[internal/dodo] exchange-claim failed:', err.message);
      return res.status(500).json({ ok: false, error: 'internal_error' });
    } finally {
      client.release();
    }
  });

  router.post('/credit', async (req, res) => {
    const body = req.body || {};
    const {
      eventType, paymentId, subscriptionId, planProductId, customerEmail,
      apiKeyHint, currency, amountMinor, isTestMode, currentPeriodStart,
      currentPeriodEnd, previousBillingDate, metadata,
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
    // Subscription money → the Trading-Intelligence plan bucket (payments
    // boundary, fix/legacy-dodo-subscription-bucket); packs → credits as before.
    // Flag OFF (default) → subscriptionPayment stays false → today's credit path.
    const bucketOn = isLegacySubBucketEnabled();
    let subscriptionPayment = bucketOn && eventType === 'subscription.renewed';
    let idKey;
    let amountUsd;
    if (eventType === 'payment.succeeded') {
      if (!paymentId) return res.status(400).json({ ok: false, error: 'paymentId required' });
      // Money-leak gate: never credit a one-time payment whose product isn't
      // an explicitly allowlisted credit pack (see CREDIT_PACK_PRODUCT_IDS
      // above). 200, not 5xx — this is a legitimate non-credit outcome (e.g.
      // a task-commerce order that reached here despite apps/web's order_ref
      // discriminator), not an error Dodo should retry forever.
      subscriptionPayment = bucketOn && isSubscriptionPayment({ eventType, subscriptionId, planProductId });
      if (!subscriptionPayment && !isAllowlistedCreditPackProduct(planProductId)) {
        console.error(
          `[internal/dodo] payment.succeeded product "${planProductId || '(none)'}" not in ` +
          `DODO_CREDIT_PACK_PRODUCT_IDS/DODO_CREDIT_PACK_USD_VALUES allowlist — not crediting (payment ${paymentId})`
        );
        return res.json({ ok: true, entitled: false, eventType, reason: 'product_not_allowlisted' });
      }
      idKey = `dodo:${paymentId}`;
      amountUsd = subscriptionPayment ? toUsdApprox(amountMinor, currency) : resolveCreditPackUsd(planProductId, amountMinor, currency).usd;
    } else {
      if (!subscriptionId || !previousBillingDate) {
        return res.status(400).json({ ok: false, error: 'subscriptionId and previousBillingDate required for subscription.renewed' });
      }
      idKey = `dodo:sub:${subscriptionId}:${previousBillingDate}`;
      amountUsd = toUsdApprox(amountMinor, currency);
    }

    // Never let a zero/negative amount reach the revenue_events_v2 INSERT —
    // migration 015's CHECK (is_billable=false OR amount_usdt>0) rejects it,
    // which used to surface as an opaque 500 (Postgres 23514) for a bare test
    // payload with no settlement_amount/total_amount. A legitimate non-credit
    // outcome, same as product_not_allowlisted — 200, not 5xx.
    if (!(amountUsd > 0)) {
      console.error(`[internal/dodo] ${eventType} resolved to a non-positive amount (${amountUsd}) — not crediting (payment ${paymentId || subscriptionId})`);
      return res.json({ ok: true, entitled: false, eventType, reason: 'non_positive_amount' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Idempotency gate (M5-b), checked inside the transaction before any write.
      const dup = await client.query(`SELECT 1 FROM payment_sources WHERE tx_hash = $1`, [idKey]);
      if (dup.rows.length > 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({ ok: false, code: 'duplicate', message: 'already credited' });
      }

      // Strict identity mapping (T-1.4): the ONLY accepted signal is a
      // pre-existing account, resolved via metadata.satelink_account_id
      // (apiKeyHint) for one-time payments, or the subscription's own linked
      // api_key for renewals. No email fallback, no silent account creation
      // on the money-crediting path — see resolveOrCreateAccountForCheckout
      // for where accounts actually get provisioned (pre-payment).
      const apiKey = eventType === 'payment.succeeded'
        ? await resolveAccountForOneTimePayment(client, { apiKeyHint })
        : await resolveAccountForSubscriptionRenewal(client, { subscriptionId });

      if (!apiKey) {
        await client.query('ROLLBACK');
        const reason = apiKeyHint || subscriptionId ? 'account_not_found' : 'no_account_metadata';
        console.error(
          `[internal/dodo] ${eventType} has no resolvable account (${reason}) — recording in unmatched_payments, not crediting ` +
          `(payment ${paymentId || '(none)'}, subscription ${subscriptionId || '(none)'})`
        );
        // Own connection: this insert must survive even though the main tx
        // above was just rolled back (it was never committed to anything).
        const uClient = await pool.connect();
        try {
          await insertUnmatchedPayment(uClient, {
            eventType, paymentId, subscriptionId, productId: planProductId, customerEmail, currency, amountMinor,
            metadata, reason, rawPayload: body, isTest,
          });
        } catch (uErr) {
          console.error('[internal/dodo] insertUnmatchedPayment failed:', uErr.message);
        } finally {
          uClient.release();
        }
        return res.json({ ok: true, entitled: false, matched: false, eventType, reason });
      }

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

      let credited = null;
      let granted = null;
      if (subscriptionPayment) {
        // Dodo boundary: a subscription buys the monthly Trading-Intelligence
        // allowance, never fungible credits that could pay for RPC / x402.
        granted = await grantSubscriptionBucket(client, {
          apiKey, plan, txHash: idKey, subscriptionId,
          periodStart: currentPeriodStart || null, periodEnd: currentPeriodEnd || null,
        });
      } else {
        // T-17: the SAME creditAccount() the deposit listener uses. 1:1 credit —
        // same semantics as every other deposit path (T-17b), no bundle discount.
        credited = await creditAccount(client, {
          apiKey, amountUsdt: amountUsd, txHash: idKey, fromAddress: customerEmail || null,
          tier: plan, dailyLimit: PLAN_DAILY_LIMIT[plan] || PLAN_DAILY_LIMIT.starter,
        });
        if (!credited.ok) {
          await client.query('ROLLBACK');
          return res.status(409).json({ ok: false, code: credited.code, message: credited.message });
        }
      }

      if (subscriptionId && (await tableExists(client, 'subscriptions'))) {
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

      return res.json({
        ok: true, entitled: true, apiKey, eventType,
        ...(granted ? { bucket: 'plan_entitlement', planId: granted.planId, includedCalls: granted.includedCalls, periodEnd: granted.periodEnd } : { creditedUsdt: credited.balance }),
      });
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

  // POST /internal/dodo/reversal — the money-REVERSING half of the rail:
  // refund.succeeded/failed and dispute.* events. One DB transaction per event;
  // idempotent on dodo_refund_dispute_log.event_id; FAIL CLOSED (500 → Dodo
  // retries) on any unexpected error, safe because every write is idempotent.
  router.post('/reversal', async (req, res) => {
    const body = req.body || {};
    const { eventType, dodoRef, paymentId, isPartial, amountMinor, currency, isTestMode } = body;

    if (!eventType) return res.status(400).json({ ok: false, error: 'eventType required' });
    if (!dodoRef) return res.status(400).json({ ok: false, error: 'dodoRef required' });

    const kind = eventType.startsWith('refund.') ? 'refund'
      : eventType.startsWith('dispute.') ? 'dispute' : null;
    if (!kind) return res.status(400).json({ ok: false, error: `unsupported eventType: ${eventType}` });

    // Preliminary flag for the pre-funding branches (no-money / unmatched); for
    // matched events it is overridden by the ORIGINAL payment's is_test_data
    // below (authoritative — disputes carry no metadata to infer it from).
    let isTest = !!isTestMode;
    // Deterministic idempotency key. A refund_id is terminal-unique; a dispute_id
    // repeats across its lifecycle, so it is qualified by the event's own stage.
    const eventId = kind === 'refund'
      ? `refund:${dodoRef}`
      : `dispute:${dodoRef}:${eventType.slice('dispute.'.length)}`;

    // Amount to reverse against, after any shadow-ledger mirror (set inside tx).
    let shadow = null;
    const alerts = []; // discord/error alerts fired AFTER commit (never block the tx)

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Idempotency gate — checked inside the tx before any write.
      const dup = await client.query(
        `SELECT 1 FROM dodo_refund_dispute_log WHERE event_id = $1`, [eventId]
      );
      if (dup.rows.length > 0) {
        await client.query('ROLLBACK');
        return res.status(200).json({ ok: true, duplicate: true, eventType });
      }

      // Events that never move money: record for visibility, then done.
      if (NO_MONEY_EVENTS.has(eventType)) {
        await logReversalEvent(client, { eventId, kind, eventType, dodoRef, paymentId, apiKey: null, amount: 0, shortfall: 0, isTest });
        await client.query('COMMIT');
        return res.status(200).json({ ok: true, action: 'logged', eventType });
      }

      // Subscription payments granted a plan bucket, not credits: reverse the
      // ENTITLEMENT they created — never claw back unrelated credits.
      const grant = await grantForPayment(client, paymentId);
      if (grant) {
        const isTestGrant = !!isTest;
        let result;
        if (eventType === 'refund.succeeded' || DISPUTE_CLAWBACK.has(eventType)) {
          if (grant.status !== 'revoked') await revokeGrant(client, grant);
          const paid = await client.query(`SELECT amount_usd FROM payment_sources WHERE tx_hash = $1`, [grant.tx_hash]);
          const paidUsd = Number(paid.rows[0]?.amount_usd ?? 0);
          const magnitude = eventType === 'refund.succeeded' && isPartial ? Math.min(toUsdApprox(amountMinor, currency), paidUsd) : paidUsd;
          const requestId = `dodo:${eventType === 'refund.succeeded' ? 'refund' : 'dispute'}:${dodoRef}`;
          if (magnitude > 0) {
            await insertReversalRow(client, { clientId: grant.api_key, magnitude, requestId, isTest: isTestGrant });
            shadow = { requestId, amountUsdt: magnitude, isTestData: isTestGrant };
          }
          await cancelEntitlementIfSubscription(client, grant.api_key);
          result = { action: 'entitlement_revoked', reversedUsd: magnitude };
        } else if (eventType === 'dispute.opened') {
          const paused = grant.status === 'active' ? await suspendGrant(client, grant) : 0;
          result = { action: 'entitlement_suspended', pausedCalls: paused };
        } else if (DISPUTE_UNFREEZE.has(eventType)) {
          const restored = grant.status === 'suspended' ? await restoreGrant(client, grant) : 0;
          result = { action: 'entitlement_restored', restoredCalls: restored };
        } else {
          // dispute.expired / unknown stage: stays suspended; a human decides.
          alerts.push(['Dodo dispute on a subscription needs a decision', `dispute ${dodoRef} (payment ${paymentId}) ${eventType}; entitlement stays ${grant.status}`, 'critical']);
          result = { action: 'entitlement_held', status: grant.status };
        }
        await logReversalEvent(client, { eventId, kind, eventType, dodoRef, paymentId, apiKey: grant.api_key, amount: 0, shortfall: 0, isTest: isTestGrant });
        await client.query('COMMIT');
        if (shadow) shadowReverseRevenueLedger(pool, shadow);
        for (const [title, message, severity] of alerts) discord.alert(title, message, severity).catch(() => {});
        return res.status(200).json({ ok: true, matched: true, eventType, funding: 'entitlement', ...result });
      }

      const funding = await resolveFunding(client, paymentId);
      if (!funding) {
        // No Dodo-credit record for this payment (e.g. a task-commerce order, or
        // a subscription-renewal refund keyed by synthetic sub-id). Definitively
        // unmatchable — record and 200 (a 5xx here would loop Dodo's retries).
        await logReversalEvent(client, { eventId, kind, eventType, dodoRef, paymentId, apiKey: null, amount: 0, shortfall: 0, isTest });
        await client.query('COMMIT');
        return res.status(200).json({ ok: true, matched: false, eventType });
      }
      const { apiKey, creditedUsd } = funding;
      isTest = funding.isTestData; // authoritative: match the original payment

      let result;
      if (eventType === 'refund.succeeded') {
        // Full: reverse the whole credited amount. Partial: the refunded portion
        // (credit was 1:1 with the payment, so USD of the refunded minor units IS
        // the proportional clawback). Capped at what was credited.
        const partial = !!isPartial;
        let refundUsd = partial ? toUsdApprox(amountMinor, currency) : creditedUsd;
        refundUsd = Math.min(+refundUsd.toFixed(6), creditedUsd);
        if (!(refundUsd > 0)) {
          await client.query('ROLLBACK');
          return res.status(400).json({ ok: false, error: 'refund amount could not be determined' });
        }
        const { actual, shortfall } = await clawbackCredits(client, apiKey, refundUsd);
        const requestId = `dodo:refund:${dodoRef}`;
        await insertReversalRow(client, { clientId: apiKey, magnitude: refundUsd, requestId, isTest });
        if (!partial) await cancelEntitlementIfSubscription(client, apiKey);
        if (shortfall > 0) {
          await setPaymentHold(client, apiKey);   // clawback under-covered → hold the account
          alerts.push(['Dodo refund shortfall — account on payment_hold',
            `refund ${dodoRef} (payment ${paymentId}) clawed back ${actual}, shortfall ${shortfall} on ${apiKey}`, 'warning']);
        }
        await logReversalEvent(client, { eventId, kind, eventType, dodoRef, paymentId, apiKey, amount: actual, shortfall, isTest });
        shadow = { requestId, amountUsdt: refundUsd, isTestData: isTest };
        result = { action: partial ? 'refund_partial' : 'refund_full', clawedBack: actual, shortfall, paymentHold: shortfall > 0 };

      } else if (eventType === 'dispute.opened') {
        const { frozen, shortfall } = await freezeCredits(client, apiKey, creditedUsd);
        await logReversalEvent(client, { eventId, kind, eventType, dodoRef, paymentId, apiKey, amount: frozen, shortfall, isTest });
        result = { action: 'frozen', frozen, shortfall };

      } else if (DISPUTE_UNFREEZE.has(eventType)) {
        const opened = await getOpenedFreeze(client, dodoRef);
        const frozen = opened ? opened.frozen : 0;
        if (frozen > 0) await unfreezeCredits(client, apiKey, frozen);
        await logReversalEvent(client, { eventId, kind, eventType, dodoRef, paymentId, apiKey, amount: frozen, shortfall: 0, isTest });
        result = { action: 'unfrozen', unfrozen: frozen };

      } else if (DISPUTE_CLAWBACK.has(eventType)) {
        const opened = await getOpenedFreeze(client, dodoRef);
        let shortfall;
        if (opened) {
          // Funds were frozen at open; forfeit the hold. Already-spent portion
          // (couldn't be frozen then) is the shortfall.
          await releaseFrozen(client, apiKey, opened.frozen);
          shortfall = opened.shortfall;
        } else {
          // No prior freeze on record — claw back from spendable, like a full refund.
          const cb = await clawbackCredits(client, apiKey, creditedUsd);
          shortfall = cb.shortfall;
        }
        const requestId = `dodo:dispute:${dodoRef}`;
        await insertReversalRow(client, { clientId: apiKey, magnitude: creditedUsd, requestId, isTest });
        await cancelEntitlementIfSubscription(client, apiKey);
        if (shortfall > 0) {
          await setPaymentHold(client, apiKey);
          alerts.push(['Dodo dispute clawback shortfall — account on payment_hold',
            `dispute ${dodoRef} (payment ${paymentId}) reversed ${creditedUsd}, shortfall ${shortfall} on ${apiKey}`, 'warning']);
        }
        await logReversalEvent(client, { eventId, kind, eventType, dodoRef, paymentId, apiKey, amount: creditedUsd, shortfall, isTest });
        shadow = { requestId, amountUsdt: creditedUsd, isTestData: isTest };
        result = { action: 'dispute_clawback', reversed: creditedUsd, shortfall, paymentHold: shortfall > 0 };

      } else if (DISPUTE_HOLD_ALERT.has(eventType)) {
        // dispute.expired — ambiguous (see DISPUTE_HOLD_ALERT). Keep the credits
        // FROZEN (no unfreeze, no clawback); record and alert a human to decide.
        const opened = await getOpenedFreeze(client, dodoRef);
        const frozen = opened ? opened.frozen : 0;
        await logReversalEvent(client, { eventId, kind, eventType, dodoRef, paymentId, apiKey, amount: frozen, shortfall: 0, isTest });
        console.error(`[internal/dodo] dispute.expired ${dodoRef} (payment ${paymentId}) — credits kept FROZEN (${frozen}) on ${apiKey}, needs manual resolution`);
        alerts.push(['Dodo dispute EXPIRED — credits held, manual decision needed',
          `dispute ${dodoRef} (payment ${paymentId}) expired; ${frozen} kept frozen on ${apiKey}. Dodo SDK does not define expiry semantics — resolve manually (unfreeze or clawback).`, 'critical']);
        result = { action: 'expired_hold_frozen', frozen };

      } else {
        // Unknown dispute.* stage — record, no money movement.
        await logReversalEvent(client, { eventId, kind, eventType, dodoRef, paymentId, apiKey, amount: 0, shortfall: 0, isTest });
        result = { action: 'logged' };
      }

      await client.query('COMMIT');

      // Shadow-ledger reversal fired AFTER commit (mirrors the credit path);
      // own pool/tx, never throws, no-op unless LEDGER_SHADOW_WRITE is enabled.
      if (shadow) shadowReverseRevenueLedger(pool, shadow);

      // Alerts fired AFTER commit — discord.alert() is gated + never throws.
      for (const [title, message, severity] of alerts) {
        discord.alert(title, message, severity).catch(() => {});
      }

      return res.status(200).json({ ok: true, matched: true, eventType, ...result });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      if (err.code === '23505') {
        // Race on the event_id UNIQUE — another delivery won; idempotent.
        return res.status(200).json({ ok: true, duplicate: true, eventType });
      }
      console.error('[internal/dodo] reversal failed:', err.message);
      return res.status(500).json({ ok: false, error: 'internal_error' });
    } finally {
      client.release();
    }
  });

  return router;
}
