import { expect } from 'chai';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import client from 'prom-client';
import {
  Tracer, InMemorySpanExporter, OtlpJsonExporter, sanitizeAttributes, createTradingMetrics, instrumentBroker, instrumentMarketData, instrumentReconciler,
  collectUnknownOrders, collectKillSwitches, recordPortfolioReconciliation, collectRevenueVariance, ALERT_RULES, AlertEvaluator, renderPrometheusRules,
  renderGrafanaDashboard, PANELS,
} from '../src/trading_agent/observability/index.mjs';
import { newTrace, runWithTrace } from '../src/trading_agent/audit/index.mjs';
import { MockBroker, MockScenario } from '../src/trading_agent/brokers/mock_broker.mjs';
import { InstrumentRegistry, defineInstrument } from '../src/trading_agent/brokers/symbols.mjs';
import { BrokerError } from '../src/trading_agent/brokers/errors.mjs';
import { InMemoryOmsStore } from '../src/trading_agent/oms/index.mjs';

// Stage 29 — observability. Pure: in-memory exporter, fake fetch, isolated prom-client registry.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const DIR = path.resolve(HERE, '../src/trading_agent/observability');
const T0 = Date.UTC(2026, 9, 6, 9, 0);
const SPEC = defineInstrument({ canonical: 'BTC-USDT', venue: 'mock', venueSymbol: 'BTCUSDT', quoteCurrency: 'USDT', quoteDecimals: 2, tickSize: '0.01', lotSize: '0.0001', minQuantity: '0.0001', minNotional: '1' });
const errOf = async (p) => { try { await p; } catch (e) { return e; } throw new Error('expected a rejection'); };
// fake secrets assembled from parts (the repo's pre-commit gate greps for literal prefixes)
const FAKE_GH = ['gh', 'p_'].join('') + 'A1b2C3d4E5f6G7h8I9j0K1l2';
const FAKE_PG = ['postgres', '://admin:hunter2-very-secret@db.example.invalid/x'].join('');

function rig() {
  const t = { now: T0 };
  const clock = () => new Date(t.now);
  const exporter = new InMemorySpanExporter();
  const tracer = new Tracer({ exporter, clock, batchSize: 1 });
  const metrics = createTradingMetrics();
  return { t, clock, exporter, tracer, metrics };
}
const value = async (metrics, name, labels = {}) => {
  const m = (await metrics.registry.getMetricsAsJSON()).find((x) => x.name === name);
  const v = m?.values.find((x) => Object.entries(labels).every(([k, val]) => x.labels?.[k] === val));
  return v?.value;
};

