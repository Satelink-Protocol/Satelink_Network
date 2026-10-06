import { expect } from 'chai';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AlpacaBrokerAdapter, ALPACA_ADAPTER_STATE, resolveEnvironment, commissionFields, expectedCommissionByFill, mapTradeEvent, parseSse, SimCommissionBook, accountSummary, basicAuth,
} from '../src/trading_agent/brokers/alpaca/index.mjs';
import { InstrumentRegistry, defineInstrument } from '../src/trading_agent/brokers/symbols.mjs';
import { isTradingFlagEnabled } from '../src/trading_agent/flags.mjs';
import { OrderAcceptanceService, OrderDispatcher, OrderReconciler, InMemoryOmsStore, OmsState as S, stateOf } from '../src/trading_agent/oms/index.mjs';
import { FakeAlpaca } from './helpers/fake_alpaca.mjs';

// Stage 23 — Alpaca Broker API adapter (correspondent model). Pure: fake venue; no network.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.resolve(HERE, '../src/trading_agent/brokers/alpaca');
const KEY = { apiKey: 'fake-correspondent-key-0001', apiSecret: 'fake-correspondent-secret-0001' };
const ON = Object.freeze({ TRADING_FLAG_ALPACA: 'true' });
const ACCT = 'b9b19618-22dd-4e80-8432-fc9e1ba0b27d';
const AAPL = defineInstrument({ canonical: 'US:AAPL', venue: 'alpaca', venueSymbol: 'AAPL', quoteCurrency: 'USD', quoteDecimals: 2, tickSize: '0.01', lotSize: '1', minQuantity: '1', minNotional: '1' });
const T0 = Date.UTC(2026, 9, 6, 14, 0);
const errOf = async (p) => { try { await p; } catch (e) { return e; } throw new Error('expected a rejection'); };
const ORDER = (over = {}) => ({ clientOrderId: 'sl0123456789abcdef0123456789ab', instrument: 'US:AAPL', side: 'buy', type: 'limit', timeInForce: 'day', quantity: '10', limitPrice: '187.33', ...over });

function rig({ policy = { forOrder: async () => ({ amount: '1.00', type: 'notional' }) }, timeoutMs = 40, caps } = {}) {
  const venue = new FakeAlpaca(KEY);
  venue.accounts[ACCT] = { id: ACCT, account_number: '920964623', status: 'ACTIVE', account_type: 'trading', currency: 'USD', crypto_status: 'INACTIVE', created_at: '2026-09-01T00:00:00Z', last_equity: '1000.00',
    contact: { email_address: 'customer@example.invalid', phone_number: '+15555550100', street_address: ['20 N San Mateo Dr'] }, identity: { given_name: 'Test', family_name: 'Customer', date_of_birth: '1990-01-01', tax_id: '666-55-4321' } };
  const adapter = new AlpacaBrokerAdapter({
    credentialLoader: { load: async () => KEY }, instruments: new InstrumentRegistry([AAPL]), fetch: venue.fetch, env: ON, timeoutMs,
    accounts: { alpacaAccountIdFor: async (bka) => (bka === 'bka_alpaca_1' ? ACCT : null) }, commissionPolicy: policy, commissionCaps: caps,
  });
  return { venue, adapter, posts: () => venue.calls.filter((c) => c.method === 'POST') };
}

describe('alpaca: environments and flags', () => {
  it('production refused even with LIVE_TRADING set; the ALPACA flag is required and OFF by default; state recorded', () => {
    expect(() => resolveEnvironment('production', { TRADING_FLAG_LIVE_TRADING: 'true' })).to.throw().with.property('code', 'PERMISSION_DENIED');
    const deps = { credentialLoader: { load: async () => KEY }, instruments: new InstrumentRegistry([AAPL]), fetch: () => {}, accounts: { alpacaAccountIdFor: async () => ACCT } };
    expect(() => new AlpacaBrokerAdapter({ ...deps, environment: 'production', env: { ...ON, TRADING_FLAG_LIVE_TRADING: 'true' } })).to.throw().with.property('code', 'PERMISSION_DENIED');
    expect(() => new AlpacaBrokerAdapter(deps)).to.throw(/ALPACA trading flag is off/);
    expect(isTradingFlagEnabled('ALPACA', {})).to.equal(false);
    expect(resolveEnvironment('sandbox').base).to.equal('https://broker-api.sandbox.alpaca.markets');
    expect(ALPACA_ADAPTER_STATE).to.equal('IMPLEMENTED/TESTED');
    expect(() => basicAuth({ apiKey: 'short', apiSecret: 'x' })).to.throw().with.property('code', 'AUTH_FAILED');
  });

  it('capabilities: equities, market/limit, client id ≤ 48, IDEMPOTENT (venue rejects duplicate client_order_id)', () => {
    expect(rig().adapter.capabilities()).to.include({ venue: 'alpaca', clientOrderIdMaxLength: 48, executionSafety: 'IDEMPOTENT', supportsQueryByClientOrderId: true, requiresStaticIp: false });
  });
});

