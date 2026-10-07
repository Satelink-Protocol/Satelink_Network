import { expect } from 'chai';
import express from 'express';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mountTradingRoutes, TRADING_MOUNT_PATH } from '../src/trading_agent/index.mjs';
import { ROUTES, createServicePorts, InMemoryIdempotencyStore, MCP_PROTOCOL_VERSION } from '../src/trading_agent/api/index.mjs';
import { StrategyService, InMemoryStrategyStore } from '../src/trading_agent/strategies/index.mjs';
import { OrderAcceptanceService, InMemoryOmsStore } from '../src/trading_agent/oms/index.mjs';
import { ToolRegistry, createDefaultTools, defineTool, ToolTier } from '../src/trading_agent/agent/index.mjs';

// Stage 24 — /v1/trading REST API + MCP. In-process (supertest); no network, no DB, no process.env.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const OPENAPI = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/trading-agent/api/trading-v1.openapi.json'), 'utf8'));
const API_DIR = path.resolve(HERE, '../src/trading_agent/api');
const ON = Object.freeze({ TRADING_FLAG_TRADING_AGENT: 'true', TRADING_FLAG_MCP_TRADING: 'true' });
const T0 = Date.UTC(2026, 9, 6, 9, 0);
const DSL = { dsl: 'satelink.strategy/1.0', name: 'SMA cross', universe: { venue: 'binance', instruments: ['BTC-USDT'] }, timeframe: '1h',
  indicators: { fast: { type: 'sma', period: 10 }, slow: { type: 'sma', period: 30 } },
  entry: { cross: { dir: 'above', left: { ind: 'fast' }, right: { ind: 'slow' } } }, exit: { cross: { dir: 'below', left: { ind: 'fast' }, right: { ind: 'slow' } } },
  position: { side: 'long', sizing: { mode: 'fixed_notional', notional: '100.00', currency: 'USDT' } }, risk: { stopLossPct: '2' } };
const TERMS = `sha256:${'a'.repeat(64)}`;
const USERS = {
  'session-alice': { principalId: 'prn_alice', kind: 'human', via: 'session' },
  'session-bob': { principalId: 'prn_bob', kind: 'human', via: 'session' },
  'key-alice': { principalId: 'prn_alice', kind: 'human', via: 'api_key' },
  'agent-alice': { principalId: 'prn_alice', kind: 'agent', via: 'api_key' },
};

