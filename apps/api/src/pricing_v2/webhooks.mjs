// Pricing V2 Dodo webhooks → entitlements → revenue events → Financial OS
// shadow ledger. Flag SATELINK_SUBSCRIPTIONS_ENABLED (route mount).
//
// Scope: only V2 checkouts (metadata.satelink_checkout === 'v2', or a
// subscription/payment we already know from one) for products in the
// PlanCatalog. Anything else is acknowledged and left to the legacy path
// (apps/web dodo-webhook → /internal/dodo) — which is NOT changed here.
//
// Idempotency: every event is stored once by its Standard Webhooks id
// (pv2_webhook_events PK). A redelivery returns {duplicate:true} and applies
// nothing. Processing runs in ONE transaction with that insert, so a crash
// mid-way leaves no partial state and the redelivery re-applies cleanly.
// Payment facts are additionally keyed by Dodo id (pv2_payments PK) and revenue
// rows by request_id (ON CONFLICT DO NOTHING) — defence in depth.
//
// Dodo money is Trading-Intelligence value only: grants go to pv2_entitlements
// (plan UU) and pv2_pack_balances (pack UU), never to api_credits.
import crypto from 'node:crypto';
import { loadCatalog, entitlementPlan, itemForDodoProduct } from './catalog.mjs';
import { ensurePricingV2Schema } from './schema.mjs';
import { shadowWriteRevenueLedger, shadowReverseRevenueLedger } from '../ledger/shadow_ledger_write.js';

export function isSubscriptionsEnabled() {
  return process.env.SATELINK_SUBSCRIPTIONS_ENABLED === 'true';
}
export function dodoMode() {
  return process.env.DODO_MODE === 'live' ? 'live' : 'test';
}
export function webhookSecret() {
  return process.env.DODO_WEBHOOK_SECRET || process.env.DODO_WEBHOOK_SECRET_KEY || '';
}

/** Standard Webhooks verification (HMAC-SHA256 over `${id}.${ts}.${body}`). */
export function verifyStandardWebhook({ id, timestamp, signature }, rawBody, secret, { toleranceSec = 300, now = Date.now() } = {}) {
  if (!id || !timestamp || !signature || !secret) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(now / 1000 - ts) > toleranceSec) return false;
  const key = Buffer.from(secret.startsWith('whsec_') ? secret.slice(6) : secret, 'base64');
  const expected = crypto.createHmac('sha256', key).update(`${id}.${timestamp}.${rawBody}`).digest();
  return String(signature).split(' ').some((part) => {
    const [ver, sig] = part.split(',');
    if (ver !== 'v1' || !sig) return false;
    const got = Buffer.from(sig, 'base64');
    return got.length === expected.length && crypto.timingSafeEqual(got, expected);
  });
}

const d = (x) => (x ? new Date(x) : null);

async function accountFor(client, data) {
  const meta = data?.metadata || {};
  if (meta.satelink_checkout === 'v2' && typeof meta.satelink_user_id === 'string') return meta.satelink_user_id;
  if (data?.subscription_id) {
    const r = await client.query('SELECT account_id FROM pv2_subscriptions WHERE dodo_subscription_id = $1', [data.subscription_id]);
    if (r.rows[0]) return r.rows[0].account_id;
  }
  if (data?.payment_id) {
    const r = await client.query(`SELECT account_id FROM pv2_payments WHERE dodo_id = $1 AND kind = 'payment'`, [data.payment_id]);
    if (r.rows[0]) return r.rows[0].account_id;
  }
  return null;
}

function productOf(data) {
  return data?.product_id || data?.product_cart?.[0]?.product_id || data?.metadata?.satelink_dodo_product_id || null;
}

async function grantPlan(client, accountId, planItem, catalog, { status = 'active', periodEnd = null, ref }) {
  const ent = entitlementPlan(planItem.id, catalog);
  await client.query(
    `INSERT INTO pv2_entitlements (account_id, plan_id, catalog_version, session_uu, weekly_uu, status, source_ref, period_end, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
     ON CONFLICT (account_id) DO UPDATE SET plan_id = EXCLUDED.plan_id, catalog_version = EXCLUDED.catalog_version,
       session_uu = EXCLUDED.session_uu, weekly_uu = EXCLUDED.weekly_uu, status = EXCLUDED.status,
       source_ref = EXCLUDED.source_ref, period_end = COALESCE(EXCLUDED.period_end, pv2_entitlements.period_end), updated_at = NOW()`,
    [accountId, planItem.id, catalog.version, ent.allowance.session_uu, ent.allowance.weekly_uu, status, ref, periodEnd]
  );
}

async function setEntitlementStatus(client, accountId, status, ref) {
  await client.query(`UPDATE pv2_entitlements SET status = $2, source_ref = $3, updated_at = NOW() WHERE account_id = $1`, [accountId, status, ref]);
}

