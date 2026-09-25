// /v1/me/* — the console's server-side account API (CONSOLE_ACCOUNTS_V1).
// Auth: the Better Auth session cookie (never an API key). The console calls
// these from its server, forwarding the browser's cookie; nothing here returns
// a full key except the one create/rotate response that issues it.
//
// CSRF: every mutation requires
//   · Content-Type: application/json,
//   · X-Satelink-Console: 1 (a custom header — a cross-site form or no-CORS
//     fetch cannot send it without a preflight our CORS policy refuses), and
//   · if an Origin header is present, a Better Auth trusted origin.
import express from 'express';
import { trustedOrigins, getBetterAuth } from '../auth/better_auth.mjs';
import { ensureConsoleAccountsSchema } from './schema.mjs';
import { AccountError, listKeys, createKey, linkKey, renameKey, revokeKey, rotateKey, withIdempotency } from './keys.mjs';
import { getSettings, updateSettings, setAgentLimits, spendSummary, listSavedQueries, saveQuery, deleteSavedQuery } from './settings.mjs';
import { listRequests, usageSeries, listDeposits } from './requests.mjs';
import { createChallenge, verifyAndLink, listWallets, unlinkWallet, x402ForWallet } from './wallets.mjs';
import { accountPlan } from '../pricing_v2/account_plan.mjs';
import { createCheckout, isPlanBillingV2Enabled } from '../pricing_v2/checkout.mjs';
import { isOnboardingEnabled, getOnboarding, submitStep, backTo, clientMeta, consentHistory } from './onboarding.mjs';

/** Default session resolver: Better Auth, from the request's cookies. */
export async function betterAuthSession(pool, req) {
  const auth = await getBetterAuth(pool);
  if (!auth) return null;
  const { fromNodeHeaders } = await import('better-auth/node');
  const s = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
  return s?.user ? { accountId: s.user.id, email: s.user.email, name: s.user.name ?? null } : null;
}

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function csrfGuard(req, res, next) {
  if (!MUTATING.has(req.method)) return next();
  if (req.get('x-satelink-console') !== '1') return res.status(403).json({ ok: false, error: 'csrf_header_missing' });
  const origin = req.get('origin');
  if (origin && !trustedOrigins().includes(origin)) return res.status(403).json({ ok: false, error: 'origin_not_allowed' });
  if (req.method !== 'DELETE' && !req.is('application/json')) return res.status(415).json({ ok: false, error: 'json_required' });
  return next();
}

const keyIdParam = (req) => {
  const n = Number(req.params.id);
  if (!Number.isInteger(n) || n <= 0) throw new AccountError('invalid_key_id', 400, 'Bad key id');
  return n;
};

const INTEL_METRICS = new Set(['funding-rate-heatmap', 'open-interest-shifts', 'liquidation-clusters', 'market-microstructure']);

