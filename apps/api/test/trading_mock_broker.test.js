import { expect } from 'chai';
import {
  MockBroker, MockScenario, BrokerAdapter, BrokerError, InstrumentRegistry, BrokerOrderStatus as S, SubmitOutcome, Venue,
} from '../src/trading_agent/brokers/index.mjs';

// Stage 10 — MockBroker scenario tests. Deterministic: fixed clock, counter ids.
const ACCOUNT = 'bka_test_0001';
const instruments = () => new InstrumentRegistry([
  { canonical: 'BTC-USDT', venue: Venue.MOCK, venueSymbol: 'BTC-USDT', quoteCurrency: 'USDT', quoteDecimals: 6, tickSize: '0.01', lotSize: '0.0001', minQuantity: '0.0001', minNotional: '1' },
]);
const creds = () => {
  const loader = { calls: [], async load(id) { loader.calls.push(id); return { opaque: `handle-for-${id}` }; } };
  return loader;
};
const order = (clientOrderId, patch = {}) => ({ clientOrderId, instrument: 'BTC-USDT', side: 'buy', type: 'limit', timeInForce: 'gtc', quantity: '0.0010', limitPrice: '50000.00', ...patch });
const make = (opts = {}) => new MockBroker({ credentialLoader: creds(), instruments: instruments(), marketPrices: { 'BTC-USDT': '50000.00' }, ...opts });

async function expectBrokerError(p, code) {
  try { await p; expect.fail(`expected ${code}`); }
  catch (e) { expect(e).to.be.instanceOf(BrokerError); expect(e.code).to.equal(code); return e; }
}