describe('observability: spans', () => {
  it('broker calls produce spans with the required attributes, inside the current Stage 19 trace', async () => {
    const r = rig();
    const broker = instrumentBroker(new MockBroker({ credentialLoader: { load: async () => ({}) }, instruments: new InstrumentRegistry([SPEC]), defaultScenario: MockScenario.ACK }), r);
    const trace = newTrace();
    await runWithTrace(trace, () => broker.placeOrder('bka_obs_1', { clientOrderId: 'sl00000000000000000001', instrument: 'BTC-USDT', side: 'buy', type: 'limit', quantity: '0.001', limitPrice: '30000' }));
    const [span] = r.exporter.spans;
    expect(span).to.include({ name: 'broker.placeOrder', traceId: trace.traceId, parentSpanId: trace.spanId, status: 'ok' });
    expect(span.spanId).to.match(/^[0-9a-f]{16}$/);
    expect(span.attributes).to.deep.equal({ 'trading.venue': 'mock', 'trading.operation': 'placeOrder', 'trading.broker_account.id': 'bka_obs_1', 'trading.client_order_id': 'sl00000000000000000001', 'trading.instrument': 'BTC-USDT', 'service.component': 'broker', 'trading.outcome': 'ok' });
  });

  it('errors record the error CODE only — never the message (which may carry venue text or secrets)', async () => {
    const r = rig();
    const failing = { capabilities: () => ({ venue: 'binance' }), getOrder: async () => { throw new BrokerError('AUTH_FAILED', { venue: 'binance', message: `bad key ${FAKE_GH}` }); } };
    const e = await errOf(instrumentBroker(failing, r).getOrder('bka_obs_1', { clientOrderId: 'c1' }));
    expect(e.code).to.equal('AUTH_FAILED');
    const [span] = r.exporter.spans;
    expect(span).to.include({ status: 'error' });
    expect(span.attributes).to.include({ 'trading.outcome': 'error', 'trading.error.code': 'AUTH_FAILED' });
    expect(JSON.stringify(span)).to.not.include(FAKE_GH);
    expect(JSON.stringify(span)).to.not.include('bad key');
  });

  it('redaction: unknown or secret-named attributes are dropped; secret-looking values are redacted; long values truncated', () => {
    const out = sanitizeAttributes({
      'trading.venue': 'binance', apiKey: 'x', 'trading.secret': 'y', authorization: 'Bearer abc', 'http.request.header.cookie': 'c', 'random.attr': 'z',
      'trading.instrument': `pair ${FAKE_GH}`, 'trading.order.id': FAKE_PG, 'trading.client_order_id': 'a'.repeat(400), 'trading.market_data.stale': true, 'trading.reconcile.errors': 3,
    });
    expect(Object.keys(out).sort()).to.deep.equal(['trading.client_order_id', 'trading.instrument', 'trading.market_data.stale', 'trading.order.id', 'trading.reconcile.errors', 'trading.venue']);
    expect(out['trading.instrument']).to.equal('pair [REDACTED]');
    expect(out['trading.order.id']).to.not.include('hunter2');
    expect(out['trading.client_order_id']).to.have.length(256);
    expect(out).to.include({ 'trading.market_data.stale': true, 'trading.reconcile.errors': 3 });
  });

  it('OTLP/HTTP JSON: valid resourceSpans shape; exporter failures are counted and never thrown', async () => {
    const posted = [];
    const ok = new OtlpJsonExporter({ endpoint: 'http://collector.local:4318/', fetch: async (url, init) => { posted.push({ url, body: JSON.parse(init.body) }); return new Response('{}', { status: 200 }); } });
    const tracer = new Tracer({ exporter: ok, clock: () => new Date(T0), batchSize: 10 });
    await tracer.withSpan('oms.reconcile', { 'trading.reconcile.checked': 2, 'trading.market_data.stale': false, 'service.component': 'oms' }, async () => {});
    await tracer.flush();
    expect(posted[0].url).to.equal('http://collector.local:4318/v1/traces');
    const s = posted[0].body.resourceSpans[0].scopeSpans[0].spans[0];
    expect(posted[0].body.resourceSpans[0].resource.attributes).to.deep.equal([{ key: 'service.name', value: { stringValue: 'satelink-trading' } }]);
    expect(s).to.include({ name: 'oms.reconcile', kind: 1, startTimeUnixNano: String(BigInt(T0) * 1_000_000n) });
    expect(s.traceId).to.match(/^[0-9a-f]{32}$/);
    expect(s.attributes).to.deep.include({ key: 'trading.reconcile.checked', value: { intValue: '2' } });
    expect(s.attributes).to.deep.include({ key: 'trading.market_data.stale', value: { boolValue: false } });
    expect(s.status).to.deep.equal({ code: 1 });

    const down = new OtlpJsonExporter({ endpoint: 'http://collector.local:4318', fetch: async () => { throw new Error('ECONNREFUSED'); } });
    const t2 = new Tracer({ exporter: down, batchSize: 1 });
    expect(await t2.withSpan('x', {}, async () => 42)).to.equal(42); // business result unaffected
    expect(down.failures).to.equal(1);
    await down.export([]); // the exporter itself never throws either
    expect(down.failures).to.equal(2);
    expect(() => new OtlpJsonExporter({ endpoint: 'ftp://x', fetch })).to.throw(TypeError);
  });
});