export function createMeRouter(pool, {
  resolveSession = (req) => betterAuthSession(pool, req),
  logger = console,
  // Loopback to this same process: running a metric goes through the unchanged
  // /v1/intelligence route (same metering, same revenue row) with the key the
  // account owns — resolved here, never sent to the browser.
  intelBase = process.env.INTEL_LOOPBACK_BASE || `http://127.0.0.1:${process.env.PORT || 8080}`,
  fetchImpl = globalThis.fetch,
} = {}) {
  const router = express.Router();
  router.use(express.json({ limit: '16kb' }));
  router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  router.use(csrfGuard);

  router.use(async (req, res, next) => {
    try {
      await ensureConsoleAccountsSchema(pool, { logger });
      const session = await resolveSession(req);
      if (!session) return res.status(401).json({ ok: false, error: 'sign_in_required' });
      req.account = session;
      return next();
    } catch (err) {
      logger.error?.('[console-accounts] session/schema error:', err.message);
      return res.status(503).json({ ok: false, error: 'accounts_unavailable' });
    }
  });

  const h = (fn) => async (req, res) => {
    try {
      const out = await fn(req, res);
      if (!res.headersSent) res.status(out?.status ?? 200).json({ ok: true, data: out?.body ?? out });
    } catch (err) {
      if (err instanceof AccountError) return res.status(err.http).json({ ok: false, error: err.code, message: err.message, ...err.extra });
      logger.error?.('[console-accounts] error:', err.message);
      return res.status(500).json({ ok: false, error: 'internal_error' });
    }
  };
  const idem = (req, action, fn) => withIdempotency(pool, req.account.accountId, req.get('idempotency-key'), action, fn);
  const replayable = (res, out) => {
    if (out.replayed) res.set('Idempotent-Replayed', 'true');
    return { status: out.status, body: out.body };
  };

  router.get('/', h(async (req) => ({ accountId: req.account.accountId, email: req.account.email })));

  // Keys
  router.get('/keys', h((req) => listKeys(pool, req.account.accountId)));
  router.post('/keys', h(async (req, res) => replayable(res, await idem(req, 'key.create', async () => (
    { status: 201, body: await createKey(pool, req.account.accountId, { label: req.body?.label, role: req.body?.role }) }
  )))));
  router.post('/keys/link', h(async (req) => {
    const out = await linkKey(pool, req.account.accountId, { apiKey: req.body?.apiKey, label: req.body?.label, role: req.body?.role });
    return { status: out.alreadyLinked ? 200 : 201, body: out };
  }));
  router.patch('/keys/:id', h((req) => renameKey(pool, req.account.accountId, keyIdParam(req), req.body?.label)));
  router.post('/keys/:id/revoke', h((req) => revokeKey(pool, req.account.accountId, keyIdParam(req))));
  router.post('/keys/:id/rotate', h(async (req, res) => replayable(res, await idem(req, `key.rotate:${keyIdParam(req)}`, async () => (
    { status: 201, body: await rotateKey(pool, req.account.accountId, keyIdParam(req)) }
  )))));
  router.put('/keys/:id/limits', h((req) => setAgentLimits(pool, req.account.accountId, keyIdParam(req), req.body || {})));

  // Settings, spend, saved queries
  router.get('/settings', h((req) => getSettings(pool, req.account.accountId)));
  router.patch('/settings', h((req) => updateSettings(pool, req.account.accountId, req.body || {})));
  router.get('/spend', h((req) => spendSummary(pool, req.account.accountId)));
  router.get('/saved-queries', h((req) => listSavedQueries(pool, req.account.accountId)));
  router.post('/saved-queries', h(async (req) => ({ status: 201, body: await saveQuery(pool, req.account.accountId, req.body || {}) })));
  router.delete('/saved-queries/:qid', h((req) => deleteSavedQuery(pool, req.account.accountId, Number(req.params.qid))));

  // Pricing V2: current plan, UU windows, pack balance; Dodo checkout.
  router.get('/plan', h(async (req) => accountPlan(pool, req.account.accountId, { tz: (await getSettings(pool, req.account.accountId)).timezone })));
  router.post('/checkout', h(async (req) => {
    if (!isPlanBillingV2Enabled()) throw new AccountError('billing_v2_disabled', 404, 'Plan checkout is not enabled yet');
    const returnUrl = String(req.body?.returnUrl || 'https://console.satelink.network/billing?checkout=done');
    if (!/^https:\/\/(console\.)?satelink\.network\//.test(returnUrl) && !/^http:\/\/localhost:\d+\//.test(returnUrl)) {
      throw new AccountError('invalid_return_url', 400, 'Return URL must be a Satelink page');
    }
    return { status: 201, body: await createCheckout({ accountId: req.account.accountId, email: req.account.email, itemId: req.body?.itemId, returnUrl }) };
  }));

  // Onboarding (CONSOLE_ONBOARDING_V1): server-side, resumable first-run flow.
  const onboardingOn = (req, res, next) => (isOnboardingEnabled() ? next() : res.status(404).json({ ok: false, error: 'onboarding_disabled' }));
  router.get('/onboarding', onboardingOn, h((req) => getOnboarding(pool, req.account)));
  router.post('/onboarding/back', onboardingOn, h(async (req) => { await backTo(pool, req.account, req.body?.to); return getOnboarding(pool, req.account); }));
  router.post('/onboarding/:step', onboardingOn, h(async (req) => {
    const out = await submitStep(pool, req.account, req.params.step, req.body || {}, clientMeta(req));
    return out?.checkoutUrl ? out : getOnboarding(pool, req.account);
  }));

  // Per-request log
  router.get('/requests', h((req) => listRequests(pool, req.account.accountId, req.query)));
  router.get('/usage', h((req) => usageSeries(pool, req.account.accountId, { days: req.query.days })));
  router.get('/deposits', h((req) => listDeposits(pool, req.account.accountId)));

  // Resolve one of MY live keys (server-side only).
  const ownedKeyString = async (req, keyId) => (await pool.query(
    `SELECT c.api_key FROM account_api_keys l JOIN api_credits c ON c.id = l.api_key_id
      WHERE l.account_id = $1 AND l.api_key_id = $2 AND l.revoked_at IS NULL`,
    [req.account.accountId, keyId]
  )).rows[0]?.api_key ?? null;
  const loopback = async (res, path, key, init = {}) => {
    const r = await fetchImpl(`${intelBase}${path}`, {
      ...init,
      headers: { 'x-api-key': key, accept: 'application/json', ...(init.body ? { 'content-type': 'application/json' } : {}) },
      signal: AbortSignal.timeout(20000),
    });
    const body = await r.json().catch(() => ({ ok: false, error: 'bad_upstream_response' }));
    return res.status(r.status).json(body);
  };

  // USDT top-up for one of MY keys: instructions + claim by tx hash, through
  // the unchanged /api/keys deposit handlers (same on-chain verification).
  router.get('/keys/:id/deposit-info', async (req, res) => {
    try {
      const key = await ownedKeyString(req, Number(req.params.id));
      if (!key) return res.status(404).json({ ok: false, error: 'key_not_found' });
      return await loopback(res, '/api/keys/deposit-info', key);
    } catch { return res.status(502).json({ ok: false, error: 'deposit_unavailable' }); }
  });
  router.post('/keys/:id/deposit', async (req, res) => {
    try {
      const txHash = String(req.body?.txHash || '');
      if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) return res.status(400).json({ ok: false, error: 'invalid_tx_hash' });
      const key = await ownedKeyString(req, Number(req.params.id));
      if (!key) return res.status(404).json({ ok: false, error: 'key_not_found' });
      return await loopback(res, '/api/keys/deposit', key, { method: 'POST', body: JSON.stringify({ tx_hash: txHash }) });
    } catch { return res.status(502).json({ ok: false, error: 'deposit_unavailable' }); }
  });

  // Run a paid Trading Intelligence metric with one of MY keys (console
  // "Get market data"). The price is charged to that key exactly as a direct
  // API call would be; owner controls (pause, scopes, caps) apply.
  router.post('/intelligence/:metric', async (req, res) => {
    try {
      const metric = req.params.metric;
      if (!INTEL_METRICS.has(metric)) return res.status(404).json({ ok: false, error: 'unknown_metric' });
      const keyId = Number(req.body?.keyId);
      if (!Number.isInteger(keyId) || keyId <= 0) return res.status(400).json({ ok: false, error: 'invalid_key_id' });
      const row = (await pool.query(
        `SELECT c.api_key FROM account_api_keys l JOIN api_credits c ON c.id = l.api_key_id
          WHERE l.account_id = $1 AND l.api_key_id = $2 AND l.revoked_at IS NULL`,
        [req.account.accountId, keyId]
      )).rows[0];
      if (!row) return res.status(404).json({ ok: false, error: 'key_not_found' });
      const r = await fetchImpl(`${intelBase}/v1/intelligence/${metric}`, { headers: { 'x-api-key': row.api_key, accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
      const body = await r.json().catch(() => ({ ok: false, error: 'bad_upstream_response' }));
      return res.status(r.status).json(body);
    } catch (err) {
      logger.error?.('[console-accounts] intelligence run failed:', err.message);
      return res.status(502).json({ ok: false, error: 'intelligence_unavailable' });
    }
  });

  // Wallets + x402
  router.get('/wallets', h((req) => listWallets(pool, req.account.accountId)));
  router.post('/wallets/challenge', h((req) => createChallenge(pool, req.account.accountId, req.body || {})));
  router.post('/wallets/verify', h(async (req) => ({ status: 201, body: await verifyAndLink(pool, req.account.accountId, req.body || {}) })));
  router.delete('/wallets/:address', h((req) => unlinkWallet(pool, req.account.accountId, req.params.address)));
  router.get('/x402', h((req) => x402ForWallet(pool, req.account.accountId, req.query.wallet, { days: req.query.days })));

  // Data export (DPDP/GDPR-style): everything this module holds for the account.
  router.get('/export', h(async (req) => {
    const id = req.account.accountId;
    const [keys, settings, wallets, queries, audit] = await Promise.all([
      listKeys(pool, id), getSettings(pool, id), listWallets(pool, id), listSavedQueries(pool, id),
      pool.query('SELECT action, subject, detail, created_at FROM account_audit WHERE account_id = $1 ORDER BY created_at DESC LIMIT 1000', [id]).then((r) => r.rows),
    ]);
    const consents = await consentHistory(pool, id);
    return { exportedAt: new Date().toISOString(), account: req.account, keys, settings, wallets, savedQueries: queries, audit, consents };
  }));

  return router;
}