/** Builds the app the way the composition root would (real Stage 13 + 17 services, fakes elsewhere). */
function rig({ env = ON, limits, mcpEnabled = true } = {}) {
  const t = { now: T0 };
  const clock = () => new Date(t.now);
  let n = 0;
  const ids = (p) => `${p}_${String(++n).padStart(6, '0')}`;
  const strategyStore = new InMemoryStrategyStore();
  const strategyService = new StrategyService({ store: strategyStore, idFactory: ids, env: { TRADING_FLAG_TRADING_AGENT: 'true' }, clock });
  const omsStore = new InMemoryOmsStore();
  const calls = { sign: [], stepUp: [], proposals: [], release: [], receipts: [] };
  const mandate = { principalId: 'prn_alice', brokerAccountId: 'bka_alice_1', currency: 'USDT', decimals: 2, termsHash: TERMS };
  const acceptance = new OrderAcceptanceService({
    store: omsStore, idFactory: ids, clock, venues: { capabilities: () => ({ executionSafety: 'IDEMPOTENT', supportsClientOrderId: true, supportsQueryByClientOrderId: true, clientOrderIdMaxLength: 36 }) },
    mandates: { async verifyForOrder(id) { if (id !== 'mdt_alice_1') throw Object.assign(new Error('not found'), { code: 'NOT_FOUND' }); return mandate; } },
    risk: { async decide() { return { decision: 'APPROVE', recorded: true, decisionId: ids('rdc') }; } },
  });
  const killEvents = [];
  const services = createServicePorts({
    strategyService, strategyStore, clock,
    backtestJobs: { enqueue: async (b) => ({ id: 'bkt_000001', status: 'queued', principalId: b.principalId }) },
    backtestStore: { get: async (id) => (id === 'bkt_000001' ? { id, principalId: 'prn_alice', status: 'done' } : null) },
    riskPolicyService: { activePolicy: async (p) => ({ principalId: p, version: 1 }), createVersion: async (r) => ({ id: 'rsk_000001', principalId: r.principalId, version: 2 }) },
    killSwitchService: {
      engaged: async (p) => killEvents.filter((e) => e.principalId === p && e.action === 'engage'),
      engage: async (r) => { const e = { ...r, actor: undefined, action: 'engage' }; killEvents.push(e); return e; },
      release: async (r) => { calls.release.push(r); return { ...r, actor: undefined, action: 'release' }; },
    },
    mandateService: {
      propose: async (r) => ({ id: 'mdt_alice_1', principalId: r.principalId, status: 'pending_signature', termsHash: TERMS, nonce: 'n1' }),
      sign: async (r) => { calls.sign.push(r); return { id: r.mandateId, principalId: r.actor.principalId, status: 'active' }; },
      revoke: async (r) => ({ id: r.mandateId, principalId: r.actor.principalId, status: 'revoked' }),
    },
    mandateStore: { getMandate: async (id) => (id === 'mdt_alice_1' ? { id, principalId: 'prn_alice', status: 'active' } : null) },
    acceptance, omsStore,
    portfolio: { positions: async () => [{ instrument: 'BTC-USDT', quantity: '0.001' }], snapshots: async () => [] },
    receipts: { explainOrder: async (q) => { calls.receipts.push(q); return { receipt: 'satelink.trade-receipt/1.0', orderId: q.orderId }; } },
  });
  const stepUp = { verify: async (r) => { calls.stepUp.push(r); return r.code === '123456' ? { ok: true, method: 'totp' } : { ok: false }; } };
  const mcp = mcpEnabled ? {
    runIdFactory: () => ids('run'),
    registryFor: async (principal) => {
      const reg = new ToolRegistry({
        read: {
          marketData: { getQuote: async (p, instrument) => ({ data: { instrument, bid: '60000', ask: '60001', forPrincipal: p }, freshness: { stale: false } }), getCandles: async () => ({ data: [], freshness: { stale: false } }) },
          intelligence: { getMetric: async () => ({}) }, positions: { list: async () => [] }, orders: { list: async () => [] }, risk: { getActivePolicy: async () => ({}) },
          mandates: { get: async () => ({}) }, strategies: { get: async () => ({}) }, accounts: { summary: async () => ({}) },
        },
        proposals: { create: async (p) => { calls.proposals.push({ ...p, principal: principal.principalId }); return { proposalId: 'prp_000001', status: 'pending_review' }; } },
      });
      for (const tool of createDefaultTools()) reg.register(tool);
      return reg;
    },
  } : null;
  const app = express();
  const mounted = mountTradingRoutes(app, { env, api: {
    resolvePrincipal: async (req) => USERS[req.get('x-test-user')] ?? null, services, stepUp, clock, trustedOrigins: ['https://console.satelink.network'],
    idempotencyStore: new InMemoryIdempotencyStore(), limits, mcp,
  } });
  return { app, t, calls, omsStore, strategyStore, mounted };
}

const call = (app, method, url, { user = 'session-alice', key, body, headers = {} } = {}) => {
  let r = request(app)[method.toLowerCase()](`${TRADING_MOUNT_PATH}${url}`).set('x-test-user', user);
  if (method !== 'GET') { r = r.set('X-Satelink-Client', '1'); if (key !== null) r = r.set('Idempotency-Key', key ?? `idem-${Math.random().toString(36).slice(2, 12)}`); }
  for (const [k, v] of Object.entries(headers)) r = r.set(k, v);
  return method === 'GET' ? r : r.send(body ?? {});
};
const toOpenApi = (p) => p.replace(/:([A-Za-z]+)/g, '{$1}');
const concrete = (p) => p.replace(/:([A-Za-z]+)/g, (_, n) => `${n.replace(/Id$/, '')}_x00001`);

describe('trading api: flags (acceptance: flag off ⇒ 404)', function () {
  this.timeout(20_000); // many in-process HTTP round trips; full-suite load can exceed mocha's 2 s default
  it('TRADING_AGENT off: mountTradingRoutes mounts nothing; a mounted router answers 404 for every route, even unauthenticated', async () => {
    const off = rig({ env: {} });
    expect(off.mounted).to.deep.equal({ mounted: false, reason: 'TRADING_AGENT flag is off' });
    const flags = { TRADING_FLAG_TRADING_AGENT: 'true' };
    const r = rig({ env: flags });
    delete flags.TRADING_FLAG_TRADING_AGENT; // flipped off at runtime: the per-request gate takes over
    for (const route of ROUTES) {
      const res = await request(r.app)[route.method.toLowerCase()](`${TRADING_MOUNT_PATH}${concrete(route.path)}`).send({});
      expect(res.status, `${route.method} ${route.path}`).to.equal(404);
      expect(res.body).to.deep.equal({ ok: false, error: { code: 'NOT_FOUND', message: 'not found' } });
    }
  });

  it('MCP_TRADING off: /mcp is 404 while the rest of the API works', async () => {
    const r = rig({ env: { TRADING_FLAG_TRADING_AGENT: 'true' } });
    expect((await call(r.app, 'POST', '/mcp', { body: { jsonrpc: '2.0', id: 1, method: 'initialize' } })).status).to.equal(404);
    const s = await call(r.app, 'GET', '/status');
    expect(s.status).to.equal(200);
    expect(s.body.data.mcp).to.equal(false);
  });
});

