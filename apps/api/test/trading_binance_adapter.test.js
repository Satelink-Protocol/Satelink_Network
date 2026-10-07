import { expect } from 'chai';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateKeyPairSync, verify, createPublicKey } from 'node:crypto';
import {
  BinanceSpotAdapter, BINANCE_ADAPTER_STATE, resolveEnvironment, BINANCE_CLIENT_ID_MAX, queryString, wsSignaturePayload, signPayload, assertCredential,
  evaluateApiRestrictions, linkPrefix, toVenueClientId, fromVenueClientId, mapExecutionReport, orderSnapshot, instrumentsFromExchangeInfo,
  ExchangeLinkRebateSource, LinkAndTradeRebateSource, BinanceRestClient,
} from '../src/trading_agent/brokers/binance/index.mjs';
import { InstrumentRegistry } from '../src/trading_agent/brokers/symbols.mjs';
import { isTradingFlagEnabled } from '../src/trading_agent/flags.mjs';
import { clientOrderIdFor, OrderAcceptanceService, OrderDispatcher, OrderReconciler, InMemoryOmsStore, OmsState as S, stateOf } from '../src/trading_agent/oms/index.mjs';
import { FakeBinance, fixture } from './helpers/fake_binance.mjs';
import { runLimitLifecycle, BINANCE_ON } from './helpers/binance_lifecycle.mjs';

// Stage 21 — native Binance Spot adapter. Pure: fake venue (fetch) + fake WebSocket; no network.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.resolve(HERE, '../src/trading_agent/brokers/binance');
const SECRET = 'fake-hmac-secret-for-tests-0001';
const KEY = 'fake-api-key-for-tests-0001';
const HMAC = Object.freeze({ apiKey: KEY, keyType: 'hmac', secret: SECRET });
const T0 = Date.UTC(2026, 9, 5, 12, 0);
const SPECS = instrumentsFromExchangeInfo(fixture('exchange_info.json'));
const registry = () => new InstrumentRegistry(SPECS);

function adapterFor(venue, over = {}) {
  return new BinanceSpotAdapter({ credentialLoader: { load: async () => over.credential ?? HMAC }, instruments: registry(), linkId: 'ABCD1234', fetch: venue.fetch, clock: () => new Date(over.now ?? T0), env: BINANCE_ON, timeoutMs: over.timeoutMs ?? 50, ...over.opts });
}
const errOf = async (p) => { try { await p; } catch (e) { return e; } throw new Error('expected a rejection'); };

