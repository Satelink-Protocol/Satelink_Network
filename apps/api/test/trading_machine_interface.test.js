import { expect } from 'chai';
import express from 'express';
import request from 'supertest';
import { mountTradingRoutes, TRADING_MOUNT_PATH } from '../src/trading_agent/index.mjs';
import { createServicePorts, InMemoryIdempotencyStore } from '../src/trading_agent/api/index.mjs';
import {
  AgentKeyService, InMemoryAgentKeyStore, AgentAccessGuard, createMachineInterface, createMachineTools, hashKey, MACHINE_PRICING, Scope,
} from '../src/trading_agent/access/index.mjs';
import { DecisionService, InMemoryDecisionStore } from '../src/trading_agent/decision/index.mjs';
import { ShadowRevenueEngine } from '../src/trading_agent/revenue/index.mjs';
import { ToolRegistry, createDefaultTools, isForbiddenToolName } from '../src/trading_agent/agent/index.mjs';
import { goodInput, NOW } from './helpers/decision_fixture.mjs';

// Phase 6 item 11 — machine + AI-agent interface over the Stage 24 router. In-process HTTP.
const ENV = { TRADING_FLAG_TRADING_AGENT: 'true', TRADING_FLAG_REVENUE_ENGINE: 'true' };
const code = async (fn) => { try { await fn(); } catch (e) { return e.code; } return null; };
const PRINCIPALS = {
  prn_bot: { id: 'prn_bot', kind: 'agent', parentId: 'prn_alice', state: 'active' },
  prn_mach: { id: 'prn_mach', kind: 'machine', parentId: 'prn_alice', state: 'active' },
  prn_exec: { id: 'prn_exec', kind: 'agent', parentId: 'prn_alice', state: 'active' },
  prn_eve_bot: { id: 'prn_eve_bot', kind: 'agent', parentId: 'prn_eve', state: 'active' },
};

function rig({ now = NOW } = {}) {
  const t = { now };
  const clock = () => new Date(t.now);
  let n = 0;
  const ids = (p) => `${p}_${String(++n).padStart(6, '0')}`;
  const keyStore = new InMemoryAgentKeyStore();
  const keys = new AgentKeyService({ store: keyStore, principals: { get: async (id) => PRINCIPALS[id] ?? null }, idFactory: ids, clock });
  const revenue = new ShadowRevenueEngine({ env: ENV });
  const guard = new AgentAccessGuard({ store: keyStore, idFactory: ids, clock, revenue });
  const decisionStore = new InMemoryDecisionStore();
  const decisions = new DecisionService({ store: decisionStore, idFactory: ids, clock });
  const runs = [];
  const orchestrator = { run: async (task) => { runs.push(task); const d = await decisions.evaluate({ ...goodInput(), opportunityId: task.opportunityId }); return { status: 'ok', decision: d, recommendation: d.decision, traceId: ids('run') }; } };
  const proposals = [];
  const machine = createMachineInterface({ orchestrator, decisionStore, guard, proposals: { create: async (p) => { proposals.push(p); return { proposalId: ids('prp'), status: 'pending_review' }; } } });
  const services = createServicePorts({ machine });
  const app = express();
  mountTradingRoutes(app, { env: ENV, api: {
    resolvePrincipal: async (req) => (req.get('authorization')?.startsWith('Bearer ') ? keys.resolve(req.get('authorization').slice(7)) : (req.get('x-test-user') === 'alice' ? { principalId: 'prn_alice', kind: 'human', via: 'session' } : null)),
    services, stepUp: { verify: async () => ({ ok: false }) }, clock, idempotencyStore: new InMemoryIdempotencyStore(), limits: { read: 1000, write: 1000, stepUp: 5 },
  } });
  return { app, keys, keyStore, guard, revenue, decisionStore, runs, proposals, t, clock };
}
const alice = { principalId: 'prn_alice', kind: 'human' };
const issue = (r, over = {}) => r.keys.issue({ actor: alice, principalId: 'prn_bot', scope: Scope.PROPOSE, budgetCalls: 100, budgetUsdMicro: 1_000_000, ratePerMinute: 60, ...over });
const post = (app, url, key, body, idem = `idem-${Math.random().toString(36).slice(2, 12)}`) => request(app).post(`${TRADING_MOUNT_PATH}${url}`).set('Authorization', `Bearer ${key}`).set('Idempotency-Key', idem).send(body);
const get = (app, url, key) => request(app).get(`${TRADING_MOUNT_PATH}${url}`).set('Authorization', `Bearer ${key}`);