describe('trading api: OpenAPI contract', function () {
  this.timeout(20_000); // many in-process HTTP round trips; full-suite load can exceed mocha's 2 s default
  it('every route is documented and every documented operation is routed', () => {
    const routed = ROUTES.map((r) => `${r.method} ${toOpenApi(r.path)}`).sort();
    const documented = Object.entries(OPENAPI.paths).flatMap(([p, ops]) => Object.keys(ops).map((m) => `${m.toUpperCase()} ${p}`)).sort();
    expect(documented).to.deep.equal(routed);
    expect(OPENAPI.openapi).to.equal('3.1.0');
    expect(OPENAPI.servers).to.deep.equal([{ url: '/v1/trading' }]);
  });

  it('mutations require Idempotency-Key; step-up routes declare it; every operation documents 401/403/404/429', () => {
    for (const r of ROUTES) {
      const o = OPENAPI.paths[toOpenApi(r.path)][r.method.toLowerCase()];
      const refs = (o.parameters ?? []).map((p) => p.$ref ?? p.name);
      if (r.method !== 'GET' && r.path !== '/mcp') expect(refs, r.path).to.include('#/components/parameters/IdempotencyKey');
      if (r.stepUp) { expect(refs, r.path).to.include('#/components/parameters/StepUp'); expect(o['x-satelink-step-up'], r.path).to.equal(true); }
      for (const s of ['401', '403', '404', '429']) expect(o.responses, `${r.method} ${r.path}`).to.have.property(s);
    }
    expect(OPENAPI.paths['/mandates/{mandateId}/sign'].post['x-satelink-step-up']).to.equal(true);
    expect(OPENAPI.components.parameters.IdempotencyKey.required).to.equal(true);
  });

  it('observed responses use only documented status codes and the envelope', async () => {
    const r = rig();
    const seen = [];
    const record = async (method, route, res) => {
      const o = OPENAPI.paths[toOpenApi(route)][method.toLowerCase()];
      seen.push(`${method} ${route} ${res.status}`);
      expect(Object.keys(o.responses), `${method} ${route} → ${res.status}`).to.include(String(res.status));
      if (route !== '/mcp') expect(res.body.ok, `${method} ${route}`).to.equal(res.status < 400); // MCP speaks JSON-RPC, not the envelope
    };
    const s = await call(r.app, 'POST', '/strategies', { body: { name: 'Trend' } }); await record('POST', '/strategies', s);
    const v = await call(r.app, 'POST', `/strategies/${s.body.data.id}/versions`, { body: { dsl: DSL } }); await record('POST', '/strategies/:strategyId/versions', v);
    await record('GET', '/strategy-versions/:versionId', await call(r.app, 'GET', `/strategy-versions/${v.body.data.id}`));
    await record('GET', '/strategy-versions/:versionId', await call(r.app, 'GET', `/strategy-versions/${v.body.data.id}`, { user: 'session-bob' }));
    await record('POST', '/backtests', await call(r.app, 'POST', '/backtests', { body: { strategyVersionId: v.body.data.id, fromMs: 1, toMs: 2 } }));
    await record('GET', '/backtests/:backtestId', await call(r.app, 'GET', '/backtests/bkt_000001'));
    await record('GET', '/risk/policy', await call(r.app, 'GET', '/risk/policy'));
    await record('POST', '/risk/policies', await call(r.app, 'POST', '/risk/policies', { body: { draft: {} } }));
    await record('GET', '/kill-switch', await call(r.app, 'GET', '/kill-switch'));
    await record('POST', '/kill-switch/engage', await call(r.app, 'POST', '/kill-switch/engage', { body: { reason: 'stop' } }));
    await record('POST', '/kill-switch/release', await call(r.app, 'POST', '/kill-switch/release', { body: { reason: 'ok' } }));
    await record('POST', '/mandates', await call(r.app, 'POST', '/mandates', { body: { draft: {} } }));
    await record('GET', '/mandates/:mandateId', await call(r.app, 'GET', '/mandates/mdt_alice_1'));
    await record('POST', '/mandates/:mandateId/sign', await call(r.app, 'POST', '/mandates/mdt_alice_1/sign', { body: { termsHash: TERMS, nonce: 'n1' }, headers: { 'X-Satelink-Step-Up': '123456' } }));
    await record('POST', '/mandates/:mandateId/revoke', await call(r.app, 'POST', '/mandates/mdt_alice_1/revoke', { body: { reason: 'done' } }));
    await record('GET', '/orders', await call(r.app, 'GET', '/orders'));
    const o = await call(r.app, 'POST', '/orders', { body: { brokerAccountId: 'bka_alice_1', mandateId: 'mdt_alice_1', mode: 'paper', venue: 'binance', instrument: 'BTC-USDT', side: 'buy', type: 'limit', timeInForce: 'gtc', quantity: '0.001', limitPrice: '30000' } });
    await record('POST', '/orders', o);
    await record('GET', '/orders/:orderId', await call(r.app, 'GET', `/orders/${o.body.data.orderId}`));
    await record('POST', '/orders/:orderId/cancel', await call(r.app, 'POST', `/orders/${o.body.data.orderId}/cancel`));
    await record('GET', '/orders/:orderId/receipt', await call(r.app, 'GET', `/orders/${o.body.data.orderId}/receipt`));
    await record('GET', '/positions', await call(r.app, 'GET', '/positions'));
    await record('GET', '/portfolio/snapshots', await call(r.app, 'GET', '/portfolio/snapshots'));
    await record('GET', '/proposals', await call(r.app, 'GET', '/proposals'));
    await record('POST', '/proposals/:proposalId/approve', await call(r.app, 'POST', '/proposals/prp_000001/approve', { headers: { 'X-Satelink-Step-Up': '123456' } }));
    await record('POST', '/proposals/:proposalId/reject', await call(r.app, 'POST', '/proposals/prp_000001/reject'));
    await record('POST', '/mcp', await call(r.app, 'POST', '/mcp', { key: null, body: { jsonrpc: '2.0', id: 1, method: 'ping' } }));
    await record('GET', '/status', await call(r.app, 'GET', '/status'));
    expect(seen).to.include.members(['GET /strategy-versions/:versionId 404', 'POST /orders 201', 'POST /orders/:orderId/cancel 409', 'GET /orders 501', 'POST /proposals/:proposalId/approve 501']);
  });
});