describe('alpaca: commission fields on every order', () => {
  it('notional / qty / bps are sent as commission + commission_type, echoed, and reported back', async () => {
    for (const [amount, type, reported] of [['1.00', 'notional', '1'], ['0.005', 'qty', '0.005'], ['25', 'bps', '25']]) {
      const r = rig({ policy: { forOrder: async () => ({ amount, type }) } });
      const res = await r.adapter.placeOrder('bka_alpaca_1', ORDER());
      expect(r.posts()[0].body, type).to.deep.include({ commission: amount, commission_type: type, client_order_id: 'sl0123456789abcdef0123456789ab', symbol: 'AAPL', qty: '10', side: 'buy', type: 'limit', time_in_force: 'day', limit_price: '187.33' });
      expect(res.extensions, type).to.deep.equal({ commission: amount, commissionType: type });
      expect((await r.adapter.getOrder('bka_alpaca_1', { clientOrderId: 'sl0123456789abcdef0123456789ab' })), type).to.include({ commission: reported, commissionType: type }); // canonical decimal
    }
  });

  it('the policy is bounded by hard caps; bad types/amounts never reach the venue; no policy → no commission fields', async () => {
    for (const bad of [{ amount: '50.01', type: 'notional' }, { amount: '0.06', type: 'qty' }, { amount: '101', type: 'bps' }, { amount: '1.001', type: 'notional' }, { amount: '-1', type: 'notional' }, { amount: '1', type: 'percent' }, { amount: 1, type: 'notional' }]) {
      const r = rig({ policy: { forOrder: async () => bad } });
      expect((await errOf(r.adapter.placeOrder('bka_alpaca_1', ORDER()))).code, JSON.stringify(bad)).to.equal('INVALID_REQUEST');
      expect(r.posts(), JSON.stringify(bad)).to.have.length(0);
    }
    const r = rig({ policy: { forOrder: async () => null } });
    await r.adapter.placeOrder('bka_alpaca_1', ORDER());
    expect(r.posts()[0].body).to.not.have.any.keys('commission', 'commission_type');
    expect(commissionFields({ amount: '2.50' })).to.deep.equal({ commission: '2.50', commission_type: 'notional' }); // default type
  });

  it('expected commission is pro-rated per execution, exact in cents (notional / qty / bps, sell cap)', () => {
    const fills = [{ fillId: 'a', qty: '3', price: '187.33' }, { fillId: 'b', qty: '3', price: '187.33' }, { fillId: 'c', qty: '4', price: '187.34' }];
    const cents = (o, f = fills) => expectedCommissionByFill(o, f).map((x) => x.cents);
    expect(cents({ qty: '10', side: 'buy', commission: '1.00', commissionType: 'notional' })).to.deep.equal([30n, 30n, 40n]);
    expect(cents({ qty: '3', side: 'buy', commission: '1.00', commissionType: 'notional' }, [{ fillId: 'a', qty: '1', price: '1' }, { fillId: 'b', qty: '1', price: '1' }, { fillId: 'c', qty: '1', price: '1' }])).to.deep.equal([33n, 34n, 33n]); // sums to exactly 100
    expect(cents({ qty: '10', side: 'buy', commission: '0.005', commissionType: 'qty' })).to.deep.equal([2n, 2n, 2n]); // 1.5¢ → 2 (half-even), 2¢
    expect(cents({ qty: '10', side: 'buy', commission: '25', commissionType: 'bps' })).to.deep.equal([140n, 140n, 187n]); // 561.99 × 0.25% = 1.404975
    expect(cents({ qty: '1', side: 'sell', commission: '5.00', commissionType: 'notional' }, [{ fillId: 'a', qty: '1', price: '0.5' }])).to.deep.equal([50n]); // capped at principal
    expect(cents({ qty: '10', side: 'buy', commission: null })).to.deep.equal([0n, 0n, 0n]);
  });
});

