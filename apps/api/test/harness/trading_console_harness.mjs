// Stage 25 paper E2E harness: a local stand-in for the API that the console talks to.
//   GET /api/identity/get-session  → a fixed test session for cookie satelink.session_token=e2e-alice
//   /v1/trading/*                  → the REAL Stage 24 router over in-memory Stage 13/15/17/19 services,
//                                    with the Stage 10 MockBroker as the venue (paper; nothing external)
// A dispatcher + reconciler tick every 300 ms so orders move like they would in production.
// Local only (binds 127.0.0.1). Run: PORT=3419 node test/harness/trading_console_harness.mjs
import express from 'express';
import { createHash } from 'node:crypto';
import { mountTradingRoutes } from '../../src/trading_agent/index.mjs';
import { createServicePorts } from '../../src/trading_agent/api/index.mjs';
import { StrategyService, InMemoryStrategyStore } from '../../src/trading_agent/strategies/index.mjs';
import { KillSwitchService, RiskPolicyService, InMemoryRiskStore } from '../../src/trading_agent/risk/index.mjs';
import { OrderAcceptanceService, OrderDispatcher, OrderReconciler, InMemoryOmsStore } from '../../src/trading_agent/oms/index.mjs';
import { MockBroker, MockScenario } from '../../src/trading_agent/brokers/mock_broker.mjs';
import { InstrumentRegistry, defineInstrument } from '../../src/trading_agent/brokers/symbols.mjs';
import { TradeReceiptAssembler } from '../../src/trading_agent/audit/index.mjs';

const PORT = Number(process.env.PORT ?? 3419);
const ENV = { TRADING_FLAG_TRADING_AGENT: 'true', TRADING_FLAG_MCP_TRADING: 'true' };
const SESSION = { user: { id: 'usr_e2e_alice', name: 'E2E Alice', email: 'alice@example.invalid', emailVerified: true, twoFactorEnabled: true }, session: { id: 'ses_e2e', expiresAt: '2099-01-01T00:00:00Z' } };
const TERMS = `sha256:${'e'.repeat(64)}`;
let n = 0;
const ids = (p) => `${p}_${Date.now().toString(36)}${String(++n).padStart(4, '0')}`;
const signedIn = (req) => /(^|;\s*)satelink\.session_token=e2e-alice(;|$)/.test(req.get('cookie') ?? '');

const strategyStore = new InMemoryStrategyStore();
const riskStore = new InMemoryRiskStore();
const omsStore = new InMemoryOmsStore();
const broker = new MockBroker({ credentialLoader: { load: async () => ({}) }, instruments: new InstrumentRegistry([defineInstrument({ canonical: 'BTC-USDT', venue: 'mock', venueSymbol: 'BTCUSDT', quoteCurrency: 'USDT', quoteDecimals: 2, tickSize: '0.01', lotSize: '0.0001', minQuantity: '0.0001', minNotional: '1' })]), defaultScenario: MockScenario.ACK, clock: () => new Date() });
const adapters = { forVenue: () => broker };
const mandate = { id: 'mdt_e2e_1', principalId: 'prn_e2e_alice', brokerAccountId: 'bka_e2e_1', currency: 'USDT', decimals: 2, termsHash: TERMS, status: 'active', approvedBy: 'prn_e2e_alice' };
const mandates = { async verifyForOrder(id) { if (id !== mandate.id) throw Object.assign(new Error('mandate not found'), { code: 'NOT_FOUND' }); return mandate; } };
const decisions = new Map();
const risk = { async decide() { const d = { decisionId: ids('rdc'), decision: 'APPROVE', recorded: true, failedCheck: null, checksVersion: 'risk-checks/1.1', engineVersion: 'harness', trace: [] }; decisions.set(d.decisionId, d); return d; } };
const acceptance = new OrderAcceptanceService({ store: omsStore, mandates, risk, venues: { capabilities: () => broker.capabilities() }, idFactory: ids });
const riskPolicies = new RiskPolicyService({ store: riskStore, planCaps: async () => ({ maxLeverage: '3', currency: 'USDT' }), idFactory: ids });
await riskPolicies.createVersion({ actor: { principalId: 'prn_e2e_alice', kind: 'human', role: 'user' }, principalId: 'prn_e2e_alice',
  draft: { currency: 'USDT', decimals: 2, maxOrderNotionalMinor: '100000', maxDailyNotionalMinor: '500000', maxDailyLossMinor: '20000', maxLeverage: '2', maxOpenPositions: 3, allowedInstruments: ['BTC-USDT'], killSwitch: false } });

const traceOf = (orderId) => createHash('sha256').update(orderId).digest('hex').slice(0, 32);
const receipts = new TradeReceiptAssembler({ source: {
  // In Postgres the 029 triggers stamp trace ids; in memory every order gets one, stamped the same way.
  order: async (id) => { const o = await omsStore.getOrder(id); return o && { ...o, traceId: traceOf(id), spanId: 'b7ad6b7169203331' }; },
  orderEvents: async (id) => omsStore.state.events.filter((e) => e.orderId === id).map((e) => ({ ...e, createdAt: e.at, traceId: traceOf(id), spanId: 'b7ad6b7169203331' })),
  fills: async () => [], riskDecision: async (id) => decisions.get(id) ?? null, mandate: async () => ({ ...mandate, signedAt: Date.now() }),
  agentRuns: async () => [], toolCalls: async () => [], signals: async () => [], auditByTrace: async () => [],
} });

const services = createServicePorts({
  strategyService: new StrategyService({ store: strategyStore, idFactory: ids, env: ENV }), strategyStore,
  backtestJobs: { enqueue: async () => { throw Object.assign(new Error('not in harness'), { code: 'NOT_IMPLEMENTED' }); } }, backtestStore: { get: async () => null },
  riskPolicyService: riskPolicies, killSwitchService: new KillSwitchService({ store: riskStore }),
  mandateService: {}, mandateStore: { getMandate: async (id) => (id === mandate.id ? mandate : null) },
  acceptance, omsStore, receipts,
  portfolio: { positions: async () => [], snapshots: async () => [] },
});

const app = express();
app.get('/api/identity/get-session', (req, res) => res.json(signedIn(req) ? SESSION : null));
mountTradingRoutes(app, { env: ENV, api: {
  resolvePrincipal: async (req) => (signedIn(req) ? { principalId: 'prn_e2e_alice', kind: 'human', via: 'session' } : null),
  services, stepUp: { verify: async ({ code }) => (code === '123456' ? { ok: true, method: 'totp' } : { ok: false }) },
} });
app.use((_req, res) => res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'not found' } }));

const dispatcher = new OrderDispatcher({ store: omsStore, adapters, mandates, leaseMs: 30_000, submitTimeoutMs: 5_000, notFoundGraceMs: 120_000 });
const reconciler = new OrderReconciler({ store: omsStore, adapters, sentGraceMs: 0, notFoundGraceMs: 120_000 });
setInterval(() => { dispatcher.runOnce().then(() => reconciler.runOnce()).catch(() => {}); }, 300).unref?.();
app.listen(PORT, '127.0.0.1', () => console.log(`[trading-console-harness] http://127.0.0.1:${PORT}`)); // eslint-disable-line no-console