describe('trading api: authentication, tenant checks, CSRF', function () {
  this.timeout(20_000); // many in-process HTTP round trips; full-suite load can exceed mocha's 2 s default
  it('unauthenticated → 401; a principalId in body/query must match the session', async () => {
    const r = rig();
    expect((await request(r.app).get(`${TRADING_MOUNT_PATH}/status`)).status).to.equal(401);
    const m = await call(r.app, 'POST', '/strategies', { body: { name: 'x', principalId: 'prn_bob' } });
    expect([m.status, m.body.error.code]).to.deep.equal([403, 'TENANT_MISMATCH']);
    expect((await call(r.app, 'GET', '/positions?principalId=prn_bob')).status).to.equal(403);
  });

  it("another principal's resources are 404 (no existence leak)", async () => {
    const r = rig();
    const s = await call(r.app, 'POST', '/strategies', { body: { name: 'Alice' } });
    const v = await call(r.app, 'POST', `/strategies/${s.body.data.id}/versions`, { body: { dsl: DSL } });
    expect((await call(r.app, 'POST', `/strategies/${s.body.data.id}/versions`, { user: 'session-bob', body: { dsl: DSL } })).status).to.equal(404);
    expect((await call(r.app, 'POST', '/backtests', { user: 'session-bob', body: { strategyVersionId: v.body.data.id, fromMs: 1, toMs: 2 } })).status).to.equal(404); // cannot backtest Alice's strategy
    expect((await call(r.app, 'GET', '/backtests/bkt_000001', { user: 'session-bob' })).status).to.equal(404);
    expect((await call(r.app, 'GET', '/mandates/mdt_alice_1', { user: 'session-bob' })).status).to.equal(404);
    expect((await call(r.app, 'POST', '/mandates/mdt_alice_1/revoke', { user: 'session-bob', body: { reason: 'x' } })).status).to.equal(404);
    const o = await call(r.app, 'POST', '/orders', { body: { brokerAccountId: 'bka_alice_1', mandateId: 'mdt_alice_1', mode: 'paper', venue: 'binance', instrument: 'BTC-USDT', side: 'buy', type: 'limit', quantity: '0.001', limitPrice: '30000' } });
    expect((await call(r.app, 'GET', `/orders/${o.body.data.orderId}`, { user: 'session-bob' })).status).to.equal(404);
    expect((await call(r.app, 'POST', `/orders/${o.body.data.orderId}/cancel`, { user: 'session-bob' })).status).to.equal(404);
    await call(r.app, 'GET', `/orders/${o.body.data.orderId}/receipt`, { user: 'session-bob' });
    expect(r.calls.receipts.at(-1)).to.deep.equal({ principalId: 'prn_bob', orderId: o.body.data.orderId }); // the receipt service scopes by the authenticated principal
  });

  it('defence in depth: even a buggy port that returns a foreign resource is reported as 404 by the router', async () => {
    const app = express();
    const leaky = { risk: { activePolicy: async () => ({ principalId: 'prn_bob', version: 7, secretLimits: true }) } };
    mountTradingRoutes(app, { env: ON, api: { resolvePrincipal: async () => USERS['session-alice'], services: leaky, stepUp: { verify: async () => ({ ok: false }) } } });
    const res = await request(app).get(`${TRADING_MOUNT_PATH}/risk/policy`);
    expect([res.status, res.body.error.code]).to.deep.equal([404, 'NOT_FOUND']);
    expect(JSON.stringify(res.body)).to.not.include('secretLimits');
  });

  it('session mutations need X-Satelink-Client + JSON + trusted origin; API-key humans skip the header; agents cannot mutate', async () => {
    const r = rig();
    const noHeader = await request(r.app).post(`${TRADING_MOUNT_PATH}/strategies`).set('x-test-user', 'session-alice').set('Idempotency-Key', 'idem-csrf-0001').send({ name: 'x' });
    expect([noHeader.status, noHeader.body.error.code]).to.deep.equal([403, 'CSRF']);
    const badOrigin = await call(r.app, 'POST', '/strategies', { body: { name: 'x' }, headers: { Origin: 'https://evil.example' } });
    expect(badOrigin.status).to.equal(403);
    const form = await request(r.app).post(`${TRADING_MOUNT_PATH}/strategies`).set('x-test-user', 'session-alice').set('X-Satelink-Client', '1').set('Idempotency-Key', 'idem-csrf-0002').type('form').send('name=x');
    expect(form.status).to.equal(415);
    const viaKey = await request(r.app).post(`${TRADING_MOUNT_PATH}/strategies`).set('x-test-user', 'key-alice').set('Idempotency-Key', 'idem-key-00001').send({ name: 'Keyed' });
    expect(viaKey.status).to.equal(201);
    const agent = await call(r.app, 'POST', '/orders', { user: 'agent-alice', body: { quantity: '1' } });
    expect([agent.status, agent.body.error.code]).to.deep.equal([403, 'HUMAN_REQUIRED']);
    expect((await call(r.app, 'GET', '/positions', { user: 'agent-alice' })).status).to.equal(200); // agents may read
    const bad = await request(r.app).post(`${TRADING_MOUNT_PATH}/strategies`).set('x-test-user', 'session-alice').set('X-Satelink-Client', '1').set('Idempotency-Key', 'idem-json-0001').set('Content-Type', 'application/json').send('{"name":');
    expect([bad.status, bad.body.error.code]).to.deep.equal([400, 'BAD_REQUEST']);
  });
});