describe('binance: signing', () => {
  it('HMAC-SHA256 matches the official Binance documentation vector', () => {
    const docSecret = 'NhqPtmdSJYdKjVHjA7PZj4Mge3R5YNiP1e3UZjInClVN65XAbvqqM6A7H5fATj0j'; // published example key, not a real one
    const qs = queryString({ symbol: 'LTCBTC', side: 'BUY', type: 'LIMIT', timeInForce: 'GTC', quantity: 1, price: 0.1, recvWindow: 5000, timestamp: 1499827319559 });
    expect(qs).to.equal('symbol=LTCBTC&side=BUY&type=LIMIT&timeInForce=GTC&quantity=1&price=0.1&recvWindow=5000&timestamp=1499827319559');
    expect(signPayload({ apiKey: 'vmPUZE6mv9SD5VNH', keyType: 'hmac', secret: docSecret }, qs)).to.equal('c8db56825ae71d6d79447849e617115f4a920fa2acdcab2b053c4b2838bd6b71');
  });

  it('WebSocket payload is sorted, unencoded and excludes signature; Ed25519 signs base64 and verifies', () => {
    expect(wsSignaturePayload({ timestamp: 1, apiKey: 'k/=+', signature: 'x', recvWindow: undefined })).to.equal('apiKey=k/=+&timestamp=1');
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const cred = { apiKey: KEY, keyType: 'ed25519', privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
    const sig = signPayload(cred, 'apiKey=a&timestamp=1');
    expect(sig).to.match(/^[A-Za-z0-9+/]+=*$/);
    expect(verify(null, Buffer.from('apiKey=a&timestamp=1'), publicKey, Buffer.from(sig, 'base64'))).to.equal(true);
  });

  it('refuses malformed credential handles, including a non-Ed25519 private key', () => {
    const rsa = generateKeyPairSync('rsa', { modulusLength: 1024 }).privateKey.export({ type: 'pkcs8', format: 'pem' });
    for (const c of [null, { apiKey: 'short', keyType: 'hmac', secret: SECRET }, { apiKey: KEY, keyType: 'hmac' }, { apiKey: KEY, keyType: 'ed25519', privateKeyPem: 'nope' },
      { apiKey: KEY, keyType: 'ed25519', privateKeyPem: rsa }, { apiKey: KEY, keyType: 'rsa', secret: SECRET }]) {
      expect(() => assertCredential(c)).to.throw().with.property('code', 'AUTH_FAILED');
    }
  });
});

describe('binance: API-key permission validation (/sapi/v1/account/apiRestrictions)', () => {
  it('accepts a trade-only, IP-restricted key', () => {
    expect(evaluateApiRestrictions(fixture('api_restrictions_ok.json'))).to.deep.equal({ ok: true, violations: [] });
  });

  it('rejects withdrawals, internal transfer, universal transfer and a missing IP restriction', () => {
    const base = fixture('api_restrictions_ok.json');
    for (const [k, v] of [['enableWithdrawals', true], ['enableInternalTransfer', true], ['permitsUniversalTransfer', true], ['ipRestrict', false], ['enableSpotAndMarginTrading', false], ['enableReading', false]]) {
      const r = evaluateApiRestrictions({ ...base, [k]: v });
      expect(r.ok, k).to.equal(false);
      expect(r.violations.join(), k).to.include(k);
    }
    const { enableWithdrawals, ...missing } = base; // eslint-disable-line no-unused-vars
    expect(evaluateApiRestrictions(missing).ok).to.equal(false); // absent counts as unsafe
    expect(evaluateApiRestrictions(null).ok).to.equal(false);
  });

  it('when enforced, a withdrawal-enabled key is refused BEFORE any order reaches the venue; a good key trades', async () => {
    const venue = new FakeBinance({ secret: SECRET, apiKey: KEY, restrictions: { ...fixture('api_restrictions_ok.json'), enableWithdrawals: true } });
    const a = adapterFor(venue, { opts: { enforceKeyRestrictions: true } });
    const e = await errOf(a.placeOrder('bka_testnet', { clientOrderId: 'sl00000000000000000001', instrument: 'BTC-USDT', side: 'buy', type: 'limit', timeInForce: 'gtc', quantity: '0.001', limitPrice: '30000' }));
    expect(e.code).to.equal('PERMISSION_DENIED');
    expect(e.message).to.include('enableWithdrawals');
    expect(venue.calls.filter((c) => c.method === 'POST')).to.have.length(0);
    expect((await a.validateKey('bka_testnet')).ok).to.equal(false);

    venue.restrictions = fixture('api_restrictions_ok.json');
    const ok = adapterFor(venue, { opts: { enforceKeyRestrictions: true } });
    await ok.placeOrder('bka_testnet', { clientOrderId: 'sl00000000000000000002', instrument: 'BTC-USDT', side: 'buy', type: 'limit', timeInForce: 'gtc', quantity: '0.001', limitPrice: '30000' });
    await ok.placeOrder('bka_testnet', { clientOrderId: 'sl00000000000000000003', instrument: 'BTC-USDT', side: 'buy', type: 'limit', timeInForce: 'gtc', quantity: '0.001', limitPrice: '30000' });
    expect(venue.calls.filter((c) => c.path === '/sapi/v1/account/apiRestrictions')).to.have.length(3); // 1 refused + 1 cached for the good key
  });
});

describe('binance: environments and flags', () => {
  it('production is refused even with LIVE_TRADING set (locked); the BINANCE flag is required and stays OFF by default', () => {
    expect(() => resolveEnvironment('production', { TRADING_FLAG_LIVE_TRADING: 'true' })).to.throw().with.property('code', 'PERMISSION_DENIED');
    expect(() => new BinanceSpotAdapter({ credentialLoader: { load: async () => HMAC }, instruments: registry(), linkId: 'ABCD1234', fetch: () => {}, environment: 'production', env: { ...BINANCE_ON, TRADING_FLAG_LIVE_TRADING: 'true' } }))
      .to.throw().with.property('code', 'PERMISSION_DENIED');
    expect(() => new BinanceSpotAdapter({ credentialLoader: { load: async () => HMAC }, instruments: registry(), linkId: 'ABCD1234', fetch: () => {} }))
      .to.throw(/BINANCE trading flag is off/);
    expect(isTradingFlagEnabled('BINANCE', {})).to.equal(false);
    expect(() => resolveEnvironment('mainnet')).to.throw(/unknown Binance environment/);
    expect(resolveEnvironment('testnet').rest).to.equal('https://testnet.binance.vision');
    expect(BINANCE_ADAPTER_STATE).to.equal('IMPLEMENTED/TESTED');
  });
});

describe('binance: Link ID client order ids', () => {
  it('prefix is "x-<LinkID>"; the venue id never exceeds 36 and only uses the Binance charset', () => {
    expect(linkPrefix('ABCD1234')).to.equal('x-ABCD1234');
    for (const bad of ['', 'abc', 'has-dash', 'x'.repeat(17), null]) expect(() => linkPrefix(bad), String(bad)).to.throw(/Link ID/);
    const p = linkPrefix('ABCD1234');
    expect(toVenueClientId(p, 'a'.repeat(26))).to.have.length(36);
    expect(() => toVenueClientId(p, 'a'.repeat(27))).to.throw(/≤ 36/);
    expect(() => toVenueClientId(p, 'has space')).to.throw();
    expect(fromVenueClientId(p, 'x-ABCD1234slabc')).to.equal('slabc');
    expect(fromVenueClientId(p, 'web_abc')).to.equal(null);
    expect(fromVenueClientId(p, 'x-ABCD1234')).to.equal(null);
  });

  it('capabilities leave exactly the room the prefix allows; the OMS id + prefix fits 36 for every Link ID length', () => {
    for (let len = 4; len <= 16; len++) {
      const venue = new FakeBinance({ secret: SECRET, apiKey: KEY });
      const a = new BinanceSpotAdapter({ credentialLoader: { load: async () => HMAC }, instruments: registry(), linkId: 'L'.repeat(len), fetch: venue.fetch, env: BINANCE_ON });
      const caps = a.capabilities();
      expect(caps.clientOrderIdMaxLength, String(len)).to.equal(BINANCE_CLIENT_ID_MAX - 2 - len);
      const id = clientOrderIdFor('ord_0001', 'binance', caps);
      const full = toVenueClientId(a.clientIdPrefix, id);
      expect(full.length, String(len)).to.equal(36); // fits exactly: the prefix leaves ≤ 30, under the OMS cap of 32
    }
    const caps = adapterFor(new FakeBinance({ secret: SECRET, apiKey: KEY })).capabilities();
    expect(caps).to.include({ venue: 'binance', executionSafety: 'IDEMPOTENT', supportsQueryByClientOrderId: true, supportsPaper: true, requiresStaticIp: false });
  });
});

describe('binance: REST orders against the fake venue', () => {
  it('LIMIT: signed POST with the prefixed id, FULL response, GTC; MARKET fills report exact quantity and average', async () => {
    const venue = new FakeBinance({ secret: SECRET, apiKey: KEY });
    const a = adapterFor(venue);
    const r = await a.placeOrder('bka_testnet', { clientOrderId: 'sl11111111111111111111', instrument: 'BTC-USDT', side: 'buy', type: 'limit', timeInForce: 'gtc', quantity: '0.001', limitPrice: '30000' });
    expect(r).to.include({ outcome: 'placed', status: 'acknowledged', clientOrderId: 'sl11111111111111111111', filledQuantity: '0' });
    const post = venue.calls.find((c) => c.method === 'POST');
    expect(post.params).to.include({ symbol: 'BTCUSDT', side: 'BUY', type: 'LIMIT', timeInForce: 'GTC', quantity: '0.001', price: '30000', newClientOrderId: 'x-ABCD1234sl11111111111111111111', newOrderRespType: 'FULL', recvWindow: '5000', timestamp: String(T0) });
    expect(post.headers['X-MBX-APIKEY']).to.equal(KEY);
    expect(JSON.stringify(venue.calls)).to.not.include(SECRET);

    const m = await a.placeOrder('bka_testnet', { clientOrderId: 'sl22222222222222222222', instrument: 'BTC-USDT', side: 'buy', type: 'market', quantity: '0.003' });
    expect(m).to.include({ status: 'filled', filledQuantity: '0.003', averagePrice: '60000' });
    const fills = await a.listFills('bka_testnet', { clientOrderId: 'sl22222222222222222222' });
    expect(fills.map((f) => [f.quantity, f.price, String(f.feeMinor), f.feeCurrency, f.feeDecimals])).to.deep.equal([['0.0012', '60000', '12', 'BTC', 7], ['0.0018', '60000', '18', 'BTC', 7]]);
    expect(fills.every((f) => f.clientOrderId === 'sl22222222222222222222')).to.equal(true);
    expect(await a.listFills('bka_testnet', { clientOrderId: 'sl11111111111111111111' })).to.deep.equal([]); // unfilled: no myTrades call needed
    await errOf(a.placeOrder('bka_testnet', { clientOrderId: 'sl33333333333333333333', instrument: 'BTC-USDT', side: 'buy', type: 'market', timeInForce: 'gtc', quantity: '0.001' }));
  });

  it('maps venue errors without retrying: duplicate, not found, auth, filter, rate limit, 5xx, refused connection', async () => {
    const order = (id) => ({ clientOrderId: id, instrument: 'BTC-USDT', side: 'buy', type: 'limit', timeInForce: 'gtc', quantity: '0.001', limitPrice: '30000' });
    const cases = [
      ['error:-2010:Duplicate order sent.', 'DUPLICATE_CLIENT_ORDER_ID'],
      ['error:-2010:Account has insufficient balance for requested action.', 'INSUFFICIENT_FUNDS'],
      ['error:-2015:Invalid API-key, IP, or permissions for action.', 'AUTH_FAILED'],
      ['error:-1013:Filter failure: NOTIONAL', 'INVALID_REQUEST'],
      ['error:-1003:Too many requests.', 'RATE_LIMITED'],
      ['http500', 'AMBIGUOUS'],
      ['econnrefused', 'VENUE_UNAVAILABLE'],
    ];
    let i = 0;
    for (const [fault, code] of cases) {
      const venue = new FakeBinance({ secret: SECRET, apiKey: KEY });
      venue.script.push(fault);
      const e = await errOf(adapterFor(venue).placeOrder('bka_testnet', order(`sl4444444444444444444${i++}`)));
      expect(e.code, fault).to.equal(code);
      expect(venue.calls.filter((c) => c.method === 'POST'), fault).to.have.length(1); // ONE request, never retried here
    }
    const venue = new FakeBinance({ secret: SECRET, apiKey: KEY });
    const a = adapterFor(venue);
    await a.placeOrder('bka_testnet', order('sl55555555555555555555'));
    expect((await errOf(a.placeOrder('bka_testnet', order('sl55555555555555555555')))).code).to.equal('DUPLICATE_CLIENT_ORDER_ID'); // the real venue rule (open order)
    await a.cancelOrder('bka_testnet', { clientOrderId: 'sl55555555555555555555' });
    expect((await errOf(a.cancelOrder('bka_testnet', { clientOrderId: 'sl55555555555555555555' }))).code).to.equal('ORDER_NOT_FOUND'); // -2011 Unknown order sent.
    const ghost = adapterFor(venue, { opts: { orderDirectory: { instrumentFor: async () => 'BTC-USDT' } } });
    expect((await errOf(ghost.getOrder('bka_testnet', { clientOrderId: 'sl99999999999999999999' }))).code).to.equal('ORDER_NOT_FOUND'); // -2013
  });

  it('a lookup after a restart needs the order directory (Binance queries need the symbol)', async () => {
    const venue = new FakeBinance({ secret: SECRET, apiKey: KEY });
    await adapterFor(venue).placeOrder('bka_testnet', { clientOrderId: 'sl66666666666666666666', instrument: 'BTC-USDT', side: 'buy', type: 'limit', timeInForce: 'gtc', quantity: '0.001', limitPrice: '30000' });
    const fresh = adapterFor(venue);
    expect((await errOf(fresh.getOrder('bka_testnet', { clientOrderId: 'sl66666666666666666666' }))).code).to.equal('INVALID_REQUEST');
    const lookups = [];
    const withDir = adapterFor(venue, { opts: { orderDirectory: { instrumentFor: async (acct, id) => { lookups.push([acct, id]); return 'BTC-USDT'; } } } });
    const snap = await withDir.getOrder('bka_testnet', { clientOrderId: 'sl66666666666666666666' });
    expect(snap).to.include({ clientOrderId: 'sl66666666666666666666', status: 'acknowledged', venueSymbol: 'BTCUSDT' });
    await withDir.getOrder('bka_testnet', { clientOrderId: 'sl66666666666666666666' });
    expect(lookups).to.deep.equal([['bka_testnet', 'sl66666666666666666666']]); // cached after the first resolve
    expect(venue.calls.at(-1).params).to.include({ origClientOrderId: 'x-ABCD1234sl66666666666666666666', symbol: 'BTCUSDT' });
  });
});

describe('binance: order snapshots', () => {
  it('average price is exact decimal (cumulative quote ÷ executed qty, half-even at 8 dp), never a float', () => {
    const o = (quote, qty, status = 'PARTIALLY_FILLED') => orderSnapshot('x-ABCD1234', { symbol: 'BTCUSDT', orderId: 9, clientOrderId: 'x-ABCD1234slzz', status, origQty: '1.00000000', executedQty: qty, cummulativeQuoteQty: quote }, null);
    expect(o('100.00000000', '0.00300000').averagePrice).to.equal('33333.33333333');
    expect(o('200.00000000', '0.00300000').averagePrice).to.equal('66666.66666667');
    expect(o('9007199254.74099300', '0.10000000').averagePrice).to.equal('90071992547.40993'); // beyond float precision
    expect(o('0.00000000', '0.00000000', 'NEW')).to.include({ averagePrice: null, filledQuantity: '0', clientOrderId: 'slzz', status: 'acknowledged', quantity: '1' });
  });
});

describe('binance + OMS: timeout → UNKNOWN → reconciled (exactly one venue order)', () => {
  it('a POST that times out after the venue accepted it is never resent; the reconciler finds it by client id', async () => {
    const t = { now: T0 };
    const clock = () => new Date(t.now);
    const venue = new FakeBinance({ secret: SECRET, apiKey: KEY });
    const adapter = adapterFor(venue, { opts: { clock }, timeoutMs: 30 });
    const store = new InMemoryOmsStore();
    const adapters = { forVenue: () => adapter };
    const mandate = { principalId: 'prn_alice', brokerAccountId: 'bka_testnet', currency: 'USDT', decimals: 2, termsHash: `sha256:${'c'.repeat(64)}` };
    const mandates = { async verifyForOrder() { return mandate; } };
    const risk = { async decide() { return { decision: 'APPROVE', recorded: true, decisionId: 'rdc_1', failedCheck: null }; } };
    let n = 0;
    const acceptance = new OrderAcceptanceService({ store, mandates, risk, venues: { capabilities: () => adapter.capabilities() }, idFactory: (p) => `${p}_${++n}`, clock });
    const dispatcher = () => new OrderDispatcher({ store, adapters, mandates, clock, leaseMs: 30_000, submitTimeoutMs: 5_000, notFoundGraceMs: 120_000 });
    const reconciler = new OrderReconciler({ store, adapters, clock, sentGraceMs: 30_000, notFoundGraceMs: 120_000 });

    const a = await acceptance.accept({ idempotencyKey: 'idem_binance_01', principalId: 'prn_alice', brokerAccountId: 'bka_testnet', mandateId: 'mdt_1', origin: 'manual', approvedBy: 'prn_alice',
      mode: 'paper', venue: 'binance', instrument: 'BTC-USDT', side: 'buy', type: 'limit', timeInForce: 'gtc', quantity: '0.001', limitPrice: '30000' });
    venue.script.push('timeout_after');
    expect(await dispatcher().runOnce()).to.equal('unknown');
    expect(stateOf((await store.getOrder(a.orderId)).status)).to.equal(S.UNKNOWN);
    expect(await dispatcher().runOnce()).to.equal(null); // UNKNOWN is never resent blind
    t.now += 31_000;
    await reconciler.runOnce();
    const o = await store.getOrder(a.orderId);
    expect(stateOf(o.status)).to.equal(S.ACK);
    expect(o.brokerOrderId).to.equal(String(venue.orders[0].orderId));
    expect(venue.orders).to.have.length(1);
    expect(venue.placeCount(`x-ABCD1234${a.clientOrderId}`)).to.equal(1);
    const q = venue.calls.filter((c) => c.method === 'GET' && c.path === '/api/v3/order').at(-1);
    expect(q.params.origClientOrderId).to.equal(`x-ABCD1234${a.clientOrderId}`);
  });

  it('the acceptance lifecycle (LIMIT → ACK → CANCEL_REQUESTED → CANCELLED) runs on the fake venue with a complete receipt', async () => {
    const venue = new FakeBinance({ secret: SECRET, apiKey: KEY });
    const r = await runLimitLifecycle({ fetch: venue.fetch, credential: HMAC, linkId: 'ABCD1234' });
    expect(r.lifecycleOk).to.equal(true);
    expect(r.states).to.deep.equal([S.NEW, S.ACK, S.CANCEL_REQUESTED, S.CANCELLED]);
    expect(r.venueClientOrderId).to.have.length(36);
    expect(r.rec.cancelsRequested).to.equal(1);
    expect(r.receipt.completeness.complete).to.equal(true);
    expect(r.receipt.what).to.include({ venue: 'binance', mode: 'paper', type: 'limit', status: 'cancelled', limitPrice: '36000' });
    expect(r.receipt.traceparent).to.match(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
    expect(venue.calls.map((c) => `${c.method} ${c.path}`)).to.deep.equal([
      'GET /api/v3/exchangeInfo', 'GET /api/v3/ticker/price', 'POST /api/v3/order', 'GET /api/v3/order', 'GET /api/v3/order', 'DELETE /api/v3/order', 'GET /api/v3/order']);
  });
});

describe('binance: WebSocket executionReport mapping', () => {
  const ER = fixture('execution_reports.json');
  const P = 'x-ABCD1234';

  it('NEW / partial TRADE / final TRADE map to statuses and normalised fills with exact fees', () => {
    expect(mapExecutionReport(P, ER.new)).to.include({ ours: true, clientOrderId: 'slabc', brokerOrderId: '4293153', status: 'acknowledged', executionType: 'new', filledQuantity: '0', fill: null, side: 'buy' });
    const p = mapExecutionReport(P, ER.partial);
    expect(p).to.include({ status: 'partially_filled', filledQuantity: '0.0004', quantity: '0.001' });
    expect(p.fill).to.deep.include({ fillId: '1739', quantity: '0.0004', price: '59999.5', feeMinor: 4n, feeCurrency: 'BTC', feeDecimals: 7, executedAt: new Date(1759654800199).toISOString() });
    const f = mapExecutionReport(P, ER.filled);
    expect(f).to.include({ status: 'filled', filledQuantity: '0.001' });
    expect(f.fill).to.deep.include({ fillId: '1740', quantity: '0.0006', price: '60000', feeMinor: 6n, feeDecimals: 7 });
  });

  it('a cancel carries our id in C; rejects keep the reason; foreign orders and other events are not ours', () => {
    expect(mapExecutionReport(P, ER.canceled)).to.include({ ours: true, clientOrderId: 'sldef', status: 'cancelled', executionType: 'canceled' });
    expect(mapExecutionReport(P, ER.rejected)).to.include({ clientOrderId: 'slghi', status: 'rejected', rejectReason: 'INSUFFICIENT_BALANCES', side: 'sell' });
    expect(mapExecutionReport(P, ER.foreign)).to.deep.equal({ ours: false, venueClientOrderId: 'web_0b9f2f7a6b1d4c5e' });
    expect(mapExecutionReport(P, ER.balance)).to.equal(null);
    expect(mapExecutionReport(P, ER.new.event)).to.include({ clientOrderId: 'slabc' }); // bare event form
  });
});

/** A fake Binance WebSocket API endpoint: answers session.logon / userDataStream.* and can push events. */
class FakeWs extends EventTarget {
  constructor(url, { publicKey = null, secret = null, failSubscribe = false } = {}) {
    super();
    this.url = url; this.sent = []; this.closed = false; this.publicKey = publicKey; this.secret = secret; this.failSubscribe = failSubscribe; this.loggedIn = false;
    setImmediate(() => this.dispatchEvent(new Event('open')));
  }
  #reply(msg) { const ev = new Event('message'); ev.data = JSON.stringify(msg); setImmediate(() => this.dispatchEvent(ev)); }
  push(event) { this.#reply({ subscriptionId: 7, event }); }
  send(raw) {
    const m = JSON.parse(raw);
    this.sent.push(m);
    const signedOk = () => {
      const { signature, ...rest } = m.params ?? {};
      const payload = wsSignaturePayload(rest);
      if (this.publicKey) return verify(null, Buffer.from(payload), this.publicKey, Buffer.from(signature, 'base64'));
      return signature === signPayload({ apiKey: KEY, keyType: 'hmac', secret: this.secret }, payload);
    };
    if (m.method === 'session.logon') { this.loggedIn = signedOk(); return this.#reply(this.loggedIn ? { id: m.id, status: 200, result: { apiKey: KEY, authorizedSince: T0 } } : { id: m.id, status: 401, error: { code: -1022, msg: 'Signature for this request is not valid.' } }); }
    if (m.method === 'userDataStream.subscribe') return this.#reply(this.loggedIn && !this.failSubscribe ? { id: m.id, status: 200, result: { subscriptionId: 7 } } : { id: m.id, status: 401, error: { code: -2015, msg: 'Invalid API-key, IP, or permissions for action.' } });
    if (m.method === 'userDataStream.subscribe.signature') return this.#reply(signedOk() ? { id: m.id, status: 200, result: { subscriptionId: 7 } } : { id: m.id, status: 401, error: { code: -1022, msg: 'Signature for this request is not valid.' } });
    if (m.method === 'userDataStream.unsubscribe') return this.#reply({ id: m.id, status: 200, result: {} });
    return this.#reply({ id: m.id, status: 400, error: { code: -1, msg: 'unknown method' } });
  }
  close() { this.closed = true; }
}

describe('binance: user data stream over the WebSocket API (no listenKey)', () => {
  let ids = 0;
  const requestId = () => `req-${++ids}`;

  it('Ed25519: session.logon (signed) → userDataStream.subscribe (no params) → executionReports delivered → unsubscribe', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const cred = { apiKey: KEY, keyType: 'ed25519', privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
    const venue = new FakeBinance({ secret: SECRET, apiKey: KEY });
    let ws;
    const updates = [];
    const a = adapterFor(venue, { credential: cred });
    const sub = await a.openUserStream('bka_testnet', { onUpdate: (u) => updates.push(u), webSocketFactory: (url) => (ws = new FakeWs(url, { publicKey: createPublicKey(publicKey.export({ type: 'spki', format: 'pem' })) })), requestId });
    expect(ws.url).to.equal('wss://ws-api.testnet.binance.vision/ws-api/v3');
    expect(sub.subscriptionId).to.equal(7);
    expect(ws.sent.map((m) => m.method)).to.deep.equal(['session.logon', 'userDataStream.subscribe']);
    expect(Object.keys(ws.sent[0].params).sort()).to.deep.equal(['apiKey', 'signature', 'timestamp']);
    expect(ws.sent[1].params).to.equal(undefined);
    const ER = fixture('execution_reports.json');
    ws.push(ER.partial.event); ws.push(ER.foreign.event); ws.push(ER.balance.event);
    await new Promise((r) => setImmediate(r)); await new Promise((r) => setImmediate(r));
    expect(updates.map((u) => [u.ours, u.clientOrderId ?? null])).to.deep.equal([[true, 'slabc'], [false, null]]);
    await sub.close();
    expect(ws.sent.at(-1).method).to.equal('userDataStream.unsubscribe');
    expect(ws.closed).to.equal(true);
    expect(JSON.stringify(ws.sent)).to.not.match(/listenKey/i);
    expect(venue.calls.filter((c) => /userDataStream/.test(c.path))).to.have.length(0); // no REST listenKey endpoint
  });

  it('HMAC: userDataStream.subscribe.signature; a bad signature or a refused subscribe rejects', async () => {
    const venue = new FakeBinance({ secret: SECRET, apiKey: KEY });
    let ws;
    const sub = await adapterFor(venue).openUserStream('bka_testnet', { onUpdate: () => {}, webSocketFactory: (url) => (ws = new FakeWs(url, { secret: SECRET })), requestId });
    expect(sub.subscriptionId).to.equal(7);
    expect(ws.sent.map((m) => m.method)).to.deep.equal(['userDataStream.subscribe.signature']);
    expect(ws.sent[0].params.signature).to.match(/^[0-9a-f]{64}$/);

    const bad = await errOf(adapterFor(venue).openUserStream('bka_testnet', { onUpdate: () => {}, webSocketFactory: (url) => new FakeWs(url, { secret: 'a-different-secret-000' }), requestId }));
    expect(bad.code).to.equal('AUTH_FAILED');
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const cred = { apiKey: KEY, keyType: 'ed25519', privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
    const refused = await errOf(adapterFor(venue, { credential: cred }).openUserStream('bka_testnet', { onUpdate: () => {}, webSocketFactory: (url) => new FakeWs(url, { publicKey, failSubscribe: true }), requestId }));
    expect(refused.code).to.equal('AUTH_FAILED');
  });
});

describe('binance: exchangeInfo → instruments', () => {
  it('maps tick/lot/min-notional exactly and skips non-trading symbols', () => {
    expect(SPECS.map((s) => s.canonical)).to.deep.equal(['BTC-USDT', 'ETH-USDT']);
    expect(SPECS[0]).to.include({ venue: 'binance', venueSymbol: 'BTCUSDT', quoteCurrency: 'USDT', quoteDecimals: 8, tickSize: '0.01', lotSize: '0.00001', minQuantity: '0.00001', minNotional: '5' });
    expect(SPECS[1]).to.include({ minNotional: '10', lotSize: '0.0001' }); // legacy MIN_NOTIONAL
    expect(instrumentsFromExchangeInfo(fixture('exchange_info.json'), { symbols: ['ETHUSDT'] }).map((s) => s.venueSymbol)).to.deep.equal(['ETHUSDT']);
  });
});

describe('binance: rebate sources (read-only; nothing is booked — Stage 20 is stopped)', () => {
  const rest = (venue) => new BinanceRestClient({ baseUrl: 'https://fixture.invalid', fetch: venue.fetch, clock: () => new Date(T0) });

  it('Exchange Link: signed recentRecord within a < 7-day window, exact amounts, mapped statuses', async () => {
    const venue = new FakeBinance({ secret: SECRET, apiKey: KEY });
    const src = new ExchangeLinkRebateSource({ rest: rest(venue), credential: async () => HMAC });
    const rows = await src.fetchRecent({ startTime: T0 - 86_400_000, endTime: T0, page: 2, size: 100 });
    expect(rows.map((r) => [r.subAccountId, r.asset, r.amount, r.status, r.tradeId])).to.deep.equal([
      ['1001', 'USDT', '0.00102', 'settled', '1739'], ['1001', 'BNB', '0.5', 'pending', '1740'], ['1002', 'BTC', '0.000001', 'failed', '1741']]);
    expect(rows[0]).to.include({ source: 'binance.exchange_link', time: new Date(1759654800000).toISOString() });
    expect(venue.calls[0]).to.deep.include({ method: 'GET', path: '/sapi/v1/broker/rebate/recentRecord' });
    expect(venue.calls[0].params).to.include({ page: '2', size: '100', startTime: String(T0 - 86_400_000) });
    expect(venue.calls[0].params).to.not.have.property('subAccountId');
  });

  it('refuses windows of 7 days or more, bad paging, and the Link-and-Trade placeholder is explicit', async () => {
    const src = new ExchangeLinkRebateSource({ rest: rest(new FakeBinance({ secret: SECRET, apiKey: KEY })), credential: async () => HMAC });
    for (const bad of [{ startTime: T0 - 7 * 86_400_000, endTime: T0 }, { startTime: T0, endTime: T0 }, { startTime: T0 - 1000, endTime: T0, size: 501 }, { startTime: T0 - 1000, endTime: T0, page: 0 }, {}]) {
      expect((await errOf(src.fetchRecent(bad))).code, JSON.stringify(bad)).to.equal('INVALID_REQUEST');
    }
    const lt = new LinkAndTradeRebateSource();
    expect(lt.available).to.equal(false);
    expect((await errOf(lt.fetchRecent())).message).to.match(/placeholder/);
  });
});

describe('binance: static guarantees', () => {
  const files = fs.readdirSync(BIN).filter((f) => f.endsWith('.mjs'));
  const code = (f) => fs.readFileSync(path.join(BIN, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

  it('never reads process.env, never uses a listenKey, never imports CCXT or the agent layer', () => {
    for (const f of files) {
      const c = code(f);
      expect(c, f).to.not.match(/process\.env/);
      expect(c, f).to.not.match(/listenKey/i);
      expect(c, f).to.not.match(/from ['"]ccxt/);
      expect(c, f).to.not.match(/from ['"][./]*agent\//);
      expect(c, f).to.not.match(/console\.(log|info|debug)/);
    }
  });

  it('the only network sinks are the injected fetch and WebSocket factory; no retry loops around requests', () => {
    const c = code('rest_client.mjs');
    expect(c).to.not.match(/globalThis\.fetch|\bwhile\s*\(|for\s*\(\s*let\s+attempt/);
    expect((c.match(/this\.#fetch\(/g) ?? []).length).to.equal(1);
    for (const f of files.filter((x) => x !== 'adapter.mjs')) expect(code(f), f).to.not.match(/WebSocket/);
  });
});
