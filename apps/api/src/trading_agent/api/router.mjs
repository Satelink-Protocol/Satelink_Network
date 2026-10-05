// /v1/trading REST API (Stage 24). Every route sits behind TRADING_AGENT (flag off ⇒ 404) and:
//   authentication (principal from the session / API key only; body/query principalId must match),
//   rate limits per principal, CSRF for session mutations, Idempotency-Key on every mutation,
//   human-only mutations (agents use MCP: read + propose), step-up on sign/approve/release,
//   tenant checks (services are called with the authenticated principal; any returned resource
//   owned by someone else is reported as 404).
// Services are injected ports (see ./ports.mjs); nothing here touches a broker, the ledger or env.
import express from 'express';
import { isTradingFlagEnabled, tradingFlagSnapshot } from '../flags.mjs';
import { ApiError } from './errors.mjs';
import { flagGate, authenticate, csrfGuard, humanForMutations, rateLimiter, idempotency, requireStepUp, wrap, InMemoryIdempotencyStore } from './middleware.mjs';
import { createMcpHandler } from './mcp.mjs';

/** The route table (method, path, step-up?) — the OpenAPI contract test checks it both ways. */
export const ROUTES = Object.freeze([
  ['GET', '/status'],
  ['POST', '/strategies'], ['POST', '/strategies/:strategyId/versions'], ['GET', '/strategy-versions/:versionId'], ['POST', '/strategy-versions/:versionId/transitions'],
  ['POST', '/backtests'], ['GET', '/backtests/:backtestId'],
  ['GET', '/risk/policy'], ['POST', '/risk/policies'],
  ['GET', '/kill-switch'], ['POST', '/kill-switch/engage'], ['POST', '/kill-switch/release', 'step-up'],
  ['POST', '/mandates'], ['GET', '/mandates/:mandateId'], ['POST', '/mandates/:mandateId/sign', 'step-up'], ['POST', '/mandates/:mandateId/revoke'],
  ['GET', '/orders'], ['POST', '/orders'], ['GET', '/orders/:orderId'], ['POST', '/orders/:orderId/cancel'], ['GET', '/orders/:orderId/receipt'],
  ['GET', '/positions'], ['GET', '/portfolio/snapshots'],
  ['GET', '/proposals'], ['POST', '/proposals/:proposalId/approve', 'step-up'], ['POST', '/proposals/:proposalId/reject'],
  ['POST', '/mcp'],
].map(([method, path, stepUp]) => Object.freeze({ method, path, stepUp: stepUp === 'step-up' })));

const ok = (res, data, status = 200) => res.status(status).json({ ok: true, data });
/** Defence in depth: a resource that names another owner is "not found" for this principal. */
const owned = (principal, data) => {
  if (data && typeof data === 'object' && typeof data.principalId === 'string' && data.principalId !== principal.principalId) throw new ApiError(404, 'NOT_FOUND', 'not found');
  return data;
};

/**
 * @param deps.env              flag environment (never read from process.env here)
 * @param deps.resolvePrincipal async req → principal | null
 * @param deps.services         ports (./ports.mjs)
 * @param deps.stepUp           { verify({principalId, code, request}) → {ok, method} }
 * @param deps.idempotencyStore { begin, complete, release } (default in-memory)
 * @param deps.mcp              { registryFor(principal), runIdFactory() } | null
 */