describe('trading api: idempotent replays', function () {
  this.timeout(20_000); // many in-process HTTP round trips; full-suite load can exceed mocha's 2 s default
  const ORDER = { brokerAccountId: 'bka_alice_1', mandateId: 'mdt_alice_1', mode: 'paper', venue: 'binance', instrument: 'BTC-USDT', side: 'buy', type: 'limit', quantity: '0.001', limitPrice: '30000' };

  it('mutations without a valid Idempotency-Key are refused before any work', async () => {
    const r = rig();
    for (const key of [null, 'short', 'has space in it', 'x'.repeat(129)]) {
      let q = request(r.app).post(`${TRADING_MOUNT_PATH}/orders`).set('x-test-user', 'session-alice').set('X-Satelink-Client', '1');
      if (key) q = q.set('Idempotency-Key', key);
      const res = await q.send(ORDER);
      expect([res.status, res.body.error.code], String(key)).to.deep.equal([400, 'IDEMPOTENCY_KEY_REQUIRED']);
    }
    expect(r.omsStore.state.orders.size).to.equal(0);
  });

  it('same key + same body → the stored response is replayed (one OMS order); different body → 422; other user → independent', async () => {
    const r = rig();
    const a = await call(r.app, 'POST', '/orders', { key: 'idem-order-0001', body: ORDER });
    const b = await call(r.app, 'POST', '/orders', { key: 'idem-order-0001', body: ORDER });
    expect([a.status, b.status]).to.deep.equal([201, 201]);
    expect(b.body).to.deep.equal(a.body);
    expect(b.headers['idempotent-replayed']).to.equal('true');
    expect(a.headers['idempotent-replayed']).to.equal(undefined);
    expect(r.omsStore.state.orders.size).to.equal(1);
    const c = await call(r.app, 'POST', '/orders', { key: 'idem-order-0001', body: { ...ORDER, quantity: '0.002' } });
    expect([c.status, c.body.error.code]).to.deep.equal([422, 'IDEMPOTENCY_KEY_REUSED']);
    expect(r.omsStore.state.orders.size).to.equal(1);
    // a different key with the same body is a NEW intent at the HTTP layer; the OMS key derives from it
    const d = await call(r.app, 'POST', '/orders', { key: 'idem-order-0002', body: ORDER });
    expect(d.body.data.orderId).to.not.equal(a.body.data.orderId);
    // bob reusing alice's key string is independent (keys are scoped to the principal) — and refused by his mandate check
    const e = await call(r.app, 'POST', '/orders', { user: 'session-bob', key: 'idem-order-0001', body: ORDER });
    expect(e.status).to.equal(422);
    expect(e.body.error.code).to.equal('REFUSED');
  });

  it('a replayed error is replayed too; a still-running request with the same key → 409', async () => {
    const r = rig();
    const x = await call(r.app, 'POST', '/strategies', { key: 'idem-strat-0001', body: { name: '' } });
    const y = await call(r.app, 'POST', '/strategies', { key: 'idem-strat-0001', body: { name: '' } });
    expect(y.status).to.equal(x.status);
    expect(y.headers['idempotent-replayed']).to.equal('true');

    const store = new InMemoryIdempotencyStore();
    await store.begin('prn_alice|idem-slow-00001', 'fp', T0, 60_000);
    expect(await store.begin('prn_alice|idem-slow-00001', 'fp', T0, 60_000)).to.deep.equal({ state: 'in_progress' });
    expect(await store.begin('prn_alice|idem-slow-00001', 'other', T0, 60_000)).to.deep.equal({ state: 'conflict' });
    expect((await store.begin('prn_alice|idem-slow-00001', 'fp', T0 + 60_001, 60_000)).state).to.equal('new'); // expired
  });
});

