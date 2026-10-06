// /billing/* + POST /webhooks/razorpay (Stage 27). Behind the SUBSCRIPTIONS flag (off ⇒ 404 for
// every route, checked per request). /billing reuses the Stage 24 middleware: authentication with
// tenant checks, CSRF for session mutations, human-only mutations, rate limits, Idempotency-Key.
// The webhook needs the RAW body (signature) and is authenticated by its HMAC, not a session.
// NOT registered in app_factory.mjs (blocker register: B-03/B-06/B-10; founder Option A, 2026-10-06).
import express from 'express';
import { isTradingFlagEnabled } from '../flags.mjs';
import { flagGate, authenticate, csrfGuard, humanForMutations, rateLimiter, idempotency, wrap, InMemoryIdempotencyStore } from '../api/middleware.mjs';
import { statusFor } from '../api/errors.mjs';

export const BILLING_ROUTES = Object.freeze([
  ['GET', '/billing/plans'], ['GET', '/billing/subscription'], ['POST', '/billing/subscriptions'], ['POST', '/billing/subscription/preview-change'],
  ['POST', '/billing/subscription/change-plan'], ['POST', '/billing/subscription/cancel'], ['GET', '/billing/invoices'], ['POST', '/webhooks/razorpay'],
]);

const BILLING_STATUS = Object.freeze({ GATEWAY_UNAVAILABLE: 503, GATEWAY_AMBIGUOUS: 502, GATEWAY_AUTH: 502, GATEWAY_REJECTED: 422, LEDGER_NOT_APPROVED: 503, SIGNATURE_INVALID: 401 });
const json = (v) => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x)));
const fail = (res, e) => {
  const status = BILLING_STATUS[e?.code] ?? statusFor(e?.code);
  const safe = status < 500 || ['GATEWAY_UNAVAILABLE', 'GATEWAY_AMBIGUOUS', 'GATEWAY_AUTH', 'LEDGER_NOT_APPROVED'].includes(e?.code);
  res.status(status).json({ ok: false, error: { code: safe ? e.code : 'INTERNAL', message: safe ? String(e.message) : 'internal error' } });
};
const handle = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => fail(res, e));

export function createBillingRouter({ env = {}, resolvePrincipal, service, idempotencyStore = new InMemoryIdempotencyStore(), clock = () => new Date(), trustedOrigins = [], limits }) {
  const r = express.Router();
  const limit = rateLimiter({ clock, limits });
  r.use(flagGate('SUBSCRIPTIONS', env), express.json({ limit: '16kb' }), authenticate(resolvePrincipal), csrfGuard({ trustedOrigins }), humanForMutations());
  r.use((req, res, next) => (req.method === 'GET' ? limit('read')(req, res, next) : limit('write')(req, res, next)));
  r.use(idempotency({ store: idempotencyStore, clock }));
  const P = (req) => req.principal.principalId;
  r.get('/plans', handle(async (_req, res) => res.json({ ok: true, data: json(service.plans()) })));
  r.get('/subscription', handle(async (req, res) => res.json({ ok: true, data: json(await service.current(P(req))) })));
  r.post('/subscriptions', handle(async (req, res) => res.status(201).json({ ok: true, data: json(await service.start(P(req), { planId: req.body?.planId })) })));
  r.post('/subscription/preview-change', handle(async (req, res) => res.json({ ok: true, data: json(await service.previewChange(P(req), { planId: req.body?.planId, scheduleChangeAt: req.body?.scheduleChangeAt })) })));
  r.post('/subscription/change-plan', handle(async (req, res) => res.status(202).json({ ok: true, data: json(await service.changePlan(P(req), { planId: req.body?.planId, scheduleChangeAt: req.body?.scheduleChangeAt })) })));
  r.post('/subscription/cancel', handle(async (req, res) => res.status(202).json({ ok: true, data: json(await service.cancel(P(req), { atCycleEnd: req.body?.atCycleEnd !== false })) })));
  r.get('/invoices', handle(async (req, res) => res.json({ ok: true, data: json(await service.listInvoices(P(req))) })));
  return r;
}

export function createRazorpayWebhookHandler({ env = {}, service }) {
  return [
    flagGate('SUBSCRIPTIONS', env),
    express.raw({ type: '*/*', limit: '256kb' }),
    handle(async (req, res) => {
      const out = await service.handleWebhook({ rawBody: Buffer.isBuffer(req.body) ? req.body : Buffer.from(''), signature: req.get('x-razorpay-signature'), eventId: req.get('x-razorpay-event-id') });
      res.status(200).json({ ok: true, data: json(out) });
    }),
  ];
}

/** One-call registration (awaiting the founder decision; not called from app_factory.mjs). */
export function mountBillingRoutes(app, deps) {
  if (!isTradingFlagEnabled('SUBSCRIPTIONS', deps.env ?? {})) return { mounted: false, reason: 'SUBSCRIPTIONS flag is off' };
  app.use('/billing', createBillingRouter(deps));
  app.post('/webhooks/razorpay', ...createRazorpayWebhookHandler(deps));
  return { mounted: true };
}