describe('trading: machine + AI-agent interface (Phase 6 item 11)', function () {
  this.timeout(20_000);

  describe('keys', () => {
    it('only the human owner issues a key; the raw key is returned once and never stored', async () => {
      const r = rig();
      const k = await issue(r);
      expect(k.apiKey).to.match(/^sk_trd_/);
      const stored = [...r.keyStore.keys.values()][0];
      expect(stored.keyHash).to.equal(hashKey(k.apiKey));
      expect(JSON.stringify(stored, (_k, v) => (typeof v === 'bigint' ? String(v) : v))).to.not.include(k.apiKey);
      expect(await code(() => r.keys.issue({ actor: { principalId: 'prn_bot', kind: 'agent' }, principalId: 'prn_mach', scope: 'READ', budgetCalls: 1, budgetUsdMicro: 0 }))).to.equal('FORBIDDEN');
      expect(await code(() => issue(r, { principalId: 'prn_eve_bot' }))).to.equal('NOT_FOUND'); // someone else's agent
      expect(await code(() => issue(r, { principalId: 'prn_exec', scope: Scope.EXECUTE_UNDER_MANDATE }))).to.equal('INVALID'); // needs a mandate
    });
    it('resolve: valid key → agent/machine principal with its scope; revoked / unknown → unauthenticated', async () => {
      const r = rig();
      const k = await r.keys.issue({ actor: alice, principalId: 'prn_mach', scope: 'READ', budgetCalls: 10, budgetUsdMicro: 0 });
      expect(await r.keys.resolve(k.apiKey)).to.deep.include({ principalId: 'prn_mach', kind: 'machine', via: 'api_key' });
      expect(await code(() => r.keys.revoke({ actor: { principalId: 'prn_eve', kind: 'human' }, keyId: k.keyId }))).to.equal('NOT_FOUND');
      await r.keys.revoke({ actor: alice, keyId: k.keyId });
      expect(await r.keys.resolve(k.apiKey)).to.equal(null);
      expect((await get(r.app, '/agent/receipts/dec_x00001', k.apiKey)).status).to.equal(401);
      expect((await get(r.app, '/agent/receipts/dec_x00001', 'sk_trd_nope')).status).to.equal(401);
    });
  });

  describe('POST /agent/opportunities/evaluate', () => {
    it('returns the GO / WAIT / REJECT JSON from the one core (orchestrator → scorecard), metered', async () => {
      const r = rig();
      const k = await issue(r, { principalId: 'prn_mach', scope: 'READ' });
      const res = await post(r.app, '/agent/opportunities/evaluate', k.apiKey, { instrument: 'BTC-USDT', opportunityId: 'opp_7' }, 'idem-eval-0001');
      expect(res.status).to.equal(200);
      for (const f of ['decision', 'score', 'confidence', 'failed_gates', 'dimension_scores', 'strategy_version', 'data_timestamp', 'expires_at', 'evidence_refs', 'explanation_ref', 'receipt_id']) expect(res.body.data).to.have.property(f);
      expect(res.body.data.decision).to.equal('GO');
      expect(res.body.data.score_meaning).to.match(/NOT a probability of profit/);
      expect(r.runs[0]).to.include({ kind: 'evaluate_opportunity', principalId: 'prn_alice', actingPrincipalId: 'prn_mach', machineRequestId: 'idem-eval-0001' });
      expect(r.keyStore.usage).to.have.length(1);
      expect(r.keyStore.usage[0]).to.include({ endpoint: 'evaluate_opportunity', chargeUsdMicro: 5000n, priceVersion: MACHINE_PRICING.version });
      const replay = await post(r.app, '/agent/opportunities/evaluate', k.apiKey, { instrument: 'BTC-USDT', opportunityId: 'opp_7' }, 'idem-eval-0001');
      expect(replay.headers['idempotent-replayed']).to.equal('true');
      expect(r.keyStore.usage).to.have.length(1); // a replay is not billed twice
    });
    it('draft pricing posts usage to the SIMULATED revenue book only', async () => {
      const r = rig();
      const k = await issue(r);
      await post(r.app, '/agent/opportunities/evaluate', k.apiKey, { instrument: 'BTC-USDT' });
      expect(MACHINE_PRICING.published).to.equal(false);
      expect(r.revenue.entries('real')).to.have.length(0);
      expect(r.revenue.varianceReport('sim').streams).to.deep.equal([{ stream: 'usage', currency: 'USDMC', expectedMinor: '5000', actualMinor: '0', refundedMinor: '0', varianceMinor: '5000' }]);
    });
    it('rate limit → 429; call budget → 402; USD budget → 402; bad input → 400', async () => {
      const r = rig();
      const k = await issue(r, { ratePerMinute: 2 });
      expect((await post(r.app, '/agent/opportunities/evaluate', k.apiKey, { instrument: 'BTC-USDT' })).status).to.equal(200);
      expect((await post(r.app, '/agent/opportunities/evaluate', k.apiKey, { instrument: 'BTC-USDT' })).status).to.equal(200);
      const limited = await post(r.app, '/agent/opportunities/evaluate', k.apiKey, { instrument: 'BTC-USDT' });
      expect([limited.status, limited.body.error.code]).to.deep.equal([429, 'RATE_LIMITED']);
      r.t.now += 60_000;
      const r2 = rig(); const k2 = await issue(r2, { budgetCalls: 1 });
      await post(r2.app, '/agent/opportunities/evaluate', k2.apiKey, { instrument: 'BTC-USDT' });
      const over = await post(r2.app, '/agent/opportunities/evaluate', k2.apiKey, { instrument: 'BTC-USDT' });
      expect([over.status, over.body.error.code]).to.deep.equal([402, 'BUDGET_EXHAUSTED']);
      const r3 = rig(); const k3 = await issue(r3, { budgetUsdMicro: 4_999 });
      expect((await post(r3.app, '/agent/opportunities/evaluate', k3.apiKey, { instrument: 'BTC-USDT' })).status).to.equal(402);
      expect((await post(r3.app, '/agent/opportunities/evaluate', (await issue(rig())).apiKey, { instrument: 'btc' })).status).to.equal(401); // other rig's key
      expect((await post(r3.app, '/agent/opportunities/evaluate', (await r3.keys.issue({ actor: alice, principalId: 'prn_mach', scope: 'READ', budgetCalls: 5, budgetUsdMicro: 99_999 })).apiKey, { instrument: 'btc' })).status).to.equal(400);
    });
    it('the budget period resets at the next UTC day', async () => {
      const r = rig();
      const k = await issue(r, { budgetCalls: 1 });
      await post(r.app, '/agent/opportunities/evaluate', k.apiKey, { instrument: 'BTC-USDT' });
      r.t.now += 86_400_000;
      expect((await post(r.app, '/agent/opportunities/evaluate', k.apiKey, { instrument: 'BTC-USDT' })).status).to.equal(200);
    });
    it('a human session cannot use the agent endpoints (agent key required)', async () => {
      const r = rig();
      const res = await request(r.app).post(`${TRADING_MOUNT_PATH}/agent/opportunities/evaluate`).set('x-test-user', 'alice').set('Idempotency-Key', 'idem-human-001').send({ instrument: 'BTC-USDT' });
      expect([res.status, res.body.error.code]).to.deep.equal([403, 'AGENT_KEY_REQUIRED']);
    });
  });

  describe('POST /agent/proposals', () => {
    it('READ scope cannot propose (403); PROPOSE creates a proposal for human review, never an order', async () => {
      const r = rig();
      const ro = await r.keys.issue({ actor: alice, principalId: 'prn_mach', scope: 'READ', budgetCalls: 5, budgetUsdMicro: 100_000 });
      const denied = await post(r.app, '/agent/proposals', ro.apiKey, { mandateId: 'mdt_alice_1', instrument: 'BTC-USDT', side: 'buy', quantity: '0.01' });
      expect([denied.status, denied.body.error.code]).to.deep.equal([403, 'SCOPE_INSUFFICIENT']);
      const k = await issue(r);
      const ok = await post(r.app, '/agent/proposals', k.apiKey, { mandateId: 'mdt_alice_1', instrument: 'BTC-USDT', side: 'buy', quantity: '0.01', rationale: 'scorecard GO' });
      expect(ok.status).to.equal(201);
      expect(ok.body.data).to.include({ status: 'pending_review', executionPath: 'human_review' });
      expect(r.proposals[0]).to.include({ principalId: 'prn_alice', proposedBy: 'prn_bot', mandateId: 'mdt_alice_1' });
      expect(JSON.stringify(ok.body)).to.not.match(/orderId|clientOrderId/);
    });
    it('a key bound to a mandate cannot propose under another mandate; EXECUTE keys are Mode B candidates', async () => {
      const r = rig();
      const k = await r.keys.issue({ actor: alice, principalId: 'prn_exec', scope: Scope.EXECUTE_UNDER_MANDATE, mandateId: 'mdt_alice_1', budgetCalls: 10, budgetUsdMicro: 100_000 });
      const wrong = await post(r.app, '/agent/proposals', k.apiKey, { mandateId: 'mdt_other_9', instrument: 'BTC-USDT', side: 'buy', quantity: '0.01' });
      expect([wrong.status, wrong.body.error.code]).to.deep.equal([403, 'MANDATE_MISMATCH']);
      const ok = await post(r.app, '/agent/proposals', k.apiKey, { mandateId: 'mdt_alice_1', instrument: 'BTC-USDT', side: 'buy', quantity: '0.01' });
      expect(ok.body.data.executionPath).to.equal('mode_b_candidate');
      expect((await post(r.app, '/agent/proposals', k.apiKey, { instrument: 'BTC-USDT', side: 'buy', quantity: '0.01' })).status).to.equal(400); // mandate required
    });
  });

  describe('GET /agent/receipts/:id', () => {
    it('returns the owner\'s persisted decision; another owner\'s receipt is 404', async () => {
      const r = rig();
      const k = await issue(r);
      const ev = await post(r.app, '/agent/opportunities/evaluate', k.apiKey, { instrument: 'BTC-USDT' });
      const rc = await get(r.app, `/agent/receipts/${ev.body.data.receipt_id}`, k.apiKey);
      expect(rc.status).to.equal(200);
      expect(rc.body.data).to.include({ id: ev.body.data.receipt_id, decision: 'GO' });
      const eve = await r.keys.issue({ actor: { principalId: 'prn_eve', kind: 'human' }, principalId: 'prn_eve_bot', scope: 'READ', budgetCalls: 5, budgetUsdMicro: 0 });
      expect((await get(r.app, `/agent/receipts/${ev.body.data.receipt_id}`, eve.apiKey)).status).to.equal(404);
    });
  });

  describe('MCP tools', () => {
    it('evaluate_opportunity, propose_strategy, get_receipt register in the Stage 12 registry; still no placeOrder / withdraw', async () => {
      const tools = createMachineTools();
      expect(tools.map((t) => [t.name, t.tier])).to.deep.equal([['evaluate_opportunity', 'CONTROLLED'], ['propose_strategy', 'CONTROLLED'], ['get_receipt', 'READ']]);
      const created = [];
      const reg = new ToolRegistry({ read: { machine: { evaluate: async (p, a) => ({ decision: 'WAIT', for: p, instrument: a.instrument }), receipt: async (p, id) => ({ id, for: p }) } }, proposals: { create: async (x) => { created.push(x); return { proposalId: 'prp_000001', status: 'pending_review' }; } } });
      for (const t of [...createDefaultTools(), ...tools]) reg.register(t);
      expect((await reg.invoke({ name: 'evaluate_opportunity', arguments: { instrument: 'BTC-USDT' } }, { principalId: 'prn_bot', runId: 'run_1' })).output).to.deep.equal({ decision: 'WAIT', for: 'prn_bot', instrument: 'BTC-USDT' });
      expect((await reg.invoke({ name: 'propose_strategy', arguments: { dsl: { dsl: 'satelink.strategy/1.0' }, rationale: 'mean reversion idea' } }, { principalId: 'prn_bot', runId: 'run_1' })).status).to.equal('ok');
      expect(created[0]).to.include({ kind: 'strategy', principalId: 'prn_bot' });
      expect((await reg.invoke({ name: 'get_receipt', arguments: { receiptId: 'dec_000001' } }, { principalId: 'prn_bot', runId: 'run_1' })).output.id).to.equal('dec_000001');
      expect(reg.names().filter((nm) => isForbiddenToolName(nm))).to.deep.equal([]);
      for (const nm of ['place_order', 'withdraw', 'execute_trade']) expect(reg.has(nm)).to.equal(false);
    });
  });

  it('without a machine port the routes answer 501 (never guessed data)', async () => {
    const app = express();
    mountTradingRoutes(app, { env: ENV, api: { resolvePrincipal: async () => ({ principalId: 'prn_bot', kind: 'agent', via: 'api_key' }), services: createServicePorts({}), stepUp: { verify: async () => ({ ok: false }) }, idempotencyStore: new InMemoryIdempotencyStore() } });
    expect((await request(app).post(`${TRADING_MOUNT_PATH}/agent/opportunities/evaluate`).set('Idempotency-Key', 'idem-501-0001').send({ instrument: 'BTC-USDT' })).status).to.equal(501);
  });
});
