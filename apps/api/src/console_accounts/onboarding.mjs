// Console onboarding (CONSOLE_ONBOARDING_V1, default OFF) — the claude.ai-style
// first-run flow: create account (consents) → name → use → plan → review →
// payment → safety → done. State lives HERE (server side), so the flow resumes
// on any browser at the step the account reached.
//
// Consent records are append-only (a withdrawal is a new row with granted =
// false): purpose, the exact document + version shown, timestamp, IP and user
// agent. The IP is the browser's, forwarded by the console server
// (X-Satelink-Client-IP); `ip_source` says where it came from.
//
// Payment is "confirmed" only from webhook-written state (pv2_entitlements /
// pv2_subscriptions via /webhooks/dodo/v2) — never from the return URL.
import { AccountError } from './keys.mjs';
import { updateSettings } from './settings.mjs';
import { loadCatalog, publicCatalog } from '../pricing_v2/catalog.mjs';
import { createCheckout } from '../pricing_v2/checkout.mjs';
import { ensurePricingV2Schema } from '../pricing_v2/schema.mjs';
import { dodoMode } from '../pricing_v2/webhooks.mjs';

export function isOnboardingEnabled() {
  return process.env.CONSOLE_ONBOARDING_V1 === 'true';
}

// The documents a consent refers to, and their CURRENT versions. Must match
// apps/web/src/lib/legal.ts (a test enforces it). Bump both together.
export const LEGAL_DOCS = {
  terms: { version: '2.0', url: 'https://satelink.network/terms' },
  'acceptable-use': { version: '2.0', url: 'https://satelink.network/acceptable-use' },
  privacy: { version: '2.0', url: 'https://satelink.network/privacy' },
  'billing-policy': { version: '1.0', url: 'https://satelink.network/billing-policy' },
};

export const STEPS = ['account', 'name', 'use', 'plan', 'review', 'payment', 'safety', 'done'];

export const TASKS = ['market-data', 'agent-access', 'add-money', 'spend', 'rpc'];

// "What will you use Satelink for?" → recommended plan + three first tasks.
export const USE_CASES = {
  automated_trading: { plan: 'pro', tasks: ['market-data', 'agent-access', 'spend'] },
  ai_agent: { plan: 'launch', tasks: ['agent-access', 'market-data', 'add-money'] },
  research: { plan: 'free', tasks: ['market-data', 'spend', 'add-money'] },
  product_at_scale: { plan: 'max', tasks: ['agent-access', 'add-money', 'spend'] },
  blockchain_rpc: { plan: 'free', tasks: ['rpc', 'agent-access', 'add-money'] },
};

export const DEFAULT_SPEND_CAP_USD = 25;

export const ONBOARDING_DDL = `
CREATE TABLE IF NOT EXISTS account_onboarding (
  account_id          TEXT PRIMARY KEY,
  step                TEXT        NOT NULL DEFAULT 'account',
  legacy              BOOLEAN     NOT NULL DEFAULT false,
  display_name        TEXT,
  use_case            TEXT,
  first_task          TEXT,
  plan_id             TEXT,
  period              TEXT CHECK (period IN ('month', 'year')),
  item_id             TEXT,
  checkout_session_id TEXT,
  advice_ack_at       TIMESTAMPTZ,
  data_ack_at         TIMESTAMPTZ,
  completed_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS consent_records (
  id               BIGSERIAL PRIMARY KEY,
  account_id       TEXT        NOT NULL,
  purpose          TEXT        NOT NULL,
  granted          BOOLEAN     NOT NULL,
  document         TEXT,
  document_version TEXT,
  detail           JSONB       NOT NULL DEFAULT '{}'::jsonb,
  ip               TEXT,
  ip_source        TEXT,
  user_agent       TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS consent_records_account ON consent_records (account_id, purpose, created_at DESC);
`;

let ensured = null;
export function ensureOnboardingSchema(pool) {
  if (!ensured) ensured = pool.query(ONBOARDING_DDL).catch((e) => { ensured = null; throw e; });
  return ensured;
}
export function __resetOnboardingSchema() { ensured = null; }

