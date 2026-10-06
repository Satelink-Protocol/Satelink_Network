/**
 * Stage 30 — end-to-end PAPER loop on real Postgres (all migrations 001–030), deterministic:
 *   user → strategy (13) → backtest (14) → lifecycle PAPER → signed mandate (16) → agent proposal (12)
 *   → approval → risk (15) → OMS (17) → paper venue (MockBroker, Stage 10) → fills → portfolio (18)
 *   → P&L snapshot → Satelink fee (simulated; Stage 20 stopped) → sim ledger → receipt + trace (19)
 *   → observability (29): spans, metrics, alerts.
 * Plus failure injection: venue timeout (UNKNOWN → alert → reconciled), stale market data, global
 * kill switch, revoked mandate, unreachable broker (alert).
 *
 * The Binance Spot Testnet leg is a separate, opt-in suite (apps/api/test/trading_binance_testnet.test.js)
 * run by the nightly job with founder-provisioned testnet secrets.
 *
 * Default: testcontainers (CI). Local without Docker: TRADING_FOUNDATION_TEST_DB pointing at a
 * LOCAL server (the test creates and drops its own database). E2E_REPORT=<path> writes a JSON summary.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { applyMigrationsForTest } from './apply-migrations.js';
// @ts-expect-error — plain ESM JS modules from apps/api (no type declarations)
import { StrategyService, PgStrategyStore, LifecycleState as S } from '../../apps/api/src/trading_agent/strategies/index.mjs';
// @ts-expect-error
import { BacktestJobService, PgBacktestStore, backtestEvidence } from '../../apps/api/src/trading_agent/backtest/index.mjs';
// @ts-expect-error
import { tracedPool, runWithTrace, newTrace, TradeReceiptAssembler, PgReceiptSource } from '../../apps/api/src/trading_agent/audit/index.mjs';
// @ts-expect-error
import { ToolRegistry, createDefaultTools, ScriptedProvider, ModelRouter, TraceRecorder, PgTraceStore, AgentRunner } from '../../apps/api/src/trading_agent/agent/index.mjs';
// @ts-expect-error
import { MandateService, PgMandateStore } from '../../apps/api/src/trading_agent/authorization/index.mjs';
// @ts-expect-error
import { RiskEngine, PgRiskStore, KillSwitchService } from '../../apps/api/src/trading_agent/risk/index.mjs';
// @ts-expect-error
import { PgOmsStore, OrderAcceptanceService, OrderDispatcher, OrderReconciler } from '../../apps/api/src/trading_agent/oms/index.mjs';
// @ts-expect-error
import { PgPortfolioStore, FillConsumer, PortfolioSnapshotter } from '../../apps/api/src/trading_agent/portfolio/index.mjs';
// @ts-expect-error
import { MockBroker, MockScenario } from '../../apps/api/src/trading_agent/brokers/mock_broker.mjs';
// @ts-expect-error
import { InstrumentRegistry, defineInstrument } from '../../apps/api/src/trading_agent/brokers/symbols.mjs';
// @ts-expect-error
import { BrokerError } from '../../apps/api/src/trading_agent/brokers/errors.mjs';
// @ts-expect-error
import { expectedCommissionByFill, SimCommissionBook } from '../../apps/api/src/trading_agent/brokers/alpaca/index.mjs';
// @ts-expect-error
import { Tracer, InMemorySpanExporter, createTradingMetrics, instrumentBroker, collectUnknownOrders, collectKillSwitches, AlertEvaluator } from '../../apps/api/src/trading_agent/observability/index.mjs';

const HERE = import.meta.dirname ?? new URL('.', import.meta.url).pathname;
const MIGRATIONS_DIR = resolve(HERE, '..', 'migrations');
const T0 = Date.UTC(2026, 9, 6, 9, 0);
const H = 3_600_000;
const ENV = { TRADING_FLAG_TRADING_AGENT: 'true' };
const SPEC = defineInstrument({ canonical: 'BTC-USDT', venue: 'mock', venueSymbol: 'BTCUSDT', quoteCurrency: 'USDT', quoteDecimals: 2, tickSize: '0.01', lotSize: '0.0001', minQuantity: '0.0001', minNotional: '1' });
const alice = { principalId: 'prn_alice', kind: 'human', role: 'user' };
const admin = { principalId: 'prn_ops', kind: 'human', role: 'admin' };
const SATELINK_FEE_BPS = '10'; // SIMULATED fee schedule (pricing undecided; Stage 20 stopped)

const DSL = {
  dsl: 'satelink.strategy/1.0', name: 'SMA', universe: { venue: 'binance', instruments: ['BTC-USDT'] }, timeframe: '1h',
  indicators: { fast: { type: 'sma', period: 5 }, slow: { type: 'sma', period: 20 } },
  entry: { cross: { dir: 'above', left: { ind: 'fast' }, right: { ind: 'slow' } } },
  exit: { cross: { dir: 'below', left: { ind: 'fast' }, right: { ind: 'slow' } } },
  position: { side: 'long', sizing: { mode: 'fixed_notional', notional: '1000', currency: 'USDT' } }, risk: { stopLossPct: '3' },
};
const PARAMS = {
  params: 'satelink.sim-params/1.0', initialCash: '10000', quoteCurrency: 'USDT', windowBars: 60,
  instruments: { 'BTC-USDT': { tickSize: '0.01', lotSize: '0.0001', minQuantity: '0.0001', minNotional: '5' } },
  passCriteria: { minTrades: 1, maxDrawdownPct: '50' },
};
const CANDLES = Array.from({ length: 600 }, (_, i) => {
  const o = 100 + 10 * Math.sin(i / 15);
  const c = 100 + 10 * Math.sin((i + 1) / 15);
  return { instrument: 'BTC-USDT', openTime: T0 - 600 * H + i * H, open: o.toFixed(2), high: (Math.max(o, c) + 0.5).toFixed(2), low: (Math.min(o, c) - 0.5).toFixed(2), close: c.toFixed(2), volume: '100' };
});

function assertLocal(url: string): void {
  const u = new URL(url);
  const socketHost = u.searchParams.get('host');
  const local = ['localhost', '127.0.0.1', '::1', ''].includes(u.hostname) && (u.hostname !== '' || (socketHost ?? '').startsWith('/'));
  if (!local) throw new Error(`TRADING_FOUNDATION_TEST_DB must point at a local server, got "${u.hostname || socketHost}"`);
}

type Any = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

describe('Stage 30 — end-to-end paper loop', () => {
  let container: StartedPostgreSqlContainer | undefined;
  let adminUrl: string | undefined;
  let dbName: string | undefined;
  let pool: pg.Pool;
  const t = { now: T0 };
  const clock = () => new Date(t.now);
  let n = 0;
  const ids = (p: string) => `${p}_${String(++n).padStart(6, '0')}`;
  const report: Any = { stage: 30, startedAt: new Date().toISOString(), steps: [] as string[] };
  const step = (s: string) => report.steps.push(s);

  // shared wiring
  let traced: Any; let mandates: Any; let riskStore: Any; let killSwitches: Any; let strategies: Any;
  let mandateId = '';
  let quoteMode: 'fresh' | 'flagged_stale' | 'old' = 'fresh';
  const exporter = new InMemorySpanExporter();
  const tracer = new Tracer({ exporter, clock, batchSize: 1 });
  const metrics = createTradingMetrics();
  const alerts = new AlertEvaluator({ registry: metrics.registry });

  const ctxFor = async (o: Any) => ({
    now: t.now, flagsEnv: ENV,
    policy: { id: 'rsk_1', version: 1, hash: `sha256:${'a'.repeat(64)}`, currency: 'USDT', decimals: 2, maxOrderNotionalMinor: '100000', maxDailyNotionalMinor: '500000', maxDailyLossMinor: '20000', maxLeverage: '2', maxOpenPositions: 3, allowedInstruments: ['BTC-USDT'], killSwitch: false,
      limits: { maxPositionNotionalMinor: '200000', maxPriceDeviationBps: 100, maxQuoteAgeMs: 5000, maxOrdersPerMinute: 10, maxOrdersPerDay: 200, duplicateWindowMs: 2000, allowShort: false, breakers: { maxConsecutiveLosses: 5, maxConsecutiveRejects: 10, maxBrokerErrors: 5 } } },
    killSwitchEvents: await riskStore.killSwitchEvents({ principalId: 'prn_alice' }),
    brokerAccount: { id: 'bka_0001', principalId: 'prn_alice', broker: 'binance', environment: 'paper', status: 'active' },
    mandate: await mandates.verifyForOrder(o.mandateId).catch(() => null), strategy: null,
    instrument: { canonical: 'BTC-USDT', venue: 'mock', tickSize: '0.01', lotSize: '0.0001', minQuantity: '0.0001', minNotional: '5', quoteCurrency: 'USDT' },
    quote: { instrument: 'BTC-USDT', bid: '29990', ask: '30010', sourceTime: quoteMode === 'old' ? t.now - 60_000 : t.now - 500, stale: quoteMode === 'flagged_stale' },
    account: { equityMinor: '1000000', cashAvailableMinor: '800000', grossExposureMinor: '0' },
    activity: { idempotencyKeyUsed: false, ordersLastMinute: 0, ordersToday: 0, todayNotionalMinor: '0', realizedPnlTodayMinor: '0', unrealizedPnlMinor: '0', openPositions: [], lastSimilarOrderAt: null, consecutiveLosses: 0, consecutiveRejects: 0, brokerErrorsInWindow: 0 },
  });
  const acceptanceFor = (broker: Any) => new OrderAcceptanceService({ store: new PgOmsStore(traced), mandates, risk: new RiskEngine({ loadContext: ctxFor, store: new PgRiskStore(traced), clock, idFactory: ids }), venues: { capabilities: () => broker.capabilities() }, idFactory: ids, clock });
  const intent = (k: string, over: Any = {}) => ({ idempotencyKey: k, principalId: 'prn_alice', brokerAccountId: 'bka_0001', mandateId, origin: 'manual', approvedBy: 'prn_alice', mode: 'paper', venue: 'mock', instrument: 'BTC-USDT', side: 'buy', type: 'market', quantity: '0.001', ...over });

  beforeAll(async () => {
    let conn: string;
    const local = process.env.TRADING_FOUNDATION_TEST_DB;
    if (local) {
      assertLocal(local);
      adminUrl = local;
      dbName = `trading_e2e_${Date.now()}`;
      const a = new pg.Client({ connectionString: local });
      await a.connect();
      await a.query(`CREATE DATABASE ${dbName}`);
      await a.end();
      const u = new URL(local);
      u.pathname = `/${dbName}`;
      conn = u.toString();
    } else {
      container = await new PostgreSqlContainer('postgres:16-alpine').start();
      conn = container.getConnectionUri();
    }
    const result = await applyMigrationsForTest(conn, MIGRATIONS_DIR);
    expect(result.errors).toHaveLength(0);
    pool = new pg.Pool({ connectionString: conn, max: 8 });
    await pool.query(`INSERT INTO principals (id, kind, display_name, state) VALUES ('prn_alice', 'human', 'alice', 'active'), ('prn_ops', 'human', 'ops', 'active')`);
    await pool.query(`INSERT INTO broker_accounts (id, principal_id, broker, environment, status) VALUES ('bka_0001', 'prn_alice', 'binance', 'paper', 'active')`);
    traced = tracedPool(pool);
    riskStore = new PgRiskStore(pool);
    killSwitches = new KillSwitchService({ store: riskStore, clock });
    strategies = new StrategyService({ store: new PgStrategyStore(pool), idFactory: ids, env: ENV, clock });
    mandates = new MandateService({
      store: new PgMandateStore(traced), signer: { keyId: 'e2e-k1', secret: Buffer.alloc(32, 7) }, clock, idFactory: ids,
      stepUp: { async availability() { return { available: true }; }, async verify() { return { ok: true, method: 'totp', userId: 'u1' }; } },
      accounts: { async get() { return { id: 'bka_0001', principalId: 'prn_alice', broker: 'mock', environment: 'paper', status: 'active' }; } },
    });
  }, 180_000);

  afterAll(async () => {
    if (process.env.E2E_REPORT) writeFileSync(process.env.E2E_REPORT, JSON.stringify({ ...report, finishedAt: new Date().toISOString() }, null, 2));
    await pool?.end();
    if (container) await container.stop();
    if (adminUrl && dbName) {
      const a = new pg.Client({ connectionString: adminUrl });
      await a.connect();
      await a.query(`DROP DATABASE IF EXISTS ${dbName}`);
      await a.end();
    }
  });

  it('full loop: strategy → backtest → PAPER → mandate → agent → risk → OMS → fills → portfolio → P&L → fee → sim ledger → trace', async () => {
    // 1. strategy + immutable version
    const s = await strategies.createStrategy({ actor: alice, name: 'E2E SMA' });
    const v = await strategies.createVersion({ actor: alice, strategyId: s.id, dsl: DSL });
    step('strategy version');
    // 2. backtest (hypothetical) → lifecycle BACKTESTED → PAPER
    const jobs = new BacktestJobService({ store: new PgBacktestStore(pool), strategies, history: { getCandles: async () => CANDLES }, clock, newId: () => `bkt_${String(++n).padStart(12, '0')}` });
    const { id: backtestId } = await jobs.enqueue({ principalId: 'prn_alice', strategyVersionId: v.id, fromMs: T0 - 600 * H, toMs: T0, params: PARAMS });
    expect(await jobs.runOnce()).toMatchObject({ id: backtestId, status: 'completed' });
    const bt = await new PgBacktestStore(pool).get(backtestId);
    expect(bt).toMatchObject({ label: 'hypothetical', passed: true });
    await strategies.transition({ actor: alice, versionId: v.id, to: S.BACKTESTED, expectedFrom: S.DRAFT, evidence: { backtest: backtestEvidence(bt) } });
    await strategies.transition({ actor: alice, versionId: v.id, to: S.PAPER, expectedFrom: S.BACKTESTED, evidence: { approval: { approvedBy: 'prn_alice', note: 'paper trial' } } });
    expect((await strategies.getVersion(v.id)).state).toBe(S.PAPER);
    report.backtest = { id: backtestId, label: bt.label, passed: bt.passed, bars: bt.bars };
    step('backtest and paper promotion');

    // 3. user-signed mandate (step-up)
    const p = await mandates.propose({ actor: alice, principalId: 'prn_alice', draft: { brokerAccountId: 'bka_0001', environment: 'paper', mode: 'A', strategy: null, instruments: ['BTC-USDT'], limits: { currency: 'USDT', decimals: 2, maxOrderNotionalMinor: '100000', maxDailyNotionalMinor: '500000' }, validUntil: new Date(T0 + 30 * 86_400_000).toISOString() } });
    await mandates.sign({ actor: alice, mandateId: p.mandateId, termsHash: p.termsHash, nonce: p.nonce, code: '123456' });
    mandateId = p.mandateId;
    t.now += 60_000;
    step('mandate signed');

    // 4. agent proposes (cannot place) → user approves → acceptance (risk + OMS), one trace
    const broker = instrumentBroker(new MockBroker({ credentialLoader: { async load() { return {}; } }, instruments: new InstrumentRegistry([SPEC]), clock, marketPrices: { 'BTC-USDT': '30000' }, defaultScenario: MockScenario.FILL }), { tracer, metrics, clock });
    const trace = newTrace();
    let proposal: Any = null;
    let orderId = '';
    await runWithTrace(trace, async () => {
      const registry = new ToolRegistry({ read: {}, proposals: { async create(x: Any) { proposal = x; return { proposalId: 'prp_000001', status: 'pending_review' }; } } });
      for (const tool of createDefaultTools()) registry.register(tool);
      const provider = new ScriptedProvider({ id: 'scripted', script: [
        { toolCalls: [{ id: 'c1', name: 'propose_order', arguments: JSON.stringify({ mandateId, instrument: 'BTC-USDT', side: 'buy', type: 'market', quantity: '0.002', rationale: 'Fast SMA crossed above slow on 1h; within mandate limits.' }) }] },
        { content: 'Proposed a 0.002 BTC paper buy for your approval.' },
      ] });
      const runner = new AgentRunner({ registry, router: new ModelRouter({ routes: { chat: [{ provider: 'scripted', model: 's-1' }] }, providers: { scripted: provider } }), tracer: new TraceRecorder({ store: new PgTraceStore(traced), clock, idFactory: ids }) });
      await runner.run({ principalId: 'prn_alice', goal: 'Trade my SMA strategy on paper.' });
      expect(proposal).not.toBeNull();
      expect(proposal.payload).toMatchObject({ instrument: 'BTC-USDT', side: 'buy', quantity: '0.002', mandateId });
      const prop = proposal.payload;
      const a = await acceptanceFor(broker).accept(intent('idem_e2e_000001', { origin: 'llm_proposal', mandateId: prop.mandateId, quantity: prop.quantity }));
      expect(a).toMatchObject({ accepted: true });
      orderId = a.orderId;
    });
    step('agent proposal approved and accepted');

    // 5. workers: dispatch to the paper venue, ingest fills → positions
    const adapters = { forVenue: () => broker };
    t.now += 1_000;
    expect(await new OrderDispatcher({ store: new PgOmsStore(pool), adapters, mandates, clock }).runOnce()).toBe('placed');
    const ingest = await new FillConsumer({ store: new PgPortfolioStore(pool), adapters, clock }).runOnce();
    expect(ingest.fillsInserted).toBeGreaterThanOrEqual(1);
    step('dispatched and filled');

    // 6. portfolio + P&L (fees from the venue; exact minor units)
    const pos = (await pool.query(`SELECT quantity::text AS q, avg_entry_price::text AS p, realized_pnl_minor::text AS r, fees_minor::text AS f FROM positions WHERE broker_account_id = 'bka_0001'`)).rows[0];
    expect(pos.q).toMatch(/^0\.002/);
    const snap = await new PortfolioSnapshotter({ store: new PgPortfolioStore(pool), marks: { async mark() { return { price: '31000', stale: false }; } }, clock }).take({ principalId: 'prn_alice', brokerAccountId: 'bka_0001', mode: 'paper' });
    expect(snap).toMatchObject({ marksComplete: true, unrealizedPnlMinor: '200' });
    report.portfolio = { position: pos, unrealizedPnlMinor: snap.unrealizedPnlMinor };
    step('portfolio pnl');

    // 7. Satelink fee (SIMULATED schedule) → sim ledger, balanced; the real ledger is untouched
    const fills = (await pool.query(`SELECT broker_fill_id, quantity::text AS q, price::text AS p FROM fills ORDER BY executed_at`)).rows;
    const split = expectedCommissionByFill({ qty: '0.002', side: 'buy', commission: SATELINK_FEE_BPS, commissionType: 'bps' }, fills.map((f: Any) => ({ fillId: f.broker_fill_id, qty: f.q, price: f.p })));
    const book = new SimCommissionBook();
    for (const x of split) book.post({ fillId: x.fillId, alpacaAccountId: 'bka_0001', clientOrderId: orderId, expectedCents: x.cents, at: clock().toISOString() });
    expect(split.reduce((s2: bigint, x: Any) => s2 + x.cents, 0n)).toBe(6n); // 0.002 × 30000 × 10 bps = 0.06 USDT
    expect(book.balanced()).toBe(true);
    expect(book.balance('sim:correspondent:commission_revenue')).toBe(6n);
    expect((await pool.query(`SELECT count(*)::int AS n FROM ledger_entries`)).rows[0].n).toBe(0);
    report.fee = { schedule: `${SATELINK_FEE_BPS} bps (simulated)`, cents: '6', simLedgerBalanced: true };
    step('fee to sim ledger');

    // 8. trace + receipt: one trace from agent run to fills; complete receipt
    const traceOf = async (sql: string, params: unknown[]) => (await pool.query(sql, params)).rows.map((r: Any) => r.trace_id);
    expect(await traceOf(`SELECT trace_id FROM agent_runs`, [])).toEqual([trace.traceId]);
    expect(await traceOf(`SELECT trace_id FROM orders WHERE id = $1`, [orderId])).toEqual([trace.traceId]);
    expect(new Set(await traceOf(`SELECT trace_id FROM fills`, []))).toEqual(new Set([trace.traceId]));
    const receipt = await new TradeReceiptAssembler({ source: new PgReceiptSource(pool), clock }).explainOrder({ principalId: 'prn_alice', orderId });
    expect(receipt.completeness).toMatchObject({ complete: true, missing: [] });
    expect(receipt.why).toMatchObject({ origin: 'agent' });
    expect(receipt.why.risk).toMatchObject({ decision: 'APPROVE', checksPassed: 20 });
    expect(receipt.what).toMatchObject({ status: 'filled', mode: 'paper' });
    report.trace = { traceId: trace.traceId, traceparent: receipt.traceparent, receiptHash: receipt.receiptHash, complete: true };
    step('receipt complete');

    // 9. observability: the broker call was traced and counted
    expect(exporter.spans.some((x: Any) => x.name === 'broker.placeOrder' && x.attributes['trading.outcome'] === 'ok')).toBe(true);
    const json = await metrics.registry.getMetricsAsJSON();
    expect(json.find((m: Any) => m.name === 'trading_broker_requests_total').values.some((v: Any) => v.labels.operation === 'placeOrder' && v.value >= 1)).toBe(true);
    step('observability');
  });

  it('failure injection: venue timeout → UNKNOWN → alert → reconciled (one venue order) → alert resolves', async () => {
    const raw = new MockBroker({ credentialLoader: { async load() { return {}; } }, instruments: new InstrumentRegistry([SPEC]), clock, marketPrices: { 'BTC-USDT': '30000' }, defaultScenario: MockScenario.TIMEOUT_AFTER_ACCEPT });
    const broker = instrumentBroker(raw, { tracer, metrics, clock });
    const a = await acceptanceFor(broker).accept(intent('idem_e2e_timeout1'));
    const adapters = { forVenue: () => broker };
    expect(await new OrderDispatcher({ store: new PgOmsStore(pool), adapters, mandates, clock }).runOnce()).toBe('unknown');
    const omsStore = new PgOmsStore(pool);
    expect((await collectUnknownOrders({ omsStore, metrics, clock })).count).toBe(1);
    await alerts.evaluate(t.now);
    t.now += 6 * 60_000;
    await collectUnknownOrders({ omsStore, metrics, clock });
    expect((await alerts.evaluate(t.now)).filter((x: Any) => x.state === 'firing').map((x: Any) => x.rule)).toContain('TradingUnknownOrderAging');
    await new OrderReconciler({ store: omsStore, adapters, clock, sentGraceMs: 30_000 }).runOnce();
    expect((await omsStore.getOrder(a.orderId)).status).toBe('acknowledged');
    expect((await collectUnknownOrders({ omsStore, metrics, clock })).count).toBe(0);
    expect((await alerts.evaluate(t.now)).filter((x: Any) => x.state === 'resolved').map((x: Any) => x.rule)).toContain('TradingUnknownOrderAging');
    expect((await raw.getOrder('bka_0001', { clientOrderId: a.clientOrderId })).status).toBe('acknowledged'); // exactly one venue order exists
    step('failure timeout unknown reconciled');
  });

  it('failure injection: stale market data, a global kill switch and a revoked mandate are all refused before the venue', async () => {
    const raw = new MockBroker({ credentialLoader: { async load() { return {}; } }, instruments: new InstrumentRegistry([SPEC]), clock, marketPrices: { 'BTC-USDT': '30000' }, defaultScenario: MockScenario.FILL });
    let venueCalls = 0;
    const place = raw.placeOrder.bind(raw);
    raw.placeOrder = async (...args: unknown[]) => { venueCalls += 1; return place(...args); };
    const acc = acceptanceFor(raw);
    // two independent staleness checks: the provider's stale flag, and the quote's own age
    quoteMode = 'flagged_stale';
    expect(await acc.accept(intent('idem_e2e_stale01'))).toMatchObject({ accepted: false, reason: 'RISK_STALE_MARKET_DATA' });
    quoteMode = 'old';
    expect(await acc.accept(intent('idem_e2e_stale02'))).toMatchObject({ accepted: false, reason: 'RISK_STALE_MARKET_DATA' });
    quoteMode = 'fresh';

    await killSwitches.engage({ actor: admin, scopeType: 'global', reason: 'e2e drill' });
    collectKillSwitches({ engaged: await killSwitches.engaged('prn_alice'), metrics });
    expect((await alerts.evaluate(t.now)).filter((x: Any) => x.state === 'firing').map((x: Any) => x.rule)).toContain('TradingGlobalKillSwitch');
    expect(await acc.accept(intent('idem_e2e_kill001'))).toMatchObject({ accepted: false, reason: 'RISK_KILL_SWITCH' });
    await killSwitches.release({ actor: admin, scopeType: 'global', reason: 'drill over' });
    collectKillSwitches({ engaged: await killSwitches.engaged('prn_alice'), metrics });

    await mandates.revoke({ actor: alice, mandateId, reason: 'e2e drill' });
    const r = await acc.accept(intent('idem_e2e_revoke1'));
    expect(r.accepted).toBe(false);
    expect(r.reason).toMatch(/^MANDATE_/);
    // refused at acceptance ⇒ no order row, so no dispatcher run can ever reach the venue
    expect(await new OrderDispatcher({ store: new PgOmsStore(pool), adapters: { forVenue: () => raw }, mandates, clock }).runOnce()).toBe(null);
    expect(venueCalls).toBe(0);
    const placed = (await pool.query(`SELECT count(*)::int AS n FROM orders WHERE idempotency_key IN ('idem_e2e_stale01', 'idem_e2e_stale02', 'idem_e2e_kill001', 'idem_e2e_revoke1')`)).rows[0].n;
    expect(placed).toBe(0);
    step('failure risk and authority refusals');
  });

  it('failure injection: an unreachable broker is counted as down and alerts after 2 minutes', async () => {
    const down = instrumentBroker({ capabilities: () => ({ venue: 'binance' }), getOrder: async () => { throw new BrokerError('VENUE_UNAVAILABLE', { venue: 'binance' }); } }, { tracer, metrics, clock });
    for (let i = 0; i < 3; i++) {
      await down.getOrder('bka_0001', { clientOrderId: 'x' }).catch(() => {});
      await alerts.evaluate(t.now);
      t.now += 60_000;
    }
    expect(alerts.firing()).toContain('TradingBrokerUnreachable|binance');
    report.alertsFired = alerts.firing();
    step('failure broker down alert');
  });
});