describe('trading api: step-up on sign / approve / release', function () {
  this.timeout(20_000); // many in-process HTTP round trips; full-suite load can exceed mocha's 2 s default
  it('release: missing code → 401 STEP_UP_REQUIRED; wrong code → 401 STEP_UP_FAILED; right code → 201', async () => {
    const r = rig();
    const a = await call(r.app, 'POST', '/kill-switch/release', { body: { reason: 'resume' } });
    expect([a.status, a.body.error.code]).to.deep.equal([401, 'STEP_UP_REQUIRED']);
    const b = await call(r.app, 'POST', '/kill-switch/release', { body: { reason: 'resume' }, headers: { 'X-Satelink-Step-Up': '000000' } });
    expect([b.status, b.body.error.code]).to.deep.equal([401, 'STEP_UP_FAILED']);
    expect(r.calls.release).to.have.length(0);
    const c = await call(r.app, 'POST', '/kill-switch/release', { body: { reason: 'resume' }, headers: { 'X-Satelink-Step-Up': '123456' } });
    expect(c.status).to.equal(201);
    expect(r.calls.release[0]).to.include({ principalId: 'prn_alice', scopeType: 'principal', scopeId: 'prn_alice' });
    expect(r.calls.release[0].actor).to.deep.equal({ principalId: 'prn_alice', kind: 'human', role: 'user' });
  });

  it('sign: the code is required and forwarded to the Stage 16 service — never verified twice by the route', async () => {
    const r = rig();
    expect((await call(r.app, 'POST', '/mandates/mdt_alice_1/sign', { body: { termsHash: TERMS, nonce: 'n1' } })).status).to.equal(401);
    const s = await call(r.app, 'POST', '/mandates/mdt_alice_1/sign', { body: { termsHash: TERMS, nonce: 'n1' }, headers: { 'X-Satelink-Step-Up': '654321' } });
    expect(s.status).to.equal(200);
    expect(r.calls.sign[0]).to.deep.include({ mandateId: 'mdt_alice_1', termsHash: TERMS, nonce: 'n1', code: '654321' });
    expect(r.calls.stepUp).to.have.length(0);
  });

  it('approve requires step-up before reaching the (not yet built) review queue', async () => {
    const r = rig();
    expect((await call(r.app, 'POST', '/proposals/prp_000001/approve')).status).to.equal(401);
    expect((await call(r.app, 'POST', '/proposals/prp_000001/approve', { headers: { 'X-Satelink-Step-Up': '123456' } })).status).to.equal(501);
  });
});