async function revenueRow(client, { requestId, accountId, amountUsd, opType, mode, billable = true }) {
  await client.query(
    `INSERT INTO revenue_events_v2 (op_type, client_id, amount_usdt, status, request_id, created_at, source, demand_source, is_test_data, is_billable)
     VALUES ($1, $2, $3, 'completed', $4, EXTRACT(EPOCH FROM NOW())::bigint, 'dodo', 'dodo', $5, $6)
     ON CONFLICT DO NOTHING`,
    [opType, `acct:${accountId}`, amountUsd, requestId, mode === 'test', billable]
  );
}

/**
 * Apply one verified event. Returns {outcome, ...}. `ledger` is injectable so
 * tests can observe Financial OS writes (the real writer skips test data).
 */
export async function processDodoEvent(pool, event, { webhookId, mode = dodoMode(), catalog = loadCatalog(), ledger = { write: shadowWriteRevenueLedger, reverse: shadowReverseRevenueLedger }, logger = console } = {}) {
  await ensurePricingV2Schema(pool);
  const client = await pool.connect();
  const after = [];
  try {
    await client.query('BEGIN');
    const ins = await client.query(
      `INSERT INTO pv2_webhook_events (webhook_id, event_type, mode, payload) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING RETURNING webhook_id`,
      [webhookId, event.type, mode, JSON.stringify(event)]
    );
    if (!ins.rowCount) {
      await client.query('ROLLBACK');
      return { outcome: 'duplicate', duplicate: true };
    }
    const data = event.data || {};
    const accountId = await accountFor(client, data);
    const match = itemForDodoProduct(productOf(data), mode, catalog);
    let outcome = 'ignored';

    const t = event.type;
    if (!accountId || (!match && !t.startsWith('refund.') && !t.startsWith('dispute.'))) {
      outcome = accountId ? 'ignored_not_catalog' : 'ignored_not_v2';
    } else if (t === 'payment.succeeded') {
      const amountUsd = Number(data.total_amount ?? 0) / 100;
      const currency = data.currency || 'USD';
      const p = await client.query(
        `INSERT INTO pv2_payments (dodo_id, kind, mode, account_id, item_id, amount_minor, currency, status, payment_ref)
         VALUES ($1, 'payment', $2, $3, $4, $5, $6, 'succeeded', $7) ON CONFLICT DO NOTHING RETURNING dodo_id`,
        [data.payment_id, mode, accountId, match.item.id, data.total_amount ?? 0, currency, data.subscription_id || null]
      );
      if (!p.rowCount) {
        outcome = 'payment_already_applied';
      } else {
        const requestId = `dodo:v2:${data.payment_id}`;
        await revenueRow(client, { requestId, accountId, amountUsd, opType: match.type === 'pack' ? 'pack_purchase' : 'subscription_payment', mode });
        await client.query(
          `INSERT INTO payment_sources (source, amount_usd, token, network, tx_hash, payer, credited_api_key, is_test_data)
           VALUES ('dodo', $1, $2, 'dodo', $3, $4, NULL, $5) ON CONFLICT DO NOTHING`,
          [amountUsd, currency, `dodo:${data.payment_id}`, `acct:${accountId}`, mode === 'test']
        );
        if (match.type === 'pack') {
          await client.query(
            `INSERT INTO pv2_pack_grants (dodo_payment_id, account_id, pack_id, uu) VALUES ($1, $2, $3, $4)`,
            [data.payment_id, accountId, match.item.id, match.item.grant_uu]
          );
          await client.query(
            `INSERT INTO pv2_pack_balances (account_id, uu_balance) VALUES ($1, $2)
             ON CONFLICT (account_id) DO UPDATE SET uu_balance = pv2_pack_balances.uu_balance + EXCLUDED.uu_balance, updated_at = NOW()`,
            [accountId, match.item.grant_uu]
          );
          outcome = 'pack_granted';
        } else {
          await grantPlan(client, accountId, match.item, catalog, { ref: `payment:${data.payment_id}` });
          outcome = 'plan_payment_recorded';
        }
        after.push(() => ledger.write(pool, { requestId, amountUsdt: amountUsd, isTestData: mode === 'test', opType: 'dodo_v2' }, logger));
      }
    } else if (t === 'payment.failed') {
      outcome = 'payment_failed_noted';
    } else if (t.startsWith('subscription.')) {
      const subId = data.subscription_id;
      const status = t.slice('subscription.'.length);
      await client.query(
        `INSERT INTO pv2_subscriptions (dodo_subscription_id, account_id, mode, plan_id, catalog_version, status, current_period_end, intro, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
         ON CONFLICT (dodo_subscription_id) DO UPDATE SET status = EXCLUDED.status,
           current_period_end = COALESCE(EXCLUDED.current_period_end, pv2_subscriptions.current_period_end),
           plan_id = EXCLUDED.plan_id, intro = EXCLUDED.intro, updated_at = NOW()`,
        [subId, accountId, mode, match.item.id, catalog.version, status, d(data.next_billing_date), Boolean(match.item.intro) && status === 'active']
      );
      if (status === 'active' || status === 'renewed') {
        // Launch renews into Pro's price; the entitlement is Pro's either way.
        await grantPlan(client, accountId, match.item, catalog, { periodEnd: d(data.next_billing_date), ref: `sub:${subId}:${status}` });
        outcome = `entitlement_${status}`;
      } else if (status === 'on_hold') {
        await setEntitlementStatus(client, accountId, 'on_hold', `sub:${subId}:on_hold`);
        outcome = 'entitlement_on_hold';
      } else if (status === 'cancelled' || status === 'expired' || status === 'failed') {
        await setEntitlementStatus(client, accountId, 'revoked', `sub:${subId}:${status}`);
        outcome = 'entitlement_revoked';
      } else if (status === 'plan_changed') {
        await grantPlan(client, accountId, match.item, catalog, { periodEnd: d(data.next_billing_date), ref: `sub:${subId}:plan_changed` });
        outcome = 'entitlement_plan_changed';
      } else {
        outcome = `subscription_${status}_noted`;
      }
    } else if (t.startsWith('refund.') || t.startsWith('dispute.')) {
      const orig = (await client.query(`SELECT * FROM pv2_payments WHERE dodo_id = $1 AND kind = 'payment'`, [data.payment_id])).rows[0];
      if (!orig) {
        outcome = 'ignored_unknown_payment';
      } else {
        const isRefund = t.startsWith('refund.');
        const id = isRefund ? data.refund_id : data.dispute_id;
        const stage = t.split('.')[1];
        const amountMinor = Number(data.amount ?? orig.amount_minor);
        await client.query(
          `INSERT INTO pv2_payments (dodo_id, kind, mode, account_id, item_id, amount_minor, currency, status, payment_ref)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT (dodo_id) DO UPDATE SET status = EXCLUDED.status`,
          [`${isRefund ? 'refund' : 'dispute'}:${id}`, isRefund ? 'refund' : 'dispute', mode, orig.account_id, orig.item_id, amountMinor, orig.currency, stage, orig.dodo_id]
        );
        const reverse = async (why) => {
          const requestId = `dodo:v2:${why}:${id}`;
          const amt = amountMinor / 100;
          await revenueRow(client, { requestId, accountId: orig.account_id, amountUsd: -amt, opType: 'refund_reversal', mode, billable: false });
          const grant = (await client.query(`SELECT uu, status FROM pv2_pack_grants WHERE dodo_payment_id = $1 FOR UPDATE`, [orig.dodo_id])).rows[0];
          if (grant && grant.status === 'granted') {
            // Remove what is left of the pack (never below zero); the used
            // part was consumed — recorded, not clawed from other buckets.
            await client.query(`UPDATE pv2_pack_balances SET uu_balance = GREATEST(0, uu_balance - $2), updated_at = NOW() WHERE account_id = $1`, [orig.account_id, grant.uu]);
            await client.query(`UPDATE pv2_pack_grants SET status = 'reversed' WHERE dodo_payment_id = $1`, [orig.dodo_id]);
          } else {
            await setEntitlementStatus(client, orig.account_id, 'revoked', `${why}:${id}`);
          }
          after.push(() => ledger.reverse(pool, { requestId, amountUsdt: amt, isTestData: mode === 'test' }, logger));
        };
        if (isRefund && stage === 'succeeded') { await reverse('refund'); outcome = 'refund_reversed'; }
        else if (!isRefund && stage === 'opened') { await setEntitlementStatus(client, orig.account_id, 'on_hold', `dispute:${id}:opened`); outcome = 'dispute_hold'; }
        else if (!isRefund && (stage === 'won' || stage === 'cancelled')) { await setEntitlementStatus(client, orig.account_id, 'active', `dispute:${id}:${stage}`); outcome = 'dispute_released'; }
        else if (!isRefund && (stage === 'lost' || stage === 'accepted')) { await reverse('dispute'); outcome = 'dispute_reversed'; }
        else outcome = `${t}_noted`;
      }
    }

    await client.query('UPDATE pv2_webhook_events SET processed_at = NOW(), outcome = $2 WHERE webhook_id = $1', [webhookId, outcome]);
    await client.query('COMMIT');
    for (const fn of after) await fn();
    return { outcome, accountId };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Express handler: raw body → verify → process. 401 bad signature, 500 → Dodo retries. */
export function createDodoV2WebhookHandler(pool, { secret = webhookSecret, logger = console, ledger, mode } = {}) {
  return async (req, res) => {
    const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : String(req.body || '');
    const hdr = { id: req.get('webhook-id'), timestamp: req.get('webhook-timestamp'), signature: req.get('webhook-signature') };
    if (!verifyStandardWebhook(hdr, raw, secret())) return res.status(401).json({ ok: false, error: 'bad_signature' });
    let event;
    try { event = JSON.parse(raw); } catch { return res.status(400).json({ ok: false, error: 'bad_json' }); }
    try {
      const out = await processDodoEvent(pool, event, { webhookId: hdr.id, logger, ...(ledger ? { ledger } : {}), ...(mode ? { mode } : {}) });
      return res.json({ ok: true, ...out });
    } catch (err) {
      logger.error?.('[pricing-v2] webhook failed:', err.message);
      return res.status(500).json({ ok: false, error: 'processing_failed' });
    }
  };
}