describe('MockBroker (Stage 10)', () => {
  it('ack: placed and working, no fills', async () => {
    const b = make({ scenarios: { 'coid-ack-01': MockScenario.ACK } });
    const r = await b.placeOrder(ACCOUNT, order('coid-ack-01'));
    expect(r).to.deep.include({ outcome: SubmitOutcome.PLACED, status: S.ACKNOWLEDGED, clientOrderId: 'coid-ack-01', brokerOrderId: 'mock-ord-000001' });
    const snap = await b.getOrder(ACCOUNT, { clientOrderId: 'coid-ack-01' });
    expect(snap).to.deep.include({ status: S.ACKNOWLEDGED, filledQuantity: '0', averagePrice: null });
    expect(await b.listFills(ACCOUNT, { clientOrderId: 'coid-ack-01' })).to.deep.equal([]);
  });

  it('partial: half filled (lot-rounded), fee computed in minor units', async () => {
    const b = make({ scenarios: { 'coid-part-01': MockScenario.PARTIAL } });
    const r = await b.placeOrder(ACCOUNT, order('coid-part-01', { quantity: '0.0011' }));
    expect(r.status).to.equal(S.PARTIALLY_FILLED);
    const snap = await b.getOrder(ACCOUNT, { clientOrderId: 'coid-part-01' });
    expect(snap).to.deep.include({ filledQuantity: '0.0005', averagePrice: '50000' });
    // notional 0.0005*50000 = 25 USDT = 25_000_000 minor; 10 bps = 25_000 minor
    expect(snap.fees).to.deep.equal({ USDT: { minor: 25000n, decimals: 6 } });
    const fills = await b.listFills(ACCOUNT, { clientOrderId: 'coid-part-01' });
    expect(fills.map((f) => [f.fillId, f.quantity, f.executedAt])).to.deep.equal([['mock-fill-000001', '0.0005', '2026-01-01T00:00:00.000Z']]);
    // a later fill completes it
    const done = b.simulateFill('coid-part-01', '0.0006');
    expect(done).to.deep.include({ status: S.FILLED, filledQuantity: '0.0011' });
    expect(() => b.simulateFill('coid-part-01', '0.0001')).to.throw(BrokerError, /terminal/);
  });

  it('fill: fully filled at the limit price', async () => {
    const b = make({ scenarios: { 'coid-fill-01': MockScenario.FILL } });
    const r = await b.placeOrder(ACCOUNT, order('coid-fill-01'));
    expect(r.status).to.equal(S.FILLED);
    const snap = await b.getOrder(ACCOUNT, { brokerOrderId: r.brokerOrderId });
    expect(snap).to.deep.include({ filledQuantity: '0.001', averagePrice: '50000', status: S.FILLED });
  });

  it('reject: REJECTED, outcome NOT_PLACED, not on the book', async () => {
    const b = make({ scenarios: { 'coid-rej-01': MockScenario.REJECT } });
    const e = await expectBrokerError(b.placeOrder(ACCOUNT, order('coid-rej-01')), 'REJECTED');
    expect([e.outcome, e.retryable, e.venueCode]).to.deep.equal(['not_placed', false, 'MOCK_REJECT']);
    await expectBrokerError(b.getOrder(ACCOUNT, { clientOrderId: 'coid-rej-01' }), 'ORDER_NOT_FOUND');
  });

  it('timeout after accept: AMBIGUOUS → UNKNOWN; reconciliation finds the order; resubmit is a duplicate', async () => {
    const b = make({ scenarios: { 'coid-tafa-01': MockScenario.TIMEOUT_AFTER_ACCEPT } });
    const e = await expectBrokerError(b.placeOrder(ACCOUNT, order('coid-tafa-01')), 'AMBIGUOUS');
    expect([e.outcome, e.retryable]).to.deep.equal([SubmitOutcome.UNKNOWN, false]);
    const snap = await b.getOrder(ACCOUNT, { clientOrderId: 'coid-tafa-01' });
    expect(snap.status).to.equal(S.ACKNOWLEDGED); // it IS live: a blind retry would have double-ordered
    await expectBrokerError(b.placeOrder(ACCOUNT, order('coid-tafa-01')), 'DUPLICATE_CLIENT_ORDER_ID');
  });

  it('timeout before accept: NOT_PLACED + retryable; same client id retry succeeds', async () => {
    const b = make({ scenarios: { 'coid-tbfa-01': MockScenario.TIMEOUT_BEFORE_ACCEPT } });
    const e = await expectBrokerError(b.placeOrder(ACCOUNT, order('coid-tbfa-01')), 'TIMEOUT_BEFORE_ACCEPT');
    expect([e.outcome, e.retryable]).to.deep.equal([SubmitOutcome.NOT_PLACED, true]);
    await expectBrokerError(b.getOrder(ACCOUNT, { clientOrderId: 'coid-tbfa-01' }), 'ORDER_NOT_FOUND');
    const r = await b.placeOrder(ACCOUNT, order('coid-tbfa-01')); // scenario consumed → default ack
    expect(r).to.deep.include({ outcome: SubmitOutcome.PLACED, status: S.ACKNOWLEDGED });
  });

  it('duplicate client order id: DUPLICATE_CLIENT_ORDER_ID and the original is unchanged', async () => {
    const b = make();
    const first = await b.placeOrder(ACCOUNT, order('coid-dup-01'));
    const e = await expectBrokerError(b.placeOrder(ACCOUNT, order('coid-dup-01', { quantity: '0.0020' })), 'DUPLICATE_CLIENT_ORDER_ID');
    expect(e.outcome).to.equal('not_placed');
    const snap = await b.getOrder(ACCOUNT, { clientOrderId: 'coid-dup-01' });
    expect([snap.brokerOrderId, snap.quantity]).to.deep.equal([first.brokerOrderId, '0.0010']);
  });

  it('cancel: working → CANCELLED; terminal → REJECTED; unknown → ORDER_NOT_FOUND', async () => {
    const b = make({ scenarios: { 'coid-fill-02': MockScenario.FILL } });
    await b.placeOrder(ACCOUNT, order('coid-can-01'));
    expect((await b.cancelOrder(ACCOUNT, { clientOrderId: 'coid-can-01' })).status).to.equal(S.CANCELLED);
    await b.placeOrder(ACCOUNT, order('coid-fill-02'));
    await expectBrokerError(b.cancelOrder(ACCOUNT, { clientOrderId: 'coid-fill-02' }), 'REJECTED');
    await expectBrokerError(b.cancelOrder(ACCOUNT, { clientOrderId: 'coid-none-01' }), 'ORDER_NOT_FOUND');
  });

  it('is deterministic: two identical runs produce identical results', async () => {
    const run = async () => {
      const b = make({ scenarios: { 'coid-det-01': MockScenario.PARTIAL, 'coid-det-02': MockScenario.FILL } });
      const out = [];
      out.push(await b.placeOrder(ACCOUNT, order('coid-det-01')));
      out.push(await b.placeOrder(ACCOUNT, order('coid-det-02', { type: 'market', limitPrice: null })));
      out.push(await b.getOrder(ACCOUNT, { clientOrderId: 'coid-det-01' }));
      out.push(await b.listFills(ACCOUNT, { clientOrderId: 'coid-det-02' }));
      return JSON.stringify(out, (_k, v) => (typeof v === 'bigint' ? `${v}n` : v));
    };
    expect(await run()).to.equal(await run());
  });

  it('preserves declared venue extensions and rejects undeclared ones', async () => {
    const b = make();
    const r = await b.placeOrder(ACCOUNT, order('coid-ext-01', { extensions: { mockTag: 'grid-7' } }));
    expect(r.extensions).to.deep.equal({ mockTag: 'grid-7' });
    await expectBrokerError(b.placeOrder(ACCOUNT, order('coid-ext-02', { extensions: { reduceOnly: true } })), 'INVALID_REQUEST');
  });

  describe('credential boundary', () => {
    it('requires a credentialLoader and loads credentials only through it', async () => {
      expect(() => new MockBroker({ instruments: instruments() })).to.throw(TypeError, /credentialLoader/);
      const loader = creds();
      const b = new MockBroker({ credentialLoader: loader, instruments: instruments() });
      const r = await b.placeOrder(ACCOUNT, order('coid-cred-01'));
      expect(loader.calls).to.deep.equal([ACCOUNT]);
      expect(b.credentialLoads).to.equal(1);
      expect(JSON.stringify(r)).to.not.include('handle-for');
      expect(JSON.stringify(await b.getOrder(ACCOUNT, { clientOrderId: 'coid-cred-01' }))).to.not.include('handle-for');
    });

    it('rejects anything but a broker account reference as the account argument', async () => {
      const b = make();
      for (const bad of [['sk', 'live', 'whatever'].join('_'), 'AKIA0000', { apiKey: 'x' }, '', 'bka_']) {
        await expectBrokerError(b.placeOrder(bad, order('coid-acct-01')), 'INVALID_REQUEST');
      }
    });

    it('rejects secrets in order requests and order refs', async () => {
      const b = make();
      await expectBrokerError(b.placeOrder(ACCOUNT, { ...order('coid-sec-01'), extensions: { secretKey: 'x' } }), 'INVALID_REQUEST');
      await expectBrokerError(b.getOrder(ACCOUNT, { clientOrderId: 'coid-sec-01', token: 'x' }), 'INVALID_REQUEST');
      await expectBrokerError(b.getOrder(ACCOUNT, {}), 'INVALID_REQUEST');
    });

    it('scopes orders to the broker account', async () => {
      const b = make();
      await b.placeOrder(ACCOUNT, order('coid-scope-1'));
      await expectBrokerError(b.getOrder('bka_other_0002', { clientOrderId: 'coid-scope-1' }), 'ORDER_NOT_FOUND');
    });
  });

  it('BrokerAdapter base hooks are abstract', async () => {
    const a = new BrokerAdapter({ credentialLoader: creds(), instruments: instruments() });
    expect(() => a.capabilities()).to.throw(/not implemented/);
    for (const m of ['_placeOrder', '_cancelOrder', '_getOrder', '_listFills']) {
      let threw = false;
      try { await a[m](); } catch (e) { threw = /not implemented/.test(e.message); }
      expect(threw, m).to.equal(true);
    }
  });

  it('rejects unknown instruments and unknown scenarios', async () => {
    const b = make();
    await expectBrokerError(b.placeOrder(ACCOUNT, order('coid-inst-01', { instrument: 'ETH-USDT' })), 'INSTRUMENT_NOT_TRADABLE');
    expect(() => make({ defaultScenario: 'explode' })).to.throw(TypeError);
    expect(() => make({ scenarios: { x: 'explode' } })).to.throw(TypeError);
  });
});