describe('trading api: rate limits', function () {
  this.timeout(20_000); // many in-process HTTP round trips; full-suite load can exceed mocha's 2 s default
  it('per principal and class, with Retry-After; step-up attempts have their own small budget', async () => {
    const r = rig({ limits: { read: 3, write: 30, stepUp: 2 } });
    for (let i = 0; i < 3; i++) expect((await call(r.app, 'GET', '/positions')).status).to.equal(200);
    const limited = await call(r.app, 'GET', '/positions');
    expect([limited.status, limited.body.error.code]).to.deep.equal([429, 'RATE_LIMITED']);
    expect(Number(limited.headers['retry-after'])).to.be.within(1, 60);
    expect((await call(r.app, 'GET', '/positions', { user: 'session-bob' })).status).to.equal(200);
    r.t.now += 60_000;
    expect((await call(r.app, 'GET', '/positions')).status).to.equal(200);
    for (let i = 0; i < 2; i++) await call(r.app, 'POST', '/kill-switch/release', { body: { reason: 'x' }, headers: { 'X-Satelink-Step-Up': '000000' } });
    expect((await call(r.app, 'POST', '/kill-switch/release', { body: { reason: 'x' }, headers: { 'X-Satelink-Step-Up': '123456' } })).status).to.equal(429);
  });
});

describe('trading api: orders through the real OMS acceptance', function () {
  this.timeout(20_000); // many in-process HTTP round trips; full-suite load can exceed mocha's 2 s default
  it('accept → read → cancel request moves ACK to CANCEL_REQUESTED with an order event naming the user', async () => {
    const r = rig();
    const o = await call(r.app, 'POST', '/orders', { body: { brokerAccountId: 'bka_alice_1', mandateId: 'mdt_alice_1', mode: 'paper', venue: 'binance', instrument: 'BTC-USDT', side: 'buy', type: 'limit', quantity: '0.001', limitPrice: '30000' } });
    expect(o.body.data).to.include({ accepted: true, duplicate: false, status: 'approved' });
    expect((await call(r.app, 'POST', `/orders/${o.body.data.orderId}/cancel`)).status).to.equal(409); // not at the venue yet
    await r.omsStore.updateOrder(o.body.data.orderId, 'approved', { status: 'acknowledged' }); // as if dispatched + acknowledged
    const c = await call(r.app, 'POST', `/orders/${o.body.data.orderId}/cancel`);
    expect([c.status, c.body.data.status]).to.deep.equal([202, 'cancel_requested']);
    expect(r.omsStore.state.events.at(-1)).to.deep.include({ eventType: 'cancel_requested', actor: 'user:prn_alice', fromStatus: 'acknowledged', toStatus: 'cancel_requested' });
    const refused = await call(r.app, 'POST', '/orders', { body: { brokerAccountId: 'bka_alice_1', mandateId: 'mdt_other', mode: 'paper', venue: 'binance', instrument: 'BTC-USDT', side: 'buy', type: 'limit', quantity: '0.001', limitPrice: '30000' } });
    expect([refused.status, refused.body.error.code]).to.deep.equal([422, 'REFUSED']);
    expect(refused.body.error.message).to.match(/^MANDATE_NOT_FOUND/);
  });
});