describe('observability: metrics and collectors', () => {
  it('broker reachability: business errors keep the venue up; unreachable / ambiguous mark it down', async () => {
    const r = rig();
    let mode = 'ok';
    const venue = { capabilities: () => ({ venue: 'binance' }), getOrder: async () => { if (mode === 'ok') return {}; throw new BrokerError(mode, { venue: 'binance' }); } };
    const b = instrumentBroker(venue, r);
    await b.getOrder('bka_obs_1', { clientOrderId: 'c' });
    expect(await value(r.metrics, 'trading_broker_up', { venue: 'binance' })).to.equal(1);
    mode = 'ORDER_NOT_FOUND'; await errOf(b.getOrder('bka_obs_1', { clientOrderId: 'c' }));
    expect(await value(r.metrics, 'trading_broker_up', { venue: 'binance' })).to.equal(1);
    mode = 'VENUE_UNAVAILABLE'; await errOf(b.getOrder('bka_obs_1', { clientOrderId: 'c' }));
    expect(await value(r.metrics, 'trading_broker_up', { venue: 'binance' })).to.equal(0);
    expect(await value(r.metrics, 'trading_broker_requests_total', { venue: 'binance', operation: 'getOrder', outcome: 'unreachable' })).to.equal(1);
    expect(await value(r.metrics, 'trading_broker_requests_total', { venue: 'binance', operation: 'getOrder', outcome: 'error' })).to.equal(1);
  });

  it('market data age + stale counter; UNKNOWN orders; kill switches; portfolio mismatches; exact revenue variance', async () => {
    const r = rig();
    const md = instrumentMarketData({ getQuote: async () => ({ data: {}, freshness: { ageMs: 90_000, stale: true } }) }, { ...r, venue: 'binance' });
    await md.getQuote('prn_a', 'BTC-USDT');
    expect(await value(r.metrics, 'trading_market_data_age_seconds', { venue: 'binance' })).to.equal(90);
    expect(await value(r.metrics, 'trading_market_data_stale_total', { venue: 'binance' })).to.equal(1);
    expect(r.exporter.spans[0].attributes).to.include({ 'trading.market_data.age_ms': 90000, 'trading.market_data.stale': true });

    const oms = new InMemoryOmsStore();
    await oms.insertOrder({ id: 'ord_u1', idempotencyKey: 'idem_obs_u1', clientOrderId: 'slobs1', status: 'unknown', unknownSince: T0 - 400_000, createdAt: T0 - 500_000 });
    await oms.insertOrder({ id: 'ord_u2', idempotencyKey: 'idem_obs_u2', clientOrderId: 'slobs2', status: 'unknown', unknownSince: T0 - 100_000, createdAt: T0 - 200_000 });
    await oms.insertOrder({ id: 'ord_ok', idempotencyKey: 'idem_obs_ok', clientOrderId: 'slobs3', status: 'acknowledged', createdAt: T0 });
    expect(await collectUnknownOrders({ omsStore: oms, metrics: r.metrics, clock: r.clock })).to.deep.equal({ count: 2, oldestSeconds: 400 });

    collectKillSwitches({ engaged: [{ scopeType: 'global' }, { scopeType: 'principal' }, { scopeType: 'principal' }], metrics: r.metrics });
    expect(await value(r.metrics, 'trading_kill_switches_engaged', { scope: 'principal' })).to.equal(2);
    expect(await value(r.metrics, 'trading_kill_switches_engaged', { scope: 'mandate' })).to.equal(0);

    recordPortfolioReconciliation({ status: 'match', mode: 'paper' }, r);
    recordPortfolioReconciliation({ status: 'mismatch', mode: 'paper' }, r);
    expect(await value(r.metrics, 'trading_portfolio_reconciliation_mismatch_total', { mode: 'paper' })).to.equal(1);

    expect(collectRevenueVariance({ sources: { razorpay_test: { settledMinor: '99800', bookedMinor: '49900' }, alpaca_commission: { settledMinor: '100', bookedMinor: '100' } }, metrics: r.metrics })).to.deep.equal({ razorpay_test: 49900n, alpaca_commission: 0n });
    // beyond 2^53: exact bigint arithmetic, never floats
    expect(collectRevenueVariance({ sources: { big: { settledMinor: '9007199254740995', bookedMinor: '0' } }, metrics: r.metrics })).to.deep.equal({ big: 9007199254740995n });

    const rec = instrumentReconciler({ runOnce: async () => ({ checked: 3, updated: 1, requeued: 0, cancelsRequested: 0, errors: 2 }) }, r);
    await rec.runOnce();
    expect(await value(r.metrics, 'trading_reconcile_errors_total')).to.equal(2);
  });

  it('the trading registry is separate: the default prom-client registry (existing /metrics) gains nothing', async () => {
    createTradingMetrics();
    expect((await client.register.getMetricsAsJSON()).filter((m) => m.name.startsWith('trading_'))).to.deep.equal([]);
  });
});