describe('alpaca: commission → simulated book (no ledger; Stage 20 stopped)', () => {
  it('balanced double entries, idempotent by fill, Alpaca-reported figure wins with visible variance', () => {
    const book = new SimCommissionBook();
    expect(book.post({ fillId: 'f1', alpacaAccountId: ACCT, clientOrderId: 'c', expectedCents: 30n, at: 't' })).to.include({ posted: true, amountCents: 30n, varianceCents: null });
    expect(book.post({ fillId: 'f1', alpacaAccountId: ACCT, clientOrderId: 'c', expectedCents: 30n, at: 't' })).to.include({ duplicate: true });
    expect(book.post({ fillId: 'f2', alpacaAccountId: ACCT, clientOrderId: 'c', expectedCents: 30n, reportedCents: 31n, at: 't' })).to.include({ amountCents: 31n, varianceCents: 1n });
    expect(book.post({ fillId: 'f3', alpacaAccountId: ACCT, clientOrderId: 'c', expectedCents: 0n, at: 't' })).to.include({ zero: true });
    expect(book.balanced()).to.equal(true);
    expect(book.balance('sim:correspondent:commission_revenue')).to.equal(61n);
    expect(book.balance(`sim:customer:${ACCT}:cash`)).to.equal(-61n);
    expect(book.entries().every((e) => e.simulated === true)).to.equal(true);
    expect(() => book.post({ fillId: 'f4', alpacaAccountId: ACCT, expectedCents: 1 })).to.throw(/bigint/);
  });
});

describe('alpaca: orders on the fake sandbox', () => {
  it('place → lookup by client_order_id → partial fill → cancel → fills from FILL activities', async () => {
    const r = rig();
    const placed = await r.adapter.placeOrder('bka_alpaca_1', ORDER());
    expect(placed).to.include({ outcome: 'placed', status: 'pending_new', filledQuantity: '0' });
    expect(r.posts()[0].path).to.equal(`/v1/trading/accounts/${ACCT}/orders`);
    expect(r.posts()[0].headers.Authorization).to.equal(basicAuth(KEY));
    r.venue.fill(placed.brokerOrderId, '4', '187.32');
    const snap = await r.adapter.getOrder('bka_alpaca_1', { clientOrderId: ORDER().clientOrderId });
    expect(snap).to.include({ status: 'partially_filled', filledQuantity: '4', averagePrice: '187.32', brokerOrderId: placed.brokerOrderId });
    expect(r.venue.calls.at(-1)).to.deep.include({ path: `/v1/trading/accounts/${ACCT}/orders:by_client_order_id`, query: { client_order_id: ORDER().clientOrderId } });
    const fills = await r.adapter.listFills('bka_alpaca_1', { clientOrderId: ORDER().clientOrderId });
    expect(fills.map((f) => [f.quantity, f.price, f.brokerOrderId])).to.deep.equal([['4', '187.32', placed.brokerOrderId]]);
    expect(await r.adapter.cancelOrder('bka_alpaca_1', { clientOrderId: ORDER().clientOrderId })).to.include({ status: 'cancelled', filledQuantity: '4' });
    expect((await errOf(r.adapter.cancelOrder('bka_alpaca_1', { brokerOrderId: placed.brokerOrderId }))).code).to.equal('INVALID_REQUEST'); // 422 not cancelable
    expect((await errOf(r.adapter.getOrder('bka_alpaca_1', { clientOrderId: 'sl_does_not_exist_000' }))).code).to.equal('ORDER_NOT_FOUND');
    expect((await errOf(r.adapter.getOrder('bka_unknown_1', { clientOrderId: 'x' }))).code).to.equal('INVALID_REQUEST');
  });

  it('duplicate client_order_id → DUPLICATE; transport and server failures classified; one POST each', async () => {
    const r = rig();
    await r.adapter.placeOrder('bka_alpaca_1', ORDER());
    expect((await errOf(r.adapter.placeOrder('bka_alpaca_1', ORDER()))).code).to.equal('DUPLICATE_CLIENT_ORDER_ID');
    for (const [fault, code] of [['econnrefused', 'VENUE_UNAVAILABLE'], ['http500', 'AMBIGUOUS'], ['timeout_after', 'AMBIGUOUS']]) {
      const x = rig();
      x.venue.script.push(fault);
      expect((await errOf(x.adapter.placeOrder('bka_alpaca_1', ORDER()))).code, fault).to.equal(code);
      expect(x.posts(), fault).to.have.length(1);
    }
  });

  it('readAccount returns status fields only; identity and contact PII never leave the adapter', async () => {
    const a = await rig().adapter.readAccount('bka_alpaca_1');
    expect(a).to.deep.equal({ accountId: ACCT, accountNumber: '920964623', status: 'ACTIVE', accountType: 'trading', currency: 'USD', cryptoStatus: 'INACTIVE', createdAt: '2026-09-01T00:00:00Z', lastEquity: '1000' });
    expect(JSON.stringify(a)).to.not.match(/customer@|666-55|San Mateo|1990-01-01|Customer/);
    expect(accountSummary({ id: ACCT })).to.include({ status: null });
  });
});