describe('trading api: MCP (read + propose only)', function () {
  this.timeout(20_000); // many in-process HTTP round trips; full-suite load can exceed mocha's 2 s default
  const rpc = (app, body, user = 'agent-alice') => request(app).post(`${TRADING_MOUNT_PATH}/mcp`).set('x-test-user', user).send(body);

  it('initialize / tools/list: only READ and PROPOSE tools; nothing that places, cancels or modifies orders', async () => {
    const r = rig();
    const init = await rpc(r.app, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: MCP_PROTOCOL_VERSION } });
    expect(init.body.result).to.deep.include({ protocolVersion: MCP_PROTOCOL_VERSION });
    expect(init.body.result.instructions).to.match(/cannot place/);
    const list = await rpc(r.app, { jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const names = list.body.result.tools.map((t) => t.name);
    expect(names).to.include.members(['get_quote', 'list_positions', 'propose_order', 'propose_cancel']);
    expect(names.filter((n) => /(^|_)(place|submit|execute|modify|amend|withdraw|transfer)(_|$)|^cancel_order/.test(n))).to.deep.equal([]);
    for (const t of list.body.result.tools) expect(t.description, t.name).to.match(/^\[(READ|CONTROLLED)\]/);
  });

  it('tools/call: reads work for the authenticated principal; propose creates a proposal only; place_order is refused', async () => {
    const r = rig();
    const q = await rpc(r.app, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'get_quote', arguments: { instrument: 'BTC-USDT' } } });
    expect(q.body.result.isError).to.equal(false);
    expect(q.body.result.structuredContent.data).to.include({ forPrincipal: 'prn_alice' });
    const p = await rpc(r.app, { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'propose_order', arguments: { mandateId: 'mdt_alice_1', instrument: 'BTC-USDT', side: 'buy', type: 'limit', quantity: '0.001', limitPrice: '30000', rationale: 'fast SMA crossed above slow' } } });
    if (p.body.result.isError) throw new Error(p.body.result.content[0].text);
    expect(p.body.result.structuredContent).to.deep.equal({ proposalId: 'prp_000001', status: 'pending_review' });
    expect(r.calls.proposals).to.have.length(1);
    expect(r.omsStore.state.orders.size).to.equal(0); // a proposal is not an order
    for (const name of ['place_order', 'submit_order', 'cancel_order', 'modify_order', 'execute_trade', 'withdraw_funds']) {
      const x = await rpc(r.app, { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name, arguments: {} } });
      expect(x.body.result.isError, name).to.equal(true);
      expect(x.body.result.content[0].text, name).to.match(/FORBIDDEN_TOOL|UNKNOWN_TOOL/);
    }
    expect(r.omsStore.state.orders.size).to.equal(0);
    expect(() => defineTool({ name: 'place_order', tier: ToolTier.CONTROLLED, description: 'would place an order', inputSchema: { type: 'object', properties: {} }, outputSchema: { type: 'object', properties: {} }, handler: async () => ({}) })).to.throw(/forbidden/);
  });

  it('JSON-RPC edges: notification → 202, batch, unknown method, unauthenticated → 401', async () => {
    const r = rig();
    expect((await rpc(r.app, { jsonrpc: '2.0', method: 'notifications/initialized' })).status).to.equal(202);
    const batch = await rpc(r.app, [{ jsonrpc: '2.0', id: 1, method: 'ping' }, { jsonrpc: '2.0', method: 'notifications/initialized' }, { jsonrpc: '2.0', id: 2, method: 'nope' }]);
    expect(batch.body.map((m) => m.id)).to.deep.equal([1, 2]);
    expect(batch.body[1].error.code).to.equal(-32601);
    expect((await rpc(r.app, { foo: 1 })).body.error.code).to.equal(-32600);
    expect((await request(r.app).post(`${TRADING_MOUNT_PATH}/mcp`).send({ jsonrpc: '2.0', id: 1, method: 'ping' })).status).to.equal(401);
    expect((await rpc(rig({ mcpEnabled: false }).app, { jsonrpc: '2.0', id: 1, method: 'ping' })).status).to.equal(404);
  });
});

describe('trading api: static guarantees', function () {
  this.timeout(20_000); // many in-process HTTP round trips; full-suite load can exceed mocha's 2 s default
  const code = (f) => fs.readFileSync(path.join(API_DIR, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const files = fs.readdirSync(API_DIR).filter((f) => f.endsWith('.mjs'));

  it('the API never reaches brokers, credentials, the dispatcher, ledger or env; MCP never sees the OMS', () => {
    for (const f of files) {
      const c = code(f);
      expect(c, f).to.not.match(/from ['"][./]*(brokers|credentials)\//);
      expect(c, f).to.not.match(/dispatcher|placeOrder|_placeOrder/);
      expect(c, f).to.not.match(/from ['"][^'"]*(ledger|billing|settlement)[^'"]*['"]/);
      expect(c, f).to.not.match(/process\.env/);
    }
    expect(code('mcp.mjs')).to.not.match(/oms|acceptance|services/i);
  });

  it('app_factory.mjs and server.js still do not import the trading module (register: B-03/B-06/B-10 open)', () => {
    for (const f of ['apps/api/app_factory.mjs', 'apps/api/server.js']) expect(fs.readFileSync(path.join(ROOT, f), 'utf8'), f).to.not.match(/trading_agent/);
  });
});