export function createTradingApiRouter({ env = {}, resolvePrincipal, services, stepUp, idempotencyStore = new InMemoryIdempotencyStore(), clock = () => new Date(), trustedOrigins = [], limits, mcp = null }) {
  if (typeof resolvePrincipal !== 'function' || !services || typeof stepUp?.verify !== 'function') throw new TypeError('createTradingApiRouter needs resolvePrincipal, services and stepUp');
  const r = express.Router();
  const limit = rateLimiter({ clock, limits });
  r.use(flagGate('TRADING_AGENT', env));
  r.use(express.json({ limit: '64kb' }));
  r.use(authenticate(resolvePrincipal));

  // ── MCP: its own flag; JSON-RPC (no Idempotency-Key); agents allowed — tools are read/propose only.
  const mcpHandler = mcp ? createMcpHandler(mcp) : null;
  r.post('/mcp', flagGate('MCP_TRADING', env), limit('write'), wrap(async (req, res) => {
    if (!mcpHandler) throw new ApiError(404, 'NOT_FOUND', 'not found');
    return mcpHandler(req, res);
  }));

  r.use(csrfGuard({ trustedOrigins }), humanForMutations());
  r.use((req, res, next) => (req.method === 'GET' ? limit('read')(req, res, next) : limit('write')(req, res, next)));
  r.use(idempotency({ store: idempotencyStore, clock }));
  const stepUpRoute = [limit('stepUp'), requireStepUp(stepUp)];
  const S = services;
  const P = (req) => req.principal;

  r.get('/status', wrap(async (_req, res) => ok(res, { flags: tradingFlagSnapshot(env), mcp: isTradingFlagEnabled('MCP_TRADING', env) && Boolean(mcp) })));

  r.post('/strategies', wrap(async (req, res) => ok(res, owned(P(req), await S.strategies.create(P(req), req.body)), 201)));
  r.post('/strategies/:strategyId/versions', wrap(async (req, res) => ok(res, owned(P(req), await S.strategies.addVersion(P(req), req.params.strategyId, req.body)), 201)));
  r.get('/strategy-versions/:versionId', wrap(async (req, res) => ok(res, owned(P(req), await S.strategies.getVersion(P(req), req.params.versionId)))));
  r.post('/strategy-versions/:versionId/transitions', wrap(async (req, res) => ok(res, owned(P(req), await S.strategies.transition(P(req), req.params.versionId, req.body)))));

  r.post('/backtests', wrap(async (req, res) => ok(res, owned(P(req), await S.backtests.enqueue(P(req), req.body)), 202)));
  r.get('/backtests/:backtestId', wrap(async (req, res) => ok(res, owned(P(req), await S.backtests.get(P(req), req.params.backtestId)))));

  r.get('/risk/policy', wrap(async (req, res) => ok(res, owned(P(req), await S.risk.activePolicy(P(req))))));
  r.post('/risk/policies', wrap(async (req, res) => ok(res, owned(P(req), await S.risk.createVersion(P(req), req.body)), 201)));

  r.get('/kill-switch', wrap(async (req, res) => ok(res, await S.killSwitch.engaged(P(req)))));
  r.post('/kill-switch/engage', wrap(async (req, res) => ok(res, await S.killSwitch.engage(P(req), req.body), 201)));
  r.post('/kill-switch/release', ...stepUpRoute, wrap(async (req, res) => ok(res, await S.killSwitch.release(P(req), req.body), 201)));

  r.post('/mandates', wrap(async (req, res) => ok(res, owned(P(req), await S.mandates.propose(P(req), req.body)), 201)));
  r.get('/mandates/:mandateId', wrap(async (req, res) => ok(res, owned(P(req), await S.mandates.get(P(req), req.params.mandateId)))));
  // Signing verifies the step-up code INSIDE the Stage 16 service (reuse window, attempt limits),
  // so the route only requires the header and forwards it — never verifies the same code twice.
  r.post('/mandates/:mandateId/sign', limit('stepUp'), wrap(async (req, res) => {
    const code = req.get('x-satelink-step-up');
    if (!code) throw new ApiError(401, 'STEP_UP_REQUIRED', 'signing needs step-up verification (X-Satelink-Step-Up)');
    return ok(res, owned(P(req), await S.mandates.sign(P(req), req.params.mandateId, req.body, code, { ip: req.ip, userAgent: req.get('user-agent') ?? null })));
  }));
  r.post('/mandates/:mandateId/revoke', wrap(async (req, res) => ok(res, owned(P(req), await S.mandates.revoke(P(req), req.params.mandateId, req.body)))));

  r.get('/orders', wrap(async (req, res) => ok(res, await S.orders.list(P(req), req.query))));
  r.post('/orders', wrap(async (req, res) => {
    const out = await S.orders.accept(P(req), req.body, req.idempotencyKey);
    if (out?.accepted === false) throw new ApiError(422, 'REFUSED', `${out.reason}: ${out.detail ?? ''}`.trim());
    return ok(res, out, out?.duplicate ? 200 : 201);
  }));
  r.get('/orders/:orderId', wrap(async (req, res) => ok(res, owned(P(req), await S.orders.get(P(req), req.params.orderId)))));
  r.post('/orders/:orderId/cancel', wrap(async (req, res) => ok(res, owned(P(req), await S.orders.requestCancel(P(req), req.params.orderId)), 202)));
  r.get('/orders/:orderId/receipt', wrap(async (req, res) => ok(res, await S.receipts.explain(P(req), req.params.orderId))));

  r.get('/positions', wrap(async (req, res) => ok(res, await S.portfolio.positions(P(req), req.query))));
  r.get('/portfolio/snapshots', wrap(async (req, res) => ok(res, await S.portfolio.snapshots(P(req), req.query))));

  r.get('/proposals', wrap(async (req, res) => ok(res, await S.proposals.list(P(req), req.query))));
  r.post('/proposals/:proposalId/approve', ...stepUpRoute, wrap(async (req, res) => ok(res, await S.proposals.approve(P(req), req.params.proposalId, req.body, req.idempotencyKey), 201)));
  r.post('/proposals/:proposalId/reject', wrap(async (req, res) => ok(res, await S.proposals.reject(P(req), req.params.proposalId, req.body))));

  r.use((_req, res) => res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'not found' } }));
  // Malformed / oversized JSON from express.json(): a 4xx envelope, never an HTML stack page.
  r.use((err, _req, res, _next) => { // eslint-disable-line no-unused-vars
    const status = err?.status === 413 ? 413 : 400;
    res.status(status).json({ ok: false, error: { code: status === 413 ? 'PAYLOAD_TOO_LARGE' : 'BAD_REQUEST', message: status === 413 ? 'request body too large' : 'malformed JSON body' } });
  });
  return r;
}