/** The browser's IP/UA as forwarded by the console server, else the socket's. */
export function clientMeta(req) {
  const fwd = req.get('x-satelink-client-ip');
  return {
    ip: (fwd || req.ip || '').slice(0, 64) || null,
    ipSource: fwd ? 'console_forwarded' : 'socket',
    userAgent: (req.get('x-satelink-client-ua') || req.get('user-agent') || '').slice(0, 300) || null,
  };
}

const bad = (code, message) => new AccountError(code, 400, message);
const idx = (s) => STEPS.indexOf(s);

async function row(pool, accountId) {
  await ensureOnboardingSchema(pool);
  let r = (await pool.query('SELECT * FROM account_onboarding WHERE account_id = $1', [accountId])).rows[0];
  if (!r) {
    // An account that already had keys before onboarding existed only records
    // consent and safety settings — it is not walked through plan selection.
    const keys = await pool.query(
      `SELECT 1 FROM account_api_keys WHERE account_id = $1 LIMIT 1`, [accountId]
    ).then((x) => x.rowCount > 0).catch(() => false);
    r = (await pool.query(
      `INSERT INTO account_onboarding (account_id, legacy) VALUES ($1, $2)
       ON CONFLICT (account_id) DO UPDATE SET account_id = EXCLUDED.account_id RETURNING *`,
      [accountId, keys]
    )).rows[0];
  }
  return r;
}

async function setStep(pool, accountId, step, fields = {}) {
  const cols = Object.keys(fields);
  const sets = cols.map((c, i) => `${c} = $${i + 3}`);
  const r = await pool.query(
    `UPDATE account_onboarding SET step = $2, ${sets.length ? sets.join(', ') + ',' : ''} updated_at = NOW() WHERE account_id = $1 RETURNING *`,
    [accountId, step, ...cols.map((c) => fields[c])]
  );
  return r.rows[0];
}