describe('observability: alerts — failure injection', () => {
  async function fired(ev, now) { return (await ev.evaluate(now)).filter((x) => x.state === 'firing').map((x) => `${x.rule}${x.key ? `:${x.key}` : ''}`); }

  it('healthy metrics fire nothing', async () => {
    const r = rig();
    r.metrics.brokerUp.set({ venue: 'binance' }, 1); r.metrics.marketDataAge.set({ venue: 'binance' }, 2); r.metrics.unknownOldest.set(0);
    collectKillSwitches({ engaged: [], metrics: r.metrics });
    const ev = new AlertEvaluator({ registry: r.metrics.registry });
    for (let i = 0; i <= 10; i++) expect(await fired(ev, T0 + i * 60_000)).to.deep.equal([]);
  });

  it('broker down: pending for 2 minutes, then fires (critical); resolves when it recovers', async () => {
    const r = rig();
    const ev = new AlertEvaluator({ registry: r.metrics.registry });
    r.metrics.brokerUp.set({ venue: 'binance' }, 0);
    expect(await fired(ev, T0)).to.deep.equal([]);
    expect(await fired(ev, T0 + 60_000)).to.deep.equal([]);
    expect(await fired(ev, T0 + 120_000)).to.deep.equal(['TradingBrokerUnreachable:binance']);
    expect(ev.firing()).to.deep.equal(['TradingBrokerUnreachable|binance']);
    r.metrics.brokerUp.set({ venue: 'binance' }, 1);
    expect((await ev.evaluate(T0 + 180_000)).map((x) => `${x.rule}:${x.state}`)).to.deep.equal(['TradingBrokerUnreachable:resolved']);
  });

  it('stale market data for 5 minutes; UNKNOWN orders aging past 5 and 30 minutes', async () => {
    const r = rig();
    const ev = new AlertEvaluator({ registry: r.metrics.registry });
    r.metrics.marketDataAge.set({ venue: 'upstox' }, 120);
    r.metrics.unknownOldest.set(301);
    expect(await fired(ev, T0)).to.deep.equal(['TradingUnknownOrderAging']);
    expect(await fired(ev, T0 + 300_000)).to.deep.equal(['TradingMarketDataStale:upstox']);
    r.metrics.unknownOldest.set(1801);
    expect(await fired(ev, T0 + 310_000)).to.deep.equal(['TradingUnknownOrderStuck']);
  });

  it('reconciliation failures, a portfolio mismatch, the global kill switch and revenue variance', async () => {
    const r = rig();
    const ev = new AlertEvaluator({ registry: r.metrics.registry });
    await ev.evaluate(T0); // baseline for counters
    r.metrics.reconcileErrors.inc(6);
    recordPortfolioReconciliation({ status: 'mismatch', mode: 'paper' }, r);
    collectKillSwitches({ engaged: [{ scopeType: 'global' }], metrics: r.metrics });
    collectRevenueVariance({ sources: { razorpay_test: { settledMinor: '100', bookedMinor: '99' } }, metrics: r.metrics });
    expect((await fired(ev, T0 + 60_000)).sort()).to.deep.equal(['TradingGlobalKillSwitch:global', 'TradingKillSwitchEngaged', 'TradingPortfolioMismatch', 'TradingReconcileErrors']);
    // an hour later: variance has persisted for its 1h `for` ⇒ fires; counters saw no new errors in their window ⇒ resolve
    const later = await ev.evaluate(T0 + 60_000 + 3_600_000);
    expect(later.filter((x) => x.state === 'firing').map((x) => `${x.rule}:${x.key}`)).to.deep.equal(['TradingRevenueVariance:razorpay_test']);
    expect(later.filter((x) => x.state === 'resolved').map((x) => x.rule).sort()).to.deep.equal(['TradingPortfolioMismatch', 'TradingReconcileErrors']);
    expect(ev.firing().sort()).to.deep.equal(['TradingGlobalKillSwitch|global', 'TradingKillSwitchEngaged|', 'TradingRevenueVariance|razorpay_test']);
  });
});

describe('observability: generated config stays in sync', () => {
  it('the committed alert rules and dashboard equal the generators (no hand edits, no drift)', () => {
    expect(fs.readFileSync(path.join(ROOT, 'docs/trading-agent/observability/trading-alerts.yml'), 'utf8')).to.equal(renderPrometheusRules());
    expect(JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/trading-agent/observability/trading-dashboard.json'), 'utf8'))).to.deep.equal(renderGrafanaDashboard());
  });

  it('every alert and panel refers to a metric the registry defines; the brief\'s six signals are all covered', async () => {
    const names = new Set((await createTradingMetrics().registry.getMetricsAsJSON()).map((m) => m.name));
    const exprMetrics = (e) => [...e.matchAll(/\b(trading_[a-z_]+?)(?:_bucket)?\b/g)].map((m) => m[1].replace(/_bucket$/, ''));
    for (const r of ALERT_RULES) { expect(names, r.name).to.include(r.metric); for (const m of exprMetrics(r.expr)) expect(names, `${r.name} ${m}`).to.include(m); }
    for (const p of PANELS) for (const m of exprMetrics(p.expr)) expect(names, `${p.title} ${m}`).to.include(m);
    const covered = new Set(ALERT_RULES.map((r) => r.metric));
    for (const m of ['trading_broker_up', 'trading_market_data_age_seconds', 'trading_orders_unknown_oldest_age_seconds', 'trading_reconcile_errors_total', 'trading_kill_switches_engaged', 'trading_revenue_variance_minor']) expect(covered, m).to.include(m);
  });
});

describe('observability: static guarantees', () => {
  const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.mjs'));
  const code = (f) => fs.readFileSync(path.join(DIR, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  it('no env reads, no default-registry use, no new vendor SDK, no message text in spans', () => {
    for (const f of files) {
      const c = code(f);
      expect(c, f).to.not.match(/process\.env/);
      expect(c, f).to.not.match(/client\.register\b|collectDefaultMetrics/);
      expect(c, f).to.not.match(/from ['"](@opentelemetry\/sdk|@sentry|dd-trace|newrelic|@datadog|@grafana)/);
    }
    expect(code('tracer.mjs')).to.not.match(/e\?*\.message/);
  });
});