describe('alpaca + OMS: timeout → UNKNOWN → never resent → reconciled by client_order_id', () => {
  it('a POST that times out after Alpaca accepted it ends as ONE venue order', async () => {
    const t = { now: T0 };
    const clock = () => new Date(t.now);
    const r = rig();
    const store = new InMemoryOmsStore();
    const adapters = { forVenue: () => r.adapter };
    const mandates = { async verifyForOrder() { return { principalId: 'prn_a', brokerAccountId: 'bka_alpaca_1', currency: 'USD', decimals: 2, termsHash: `sha256:${'f'.repeat(64)}` }; } };
    const acceptance = new OrderAcceptanceService({ store, mandates, risk: { async decide() { return { decision: 'APPROVE', recorded: true, decisionId: 'rdc_1' }; } }, venues: { capabilities: () => r.adapter.capabilities() }, idFactory: (p) => `${p}_1`, clock });
    const dispatcher = () => new OrderDispatcher({ store, adapters, mandates, clock, leaseMs: 30_000, submitTimeoutMs: 5_000, notFoundGraceMs: 120_000 });
    const reconciler = new OrderReconciler({ store, adapters, clock, sentGraceMs: 30_000, notFoundGraceMs: 120_000 });
    const a = await acceptance.accept({ idempotencyKey: 'idem_alpaca_01', principalId: 'prn_a', brokerAccountId: 'bka_alpaca_1', mandateId: 'mdt_1', origin: 'manual', approvedBy: 'prn_a',
      mode: 'paper', venue: 'alpaca', instrument: 'US:AAPL', side: 'buy', type: 'limit', timeInForce: 'day', quantity: '10', limitPrice: '187.33' });
    expect(a.accepted).to.equal(true);
    expect(a.clientOrderId.length).to.be.at.most(48);
    r.venue.script.push('timeout_after');
    expect(await dispatcher().runOnce()).to.equal('unknown');
    expect(stateOf((await store.getOrder(a.orderId)).status)).to.equal(S.UNKNOWN);
    expect(await dispatcher().runOnce()).to.equal(null); // never resent
    t.now += 31_000;
    await reconciler.runOnce();
    const o = await store.getOrder(a.orderId);
    expect(stateOf(o.status)).to.equal(S.ACK);
    expect(o.brokerOrderId).to.equal(r.venue.orders[0].id);
    expect(r.venue.orders).to.have.length(1);
    expect(r.posts()).to.have.length(1);
    expect(r.posts()[0].body).to.include({ commission: '1.00', commission_type: 'notional' });
  });
});