async function recordConsent(client, accountId, meta, { purpose, granted, document = null, detail = {} }) {
  await client.query(
    `INSERT INTO consent_records (account_id, purpose, granted, document, document_version, detail, ip, ip_source, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [accountId, purpose, granted, document, document ? LEGAL_DOCS[document].version : null, JSON.stringify(detail), meta.ip, meta.ipSource, meta.userAgent]
  );
}

/** Latest consent per purpose. */
export async function latestConsents(pool, accountId) {
  await ensureOnboardingSchema(pool);
  const r = await pool.query(
    `SELECT DISTINCT ON (purpose) purpose, granted, document, document_version, created_at
       FROM consent_records WHERE account_id = $1 ORDER BY purpose, created_at DESC, id DESC`,
    [accountId]
  );
  return Object.fromEntries(r.rows.map((x) => [x.purpose, { granted: x.granted, document: x.document, version: x.document_version, at: x.created_at }]));
}

export async function consentHistory(pool, accountId) {
  await ensureOnboardingSchema(pool);
  return (await pool.query(
    `SELECT purpose, granted, document, document_version, detail, ip, created_at FROM consent_records WHERE account_id = $1 ORDER BY created_at, id`,
    [accountId]
  )).rows;
}

/** Catalog item for (plan, period), or an error the UI can show. */
export function itemFor(planId, period, catalog = loadCatalog()) {
  const pub = publicCatalog(catalog, { mode: dodoMode() });
  const base = pub.plans.find((p) => p.id === planId && !p.basePlanId);
  if (!base) throw bad('unknown_plan', 'Choose one of the listed plans');
  if (base.kind === 'free') return base;
  if (period === 'year') {
    const y = pub.plans.find((p) => p.basePlanId === planId && p.interval === 'year');
    if (!y) throw bad('no_yearly', `${base.name} is billed monthly only`);
    return y;
  }
  return base;
}

/** Webhook-state payment status for the chosen item (never the return URL). */
async function paymentStatus(pool, accountId, itemId) {
  await ensurePricingV2Schema(pool);
  const ent = (await pool.query('SELECT plan_id, status FROM pv2_entitlements WHERE account_id = $1', [accountId])).rows[0];
  if (ent && ent.plan_id === itemId && ent.status === 'active') return 'confirmed';
  const sub = (await pool.query(
    `SELECT status FROM pv2_subscriptions WHERE account_id = $1 AND plan_id = $2 ORDER BY updated_at DESC LIMIT 1`,
    [accountId, itemId]
  )).rows[0];
  if (sub && ['failed', 'on_hold', 'cancelled', 'expired'].includes(sub.status)) return 'failed';
  return 'pending';
}

function view(r, session, consents, payment) {
  const uc = r.use_case ? USE_CASES[r.use_case] : null;
  return {
    step: r.step,
    legacy: r.legacy,
    displayName: r.display_name ?? session.name ?? '',
    email: session.email ?? null,
    useCase: r.use_case,
    firstTask: r.first_task,
    suggestedTasks: uc ? uc.tasks : [],
    recommendedPlan: uc ? uc.plan : null,
    planId: r.plan_id,
    period: r.period,
    itemId: r.item_id,
    payment,
    consents,
    documents: LEGAL_DOCS,
    spendCapDefaultUsd: DEFAULT_SPEND_CAP_USD,
    completedAt: r.completed_at,
  };
}

export async function getOnboarding(pool, session) {
  let r = await row(pool, session.accountId);
  let payment = null;
  if (r.step === 'payment' && r.item_id) {
    payment = await paymentStatus(pool, session.accountId, r.item_id);
    if (payment === 'confirmed') r = await setStep(pool, session.accountId, 'safety');
  }
  return view(r, session, await latestConsents(pool, session.accountId), payment);
}

/** A step may be (re)submitted if the account has reached it. */
function assertReached(r, step) {
  if (r.step === 'done') throw new AccountError('onboarding_complete', 409, 'Onboarding is already complete');
  if (idx(step) > idx(r.step)) throw new AccountError('step_not_reached', 409, 'Finish the earlier steps first');
}

export async function submitStep(pool, session, step, body = {}, meta = { ip: null, ipSource: null, userAgent: null }) {
  const id = session.accountId;
  const r = await row(pool, id);
  if (!STEPS.includes(step) || step === 'done' || step === 'payment') throw new AccountError('unknown_step', 404, 'No such step');
  assertReached(r, step);
  if (r.legacy && !['account', 'safety'].includes(step)) throw new AccountError('step_not_applicable', 409, 'Not part of this account\'s setup');

  if (step === 'account') {
    if (body.termsAup !== true) throw bad('terms_required', 'Accept the Terms of Service and Acceptable Use Policy to continue');
    if (body.age18 !== true) throw bad('age_required', 'Confirm you are 18 or older to continue');
    if (body.dpdp !== true) throw bad('dpdp_required', 'Consent to the processing described in the privacy notice to continue');
    if (typeof body.productUpdates !== 'boolean') throw bad('product_updates_choice', 'productUpdates must be true or false');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await recordConsent(client, id, meta, { purpose: 'terms', granted: true, document: 'terms' });
      await recordConsent(client, id, meta, { purpose: 'acceptable_use', granted: true, document: 'acceptable-use' });
      await recordConsent(client, id, meta, { purpose: 'age_18_plus', granted: true, document: 'terms' });
      await recordConsent(client, id, meta, { purpose: 'dpdp_processing', granted: true, document: 'privacy' });
      await recordConsent(client, id, meta, { purpose: 'product_updates', granted: body.productUpdates, document: 'privacy' });
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
    return setStep(pool, id, idx(r.step) > idx('account') ? r.step : (r.legacy ? 'safety' : 'name'));
  }

  if (step === 'name') {
    const name = String(body.name ?? '').trim().replace(/\s+/g, ' ');
    if (!name || name.length > 80) throw bad('invalid_name', 'Enter a name up to 80 characters');
    // Keep the Better Auth profile in step, when this database holds it.
    const hasUser = (await pool.query(`SELECT to_regclass('"user"') AS t`)).rows[0].t;
    if (hasUser) await pool.query('UPDATE "user" SET name = $2, "updatedAt" = NOW() WHERE id = $1', [id, name]).catch(() =>
      pool.query('UPDATE "user" SET name = $2 WHERE id = $1', [id, name]));
    return setStep(pool, id, idx(r.step) > idx('name') ? r.step : 'use', { display_name: name });
  }

  if (step === 'use') {
    const uc = USE_CASES[body.useCase];
    if (!uc) throw bad('invalid_use_case', 'Choose what you will use Satelink for');
    const task = body.firstTask;
    if (task !== 'explore' && !uc.tasks.includes(task)) throw bad('invalid_first_task', 'Choose a first task or "I\'ll explore myself"');
    return setStep(pool, id, idx(r.step) > idx('use') ? r.step : 'plan', { use_case: body.useCase, first_task: task });
  }

  if (step === 'plan') {
    const period = body.period === 'year' ? 'year' : 'month';
    const item = itemFor(body.planId, period);
    if (item.kind === 'free') return setStep(pool, id, 'safety', { plan_id: 'free', period: null, item_id: 'free', checkout_session_id: null });
    if (!item.purchasable) throw new AccountError('not_purchasable', 409, 'This plan is not available to buy yet');
    return setStep(pool, id, 'review', { plan_id: body.planId, period, item_id: item.id, checkout_session_id: null });
  }

  if (step === 'review') {
    if (!r.item_id || r.item_id === 'free') throw new AccountError('no_paid_plan', 409, 'Choose a paid plan first');
    if (body.authoriseRecurring !== true) throw bad('authorisation_required', 'Authorise recurring charges to continue');
    const item = itemFor(r.plan_id, r.period);
    // Same rule as POST /v1/me/checkout: Dodo only ever returns to a Satelink page.
    const returnUrl = String(body.returnUrl || 'https://console.satelink.network/welcome?checkout=done');
    if (!/^https:\/\/(console\.)?satelink\.network\//.test(returnUrl) && !/^http:\/\/localhost:\d+\//.test(returnUrl)) {
      throw bad('invalid_return_url', 'Return URL must be a Satelink page');
    }
    const out = await createCheckout({ accountId: id, email: session.email, itemId: item.id, returnUrl });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await recordConsent(client, id, meta, {
        purpose: 'recurring_charges', granted: true, document: 'billing-policy',
        detail: { itemId: item.id, priceUsd: item.priceUsd, interval: item.interval, intro: item.intro, checkoutSessionId: out.sessionId, mode: out.mode },
      });
      await client.query(
        `UPDATE account_onboarding SET step = 'payment', checkout_session_id = $2, updated_at = NOW() WHERE account_id = $1`,
        [id, out.sessionId]
      );
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
    return { checkoutUrl: out.checkoutUrl };
  }

  // safety
  if (body.adviceAck !== true) throw bad('advice_ack_required', 'Confirm you understand this is not investment advice');
  if (body.dataAck !== true) throw bad('data_ack_required', 'Confirm you have read how your data is used');
  const cap = body.spendCap || {};
  const amount = Number(cap.amountUsd);
  if (cap.enabled === true && !(amount > 0 && amount <= 100000)) throw bad('invalid_spend_cap', 'Enter a monthly limit between $1 and $100,000');
  await updateSettings(pool, id, { monthlySpendCapUsdt: cap.enabled === true ? amount : null });
  await pool.query(
    `INSERT INTO account_audit (account_id, action, subject, detail) VALUES ($1, 'onboarding.complete', NULL, $2)`,
    [id, JSON.stringify({ spendCap: cap.enabled === true ? amount : null, plan: r.item_id })]
  );
  return setStep(pool, id, 'done', { advice_ack_at: new Date(), data_ack_at: new Date(), completed_at: new Date() });
}

/** From review/payment the customer may go back and pick another plan. */
export async function backTo(pool, session, to) {
  const r = await row(pool, session.accountId);
  if (r.step === 'done') throw new AccountError('onboarding_complete', 409, 'Onboarding is already complete');
  if (!STEPS.includes(to) || ['payment', 'done'].includes(to) || idx(to) > idx(r.step)) throw bad('invalid_back', 'Cannot go there');
  if (r.legacy && !['account', 'safety'].includes(to)) throw bad('invalid_back', 'Cannot go there');
  return setStep(pool, session.accountId, to);
}