describe('alpaca: SSE trade events', () => {
  const ev = (o) => `id: ${o.event_id}\ndata: ${JSON.stringify(o)}\n\n`;
  const order = (status, filled) => ({ id: '904837e3-3b76-47ec-b432-046db6210001', client_order_id: 'sl0123456789abcdef0123456789ab', symbol: 'AAPL', qty: '10', side: 'buy', type: 'limit', status, filled_qty: filled, filled_avg_price: filled === '0' ? null : '187.33', commission: '1', commission_type: 'notional' });

  it('parses chunked events (split mid-line), surfaces comments, maps fills, and resumes with since_id', async () => {
    const r = rig();
    const stream = [
      ev({ event_id: '01JABCDEF0000000000000001', event: 'new', account_id: ACCT, at: '2026-10-06T14:00:00Z', order: order('new', '0') }),
      ': slow client warning\n\n',
      ev({ event_id: '01JABCDEF0000000000000002', event: 'partial_fill', execution_id: 'exec-1', account_id: ACCT, at: '2026-10-06T14:00:01Z', timestamp: '2026-10-06T14:00:01.123Z', price: '187.33', qty: '3', position_qty: '3', order: order('partially_filled', '3') }),
      ev({ event_id: '01JABCDEF0000000000000003', event: 'fill', execution_id: 'exec-2', account_id: ACCT, at: '2026-10-06T14:00:02Z', timestamp: '2026-10-06T14:00:02Z', price: '187.34', qty: '7', position_qty: '10', order: order('filled', '10') }),
    ].join('');
    r.venue.sse = [stream.slice(0, 57), stream.slice(57, 300), stream.slice(300)];
    const comments = [];
    const s = await r.adapter.streamTradeEvents('bka_alpaca_1', { sinceId: '01JABCDEF0000000000000000', onComment: (c) => comments.push(c) });
    const out = [];
    for await (const e of s.events) out.push(e);
    expect(r.venue.calls.at(-1)).to.deep.include({ path: '/v2/events/trades', query: { since_id: '01JABCDEF0000000000000000' } });
    expect(r.venue.calls.at(-1).headers.Accept).to.equal('text/event-stream');
    expect(comments).to.deep.equal(['slow client warning']);
    expect(out.map((e) => [e.event, e.snapshot.status, e.fill?.quantity ?? null])).to.deep.equal([['new', 'acknowledged', null], ['partial_fill', 'partially_filled', '3'], ['fill', 'filled', '7']]);
    expect(out[1].fill).to.include({ fillId: 'exec-1', price: '187.33', clientOrderId: 'sl0123456789abcdef0123456789ab', executedAt: '2026-10-06T14:00:01.123Z' });

    // end to end into the simulated book: the pro-rated split of the $1 notional commission
    const fills = out.filter((e) => e.fill).map((e) => ({ fillId: e.fill.fillId, qty: e.fill.quantity, price: e.fill.price }));
    const split = expectedCommissionByFill({ qty: '10', side: 'buy', commission: '1', commissionType: 'notional' }, fills);
    const book = new SimCommissionBook();
    for (const x of split) book.post({ fillId: x.fillId, alpacaAccountId: ACCT, clientOrderId: 'sl0123456789abcdef0123456789ab', expectedCents: x.cents, at: 't' });
    expect(split.map((x) => x.cents)).to.deep.equal([30n, 70n]);
    expect(book.balance('sim:correspondent:commission_revenue')).to.equal(100n);
    expect(book.balanced()).to.equal(true);
    expect((await errOf(r.adapter.streamTradeEvents('bka_alpaca_1', { sinceId: 'x', since: '2026-10-06' }))).code).to.equal('INVALID_REQUEST');
  });

  it('parseSse handles CRLF framing and multi-line data', async () => {
    const out = [];
    for await (const m of parseSse(['id: 1\r\ndata: {"a":\r\ndata: 1}\r\n\r\n'])) out.push(m);
    expect(out).to.deep.equal([{ id: '1', data: '{"a":\n1}' }]);
    expect(mapTradeEvent({ event_id: 'e', event: 'canceled', at: '2026-10-06T14:00:00Z', order: { status: 'canceled', qty: '1', filled_qty: '0' } }).fill).to.equal(null);
  });
});

describe('alpaca: static guarantees', () => {
  const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.mjs'));
  const code = (f) => fs.readFileSync(path.join(DIR, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  it('no process.env, no console, no agent imports, and nothing imports ledger / billing / settlement code', () => {
    for (const f of files) {
      const c = code(f);
      expect(c, f).to.not.match(/process\.env/);
      expect(c, f).to.not.match(/console\.(log|info|debug|warn)/);
      expect(c, f).to.not.match(/from ['"][./]*agent\//);
      expect(c, f).to.not.match(/from ['"][^'"]*(ledger|billing|settlement|economics|revenue)[^'"]*['"]/i);
    }
  });
  it('no retry loops around requests', () => {
    expect(code('rest_client.mjs')).to.not.match(/\bwhile\s*\(|for\s*\(\s*let\s+attempt/);
  });
});
