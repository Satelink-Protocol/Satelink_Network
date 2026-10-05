import { expect } from 'chai';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import {
  UpstoxCopilotAdapter, UPSTOX_ADAPTER_STATE, UPSTOX_MODE, resolveEnvironment, algoHeaders, UpstoxOAuth, tokenExpiry, TokenVault, InMemoryTokenStore,
  vaultCredentialLoader, openToken, placeBody, orderSnapshot, mapStreamMessage, parseIst, exactNumber, orderDigest, resolvePlacementMode, PlacementMode,
  UpstoxUserIpApi, UpstoxKillSwitch, venueActionFor, UpstoxRestClient, KILL_SWITCH_COOLING_MS,
} from '../src/trading_agent/brokers/upstox/index.mjs';
import { InstrumentRegistry, defineInstrument } from '../src/trading_agent/brokers/symbols.mjs';
import { UPSTOX_STATUS } from '../src/trading_agent/brokers/status_map.mjs';
import { OrderAcceptanceService, InMemoryOmsStore } from '../src/trading_agent/oms/index.mjs';
import { FakeUpstox, upstoxFixture } from './helpers/fake_upstox.mjs';

// Stage 22 — Upstox COPILOT adapter. Pure: fake venue (fetch) + fake WebSocket; no network.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.resolve(HERE, '../src/trading_agent/brokers/upstox');
const T0 = Date.parse('2026-10-06T04:45:00Z'); // 10:15 IST
const ON = Object.freeze({ TRADING_FLAG_UPSTOX_COPILOT: 'true' });
const NHPC = defineInstrument({ canonical: 'NSE:NHPC', venue: 'upstox', venueSymbol: 'NSE_EQ|INE848E01016', quoteCurrency: 'INR', quoteDecimals: 2, tickSize: '0.05', lotSize: '1', minQuantity: '1', minNotional: '0' });
const TOKEN_A = 'fake-upstox-token-user-a';
const TOKEN_B = 'fake-upstox-token-user-b';
const errOf = async (p) => { try { await p; } catch (e) { return e; } throw new Error('expected a rejection'); };
const ORDER = (over = {}) => ({ clientOrderId: 'sl0123456789abcdef01', instrument: 'NSE:NHPC', side: 'buy', type: 'limit', timeInForce: 'day', quantity: '10', limitPrice: '80.5', ...over });

/** Human confirmations as the approval UI would record them (B-02). */
class Confirmations {
  constructor(clock) { this.rows = new Map(); this.clock = clock; }
  confirm({ action = 'place', brokerAccountId = 'bka_user_a', order, by = { principalId: 'prn_a', kind: 'human' }, at = this.clock() }) {
    const digest = orderDigest({ action, brokerAccountId, clientOrderId: order.clientOrderId, instrument: order.instrument, side: order.side, type: order.type, quantity: order.quantity, limitPrice: order.limitPrice, timeInForce: order.timeInForce });
    this.rows.set(`${brokerAccountId}|${order.clientOrderId}|${action}`, { digest, confirmedBy: by, confirmedAt: new Date(at).toISOString() });
  }
  async lookup({ brokerAccountId, clientOrderId, action }) { return this.rows.get(`${brokerAccountId}|${clientOrderId}|${action}`) ?? null; }
}

function rig({ now = T0 } = {}) {
  const t = { now };
  const clock = () => new Date(t.now);
  const venue = new FakeUpstox({ tokens: { [TOKEN_A]: 'UA0001', [TOKEN_B]: 'UB0002' } });
  const owners = { bka_user_a: { principalId: 'prn_a', token: TOKEN_A }, bka_user_b: { principalId: 'prn_b', token: TOKEN_B } };
  const credentialLoader = { load: async (bka) => ({ accessToken: owners[bka].token, principalId: owners[bka].principalId }) };
  const confirmations = new Confirmations(() => t.now);
  const adapter = new UpstoxCopilotAdapter({ credentialLoader, instruments: new InstrumentRegistry([NHPC]), fetch: venue.fetch, clock, env: ON, confirmations, timeoutMs: 40 });
  return { t, clock, venue, adapter, confirmations, posts: () => venue.calls.filter((c) => c.method !== 'GET') };
}

describe('upstox: environments, flags and the algo header', () => {
  it('production is refused even with LIVE_TRADING set; UPSTOX_COPILOT is required; COPILOT only', () => {
    expect(() => resolveEnvironment('production', { TRADING_FLAG_LIVE_TRADING: 'true' })).to.throw().with.property('code', 'PERMISSION_DENIED');
    const deps = { credentialLoader: { load: async () => ({}) }, instruments: new InstrumentRegistry([NHPC]), fetch: () => {} };
    expect(() => new UpstoxCopilotAdapter({ ...deps, environment: 'production', env: { ...ON, TRADING_FLAG_LIVE_TRADING: 'true' } })).to.throw().with.property('code', 'PERMISSION_DENIED');
    expect(() => new UpstoxCopilotAdapter(deps)).to.throw(/UPSTOX_COPILOT trading flag is off/);
    expect(resolveEnvironment('sandbox').orderBase).to.equal('https://api-sandbox.upstox.com');
    expect([UPSTOX_ADAPTER_STATE, UPSTOX_MODE]).to.deep.equal(['IMPLEMENTED/TESTED', 'COPILOT']);
  });

  it('X-Algo-Name is never produced while UPSTOX_AUTOMATED is locked, whatever the environment says', () => {
    expect(algoHeaders({}, 'MyAlgo')).to.deep.equal({});
    expect(algoHeaders({ TRADING_FLAG_UPSTOX_AUTOMATED: 'true' }, 'MyAlgo')).to.deep.equal({});
  });

  it('capabilities: equity LIMIT only, DAY/IOC, tag ≤ 20, AT_MOST_ONCE (no venue dedupe of tags)', () => {
    const caps = rig().adapter.capabilities();
    expect(caps).to.include({ venue: 'upstox', clientOrderIdMaxLength: 20, executionSafety: 'AT_MOST_ONCE', supportsQueryByClientOrderId: true, supportsPaper: true });
    expect(caps.orderTypes).to.deep.equal(['limit']);
    expect(caps.timeInForce).to.deep.equal(['day', 'ioc']);
  });

  it('the Stage 17 OMS refuses Upstox for automated dispatch (not exactly-once capable)', async () => {
    const { adapter } = rig();
    const acceptance = new OrderAcceptanceService({
      store: new InMemoryOmsStore(), idFactory: (p) => `${p}_1`, venues: { capabilities: () => adapter.capabilities() },
      mandates: { async verifyForOrder() { return { principalId: 'prn_a', brokerAccountId: 'bka_user_a', currency: 'INR', decimals: 2, termsHash: `sha256:${'d'.repeat(64)}` }; } },
      risk: { async decide() { return { decision: 'APPROVE', recorded: true, decisionId: 'rdc_1' }; } },
    });
    const r = await acceptance.accept({ idempotencyKey: 'idem_upstox_1', principalId: 'prn_a', brokerAccountId: 'bka_user_a', mandateId: 'mdt_1', venue: 'upstox', instrument: 'NSE:NHPC', side: 'buy', type: 'limit', quantity: '10', limitPrice: '80.5', mode: 'paper' });
    expect(r).to.include({ accepted: false, reason: 'VENUE_NOT_EXACTLY_ONCE' });
  });
});

describe('upstox: COPILOT confirmation (per order, human, exact terms)', () => {
  it('no confirmation → refused before anything is sent', async () => {
    const r = rig();
    const e = await errOf(r.adapter.placeOrder('bka_user_a', ORDER()));
    expect(e.code).to.equal('PERMISSION_DENIED');
    expect(e.message).to.match(/COPILOT confirmation required: no confirmation/);
    expect(r.venue.calls).to.have.length(0);
  });

  it('refuses an agent/system confirmation, other terms, another account, and a stale confirmation', async () => {
    const cases = [
      [(r) => r.confirmations.confirm({ order: ORDER(), by: { principalId: 'agent_run_1', kind: 'agent' } }), /only a human/],
      [(r) => r.confirmations.confirm({ order: ORDER({ limitPrice: '80.45' }) }), /terms differ/],
      [(r) => r.confirmations.confirm({ order: ORDER({ quantity: '11' }) }), /terms differ/],
      [(r) => r.confirmations.confirm({ order: ORDER(), brokerAccountId: 'bka_user_b' }), /no confirmation/],
      [(r) => r.confirmations.confirm({ order: ORDER(), action: 'modify' }), /no confirmation/],
      [(r) => r.confirmations.confirm({ order: ORDER(), at: T0 - 11 * 60_000 }), /expired/],
      [(r) => r.confirmations.confirm({ order: ORDER(), at: T0 + 60_000 }), /expired/], // from the future
    ];
    for (const [setup, msg] of cases) {
      const r = rig();
      setup(r);
      const e = await errOf(r.adapter.placeOrder('bka_user_a', ORDER()));
      expect([e.code, e.message], String(msg)).to.satisfy(([c, m]) => c === 'PERMISSION_DENIED' && msg.test(m));
      expect(r.posts(), String(msg)).to.have.length(0);
    }
  });

  it('a confirmed LIMIT goes out once, with the tag, no X-Algo-Name, and records who confirmed', async () => {
    const r = rig();
    r.confirmations.confirm({ order: ORDER() });
    const res = await r.adapter.placeOrder('bka_user_a', ORDER());
    expect(res).to.include({ outcome: 'placed', status: 'pending_new', clientOrderId: 'sl0123456789abcdef01' });
    expect(res.extensions).to.include({ confirmedBy: 'prn_a' });
    const [post] = r.posts();
    expect(post).to.deep.include({ method: 'POST', host: 'api-sandbox.upstox.com', path: '/v3/order/place' });
    expect(post.body).to.deep.equal({ quantity: 10, product: 'D', validity: 'DAY', price: 80.5, tag: 'sl0123456789abcdef01', instrument_token: 'NSE_EQ|INE848E01016', order_type: 'LIMIT', transaction_type: 'BUY', disclosed_quantity: 0, trigger_price: 0, is_amo: false, slice: false });
    expect(Object.keys(post.headers).map((h) => h.toLowerCase())).to.not.include('x-algo-name');
    expect(post.headers.Authorization).to.equal(`Bearer ${TOKEN_A}`);
  });
});

describe('upstox: market and non-LIMIT orders are rejected by Satelink', () => {
  it('MARKET / SL are refused before any call, even when "confirmed"', async () => {
    for (const type of ['market', 'stop', 'stop_limit']) {
      const r = rig();
      r.confirmations.confirm({ order: ORDER({ type, limitPrice: null }) });
      const e = await errOf(r.adapter.placeOrder('bka_user_a', ORDER({ type, limitPrice: type === 'stop_limit' ? '80.5' : null })));
      expect(e.code, type).to.equal('INVALID_REQUEST');
      expect(r.venue.calls, type).to.have.length(0);
    }
    expect(() => placeBody({ type: 'market', quantity: '1', side: 'buy', clientOrderId: 'x' }, NHPC)).to.throw(/LIMIT orders only/);
  });

  it('quantities must be whole shares; prices must survive the JSON-number round trip; GTC is not an Upstox validity', () => {
    expect(() => placeBody({ type: 'limit', quantity: '1.5', side: 'buy', limitPrice: '80.5', clientOrderId: 'x' }, NHPC)).to.throw(/positive integer/);
    expect(() => placeBody({ type: 'limit', quantity: '1', side: 'buy', limitPrice: '80.5', timeInForce: 'gtc', clientOrderId: 'x' }, NHPC)).to.throw(/validity GTC/);
    expect(exactNumber('80.50', 'price')).to.equal(80.5);
    expect(() => exactNumber('12345678901234567.05', 'price')).to.throw(/cannot be sent exactly/);
  });
});

describe('upstox: sandbox order lifecycle on the fake venue', () => {
  it('place → open → partial → modify (re-confirmed) → cancel → cancel again refused; fills from trades', async () => {
    const r = rig();
    r.confirmations.confirm({ order: ORDER() });
    const placed = await r.adapter.placeOrder('bka_user_a', ORDER());
    const byTag = await r.adapter.getOrder('bka_user_a', { clientOrderId: 'sl0123456789abcdef01' });
    expect(byTag).to.include({ clientOrderId: 'sl0123456789abcdef01', brokerOrderId: placed.brokerOrderId, status: 'acknowledged', quantity: '10', filledQuantity: '0', venueSymbol: 'NSE_EQ|INE848E01016' });
    expect(r.venue.calls.at(-1).query).to.deep.equal({ tag: 'sl0123456789abcdef01' }); // reconciliation by client id
    r.venue.fill(placed.brokerOrderId, 4, 80.45, 'T50091502');
    expect(await r.adapter.getOrder('bka_user_a', { clientOrderId: 'sl0123456789abcdef01' })).to.include({ status: 'partially_filled', filledQuantity: '4', averagePrice: '80.45' });

    const mod = { clientOrderId: 'sl0123456789abcdef01', brokerOrderId: placed.brokerOrderId, instrument: 'NSE:NHPC', side: 'buy', quantity: '10', limitPrice: '80.6' };
    expect((await errOf(r.adapter.modifyOrder('bka_user_a', mod))).message).to.match(/COPILOT confirmation required/);
    r.confirmations.confirm({ action: 'modify', order: { ...mod, type: 'limit', timeInForce: 'day' } });
    await r.adapter.modifyOrder('bka_user_a', mod);
    expect(r.venue.calls.at(-1)).to.deep.include({ method: 'PUT', path: '/v3/order/modify' });
    expect(r.venue.calls.at(-1).body).to.deep.equal({ order_id: placed.brokerOrderId, quantity: 10, validity: 'DAY', price: 80.6, order_type: 'LIMIT', trigger_price: 0 });

    const fills = await r.adapter.listFills('bka_user_a', { clientOrderId: 'sl0123456789abcdef01' });
    expect(fills.map((f) => [f.fillId, f.quantity, f.price, f.executedAt])).to.deep.equal([['T50091502', '4', '80.45', '2026-10-06T04:46:30.000Z']]);

    const c = await r.adapter.cancelOrder('bka_user_a', { clientOrderId: 'sl0123456789abcdef01' }); // cancel needs no confirmation (reduces risk)
    expect(c).to.include({ status: 'cancelled', filledQuantity: '4' });
    expect(r.venue.calls.find((x) => x.method === 'DELETE').query).to.deep.equal({ order_id: placed.brokerOrderId });
    expect((await errOf(r.adapter.cancelOrder('bka_user_a', { brokerOrderId: placed.brokerOrderId }))).code).to.equal('REJECTED'); // UDAPI100040
    expect(r.posts().filter((p) => p.method === 'POST')).to.have.length(1);
  });

  it('tokens are per user: another user cannot see or cancel the order', async () => {
    const r = rig();
    r.confirmations.confirm({ order: ORDER() });
    const placed = await r.adapter.placeOrder('bka_user_a', ORDER());
    expect((await errOf(r.adapter.getOrder('bka_user_b', { clientOrderId: 'sl0123456789abcdef01' }))).code).to.equal('ORDER_NOT_FOUND');
    expect((await errOf(r.adapter.cancelOrder('bka_user_b', { brokerOrderId: placed.brokerOrderId }))).code).to.equal('ORDER_NOT_FOUND');
  });

  it('a place that times out after the venue accepted it is AMBIGUOUS (one POST, never retried) and found again by tag', async () => {
    const r = rig();
    r.confirmations.confirm({ order: ORDER() });
    r.venue.script.push('timeout_after');
    expect((await errOf(r.adapter.placeOrder('bka_user_a', ORDER()))).code).to.equal('AMBIGUOUS');
    expect(r.posts()).to.have.length(1);
    const found = await r.adapter.getOrder('bka_user_a', { clientOrderId: 'sl0123456789abcdef01' });
    expect(found.brokerOrderId).to.equal(r.venue.orders[0].order_id);
    expect(r.venue.orders).to.have.length(1);
  });

  it('maps documented UDAPI codes and transport failures', async () => {
    const cases = [
      ['error:UDAPI1154:Static IP not whitelisted', 'PERMISSION_DENIED'], ['error:UDAPI100074:Outside API window', 'MARKET_CLOSED'],
      ['error:UDAPI100011:Invalid instrument key', 'INSTRUMENT_NOT_TRADABLE'], ['error:UDAPI1158:Market orders are not allowed', 'INVALID_REQUEST'],
      ['error:UDAPI100049:Use Uplink Business', 'PERMISSION_DENIED'], ['econnrefused', 'VENUE_UNAVAILABLE'], ['http503', 'AMBIGUOUS'],
    ];
    for (const [fault, code] of cases) {
      const r = rig();
      r.confirmations.confirm({ order: ORDER() });
      r.venue.script.push(fault);
      expect((await errOf(r.adapter.placeOrder('bka_user_a', ORDER()))).code, fault).to.equal(code);
      expect(r.posts(), fault).to.have.length(1);
    }
    const bad = new UpstoxCopilotAdapter({ credentialLoader: { load: async () => ({ accessToken: 'revoked-token', principalId: 'prn_a' }) }, instruments: new InstrumentRegistry([NHPC]), fetch: new FakeUpstox().fetch, env: ON, confirmations: { lookup: async () => null } });
    expect((await errOf(bad.getOrder('bka_user_a', { clientOrderId: 'sl0123456789abcdef01' }))).code).to.equal('AUTH_FAILED'); // UDAPI100050
  });
});

describe('upstox: static IP model (U8) and the prepare-order fallback', () => {
  const PROD = { name: 'production', paper: false };
  const reg = { primaryIp: '203.0.113.10', secondaryIp: null };

  it('API placement only from a dedicated, exclusive, registered per-customer IP; anything else is PREPARE_ONLY', () => {
    expect(resolvePlacementMode({ environment: { name: 'sandbox', paper: true } }).mode).to.equal(PlacementMode.API);
    expect(resolvePlacementMode({ environment: PROD, egress: null, principalId: 'prn_a', registeredIps: null })).to.deep.include({ mode: 'prepare_only' });
    const ok = { ip: '203.0.113.10', principalId: 'prn_a', exclusive: true, sharedWith: [] };
    expect(resolvePlacementMode({ environment: PROD, egress: ok, principalId: 'prn_a', registeredIps: reg }).mode).to.equal('api');
    const r1 = resolvePlacementMode({ environment: PROD, egress: { ...ok, sharedWith: ['prn_b'] }, principalId: 'prn_a', registeredIps: reg });
    expect(r1.mode).to.equal('prepare_only');
    expect(r1.reasons.join()).to.match(/shared across customers — forbidden/);
    expect(resolvePlacementMode({ environment: PROD, egress: { ...ok, exclusive: false }, principalId: 'prn_a', registeredIps: reg }).mode).to.equal('prepare_only');
    expect(resolvePlacementMode({ environment: PROD, egress: { ...ok, principalId: 'prn_b' }, principalId: 'prn_a', registeredIps: reg }).mode).to.equal('prepare_only');
    expect(resolvePlacementMode({ environment: PROD, egress: ok, principalId: 'prn_a', registeredIps: { primaryIp: '198.51.100.7' } }).mode).to.equal('prepare_only');
  });

  it('property: no combination with a shared or non-exclusive IP ever resolves to API', () => {
    for (const exclusive of [true, false, undefined]) {
      for (const sharedWith of [[], ['prn_b'], undefined]) {
        for (const owner of ['prn_a', 'prn_b']) {
          for (const registered of [reg, { primaryIp: '198.51.100.7', secondaryIp: '203.0.113.10' }, null]) {
            const m = resolvePlacementMode({ environment: PROD, egress: { ip: '203.0.113.10', principalId: owner, exclusive, sharedWith }, principalId: 'prn_a', registeredIps: registered }).mode;
            const shared = exclusive !== true || (sharedWith ?? []).length > 0;
            if (shared || owner !== 'prn_a' || !registered) expect(m, JSON.stringify({ exclusive, sharedWith, owner, registered })).to.equal('prepare_only');
          }
        }
      }
    }
  });

  it('prepareOrder validates and returns a ticket without calling Upstox; tickets are deterministic', async () => {
    const r = rig();
    const a = await r.adapter.prepareOrder('bka_user_a', ORDER());
    const b = await r.adapter.prepareOrder('bka_user_a', ORDER());
    expect(a).to.include({ kind: 'satelink.upstox.prepared-order/1', instrumentKey: 'NSE_EQ|INE848E01016', side: 'BUY', orderType: 'LIMIT', quantity: '10', price: '80.5', validity: 'DAY', tag: 'sl0123456789abcdef01' });
    expect(a.note).to.match(/NOT sent/);
    expect(a.ticketHash).to.equal(b.ticketHash);
    expect(r.venue.calls).to.have.length(0);
    expect((await errOf(r.adapter.prepareOrder('bka_user_a', ORDER({ type: 'market', limitPrice: null })))).code).to.equal('INVALID_REQUEST');
  });

  it('static IP read API (fixture; the sandbox has no /v2/user/ip)', async () => {
    const fx = upstoxFixture('static_ip.json');
    const fetch = async (url, init) => { expect([init.method, new URL(url).pathname, init.headers.Authorization]).to.deep.equal(['GET', '/v2/user/ip', `Bearer ${TOKEN_A}`]); return new Response(JSON.stringify(fx), { status: 200 }); };
    const api = new UpstoxUserIpApi({ rest: new UpstoxRestClient({ fetch }), apiBase: 'https://api.upstox.com' });
    expect(await api.getStaticIps(TOKEN_A)).to.deep.equal({ primaryIp: '203.0.113.10', secondaryIp: null, primaryUpdatedAt: '2026-09-01T10:00:00Z', secondaryUpdatedAt: null });
  });
});

describe('upstox: kill switch mapping (/v2/user/kill-switch, 12-hour cooling)', () => {
  const ksFor = (venue, clock) => new UpstoxKillSwitch({ rest: new UpstoxRestClient({ fetch: venue.fetch }), apiBase: 'https://api.upstox.com', clock });

  it('status maps the documented shape', async () => {
    const fx = upstoxFixture('kill_switch_status.json');
    const ks = new UpstoxKillSwitch({ rest: new UpstoxRestClient({ fetch: async () => new Response(JSON.stringify(fx), { status: 200 }) }), apiBase: 'https://api.upstox.com' });
    expect(await ks.status(TOKEN_A)).to.deep.equal([
      { segment: 'NSE_EQ', segmentStatus: 'ACTIVE', killSwitchEnabled: false }, { segment: 'BSE_EQ', segmentStatus: 'ACTIVE', killSwitchEnabled: false }, { segment: 'NSE_FO', segmentStatus: 'INACTIVE', killSwitchEnabled: true }]);
  });

  it('engage refuses open positions locally; disables otherwise; release is refused for 12 hours, then allowed', async () => {
    const t = { now: T0 };
    const venue = new FakeUpstox({ tokens: { [TOKEN_A]: 'UA0001' } });
    const ks = ksFor(venue, () => new Date(t.now));
    expect((await errOf(ks.engage(TOKEN_A, ['NSE_EQ'], { openPositions: { NSE_EQ: 2 } }))).message).to.match(/close open positions first in NSE_EQ/);
    expect(venue.calls).to.have.length(0);
    const e = await ks.engage(TOKEN_A, ['NSE_EQ', 'BSE_EQ']);
    expect(e).to.include({ tokenInvalidated: true, engagedAt: new Date(T0).toISOString(), releasableAt: new Date(T0 + KILL_SWITCH_COOLING_MS).toISOString() });
    expect(venue.calls.at(-1).body).to.deep.equal([{ segment: 'NSE_EQ', action: 'DISABLE' }, { segment: 'BSE_EQ', action: 'DISABLE' }]);
    t.now = T0 + KILL_SWITCH_COOLING_MS - 1;
    expect((await errOf(ks.release(TOKEN_A, ['NSE_EQ'], { engagedAt: e.engagedAt }))).message).to.match(/cooling period/);
    expect(venue.calls).to.have.length(1);
    t.now = T0 + KILL_SWITCH_COOLING_MS;
    venue.killSwitch.UA0001.NSE_EQ.coolingUntil = 0; // the fake uses wall time; align it with the test clock
    await ks.release(TOKEN_A, ['NSE_EQ'], { engagedAt: e.engagedAt });
    expect(venue.calls.at(-1).body).to.deep.equal([{ segment: 'NSE_EQ', action: 'ENABLE' }]);
    expect((await errOf(ks.engage(TOKEN_A, ['NSE_XX'])))).to.have.property('code', 'INVALID_REQUEST');
  });

  it('the venue cooling refusal (UDAPI1185) maps to REJECTED', async () => {
    const venue = new FakeUpstox({ tokens: { [TOKEN_A]: 'UA0001' } });
    venue.script.push('error:UDAPI1185:Cooling period active');
    expect((await errOf(ksFor(venue, () => new Date(T0 + 13 * 3_600_000)).release(TOKEN_A, ['NSE_EQ'], { engagedAt: new Date(T0).toISOString() }))).code).to.equal('REJECTED');
  });

  it('Satelink scopes → venue proposal: only a user\'s own account-wide stop proposes DISABLE; never on release', () => {
    expect(venueActionFor({ scopeType: 'principal', action: 'engage' })).to.deep.include({ venueAction: 'DISABLE', segments: ['NSE_EQ', 'BSE_EQ'] });
    expect(venueActionFor({ scopeType: 'broker_account', action: 'engage' }).venueAction).to.equal('DISABLE');
    for (const scopeType of ['global', 'venue', 'mandate', 'strategy', 'instrument']) expect(venueActionFor({ scopeType, action: 'engage' }).venueAction, scopeType).to.equal(null);
    expect(venueActionFor({ scopeType: 'principal', action: 'release' }).venueAction).to.equal(null);
  });
});

describe('upstox: OAuth and encrypted per-user tokens', () => {
  const keyring = (() => { const k = { kid1: randomBytes(32) }; return { current: () => ({ keyId: 'kid1', key: k.kid1 }), byId: (id) => k[id] ?? null }; })();

  it('authorize URL carries a signed state; tampered, expired or foreign state is refused', () => {
    const t = { now: T0 };
    const oauth = new UpstoxOAuth({ clientId: 'app-client-id', clientSecret: async () => 'app-secret', redirectUri: 'https://console.example.invalid/upstox/callback', stateKey: randomBytes(32), fetch: async () => {}, vault: {}, clock: () => new Date(t.now) });
    const { url, state } = oauth.authorizationUrl({ principalId: 'prn_a', brokerAccountId: 'bka_user_a' });
    const u = new URL(url);
    expect(`${u.origin}${u.pathname}`).to.equal('https://api.upstox.com/v2/login/authorization/dialog');
    expect(Object.fromEntries(u.searchParams)).to.include({ response_type: 'code', client_id: 'app-client-id', redirect_uri: 'https://console.example.invalid/upstox/callback', state });
    expect(oauth.verifyState(state, { principalId: 'prn_a' })).to.deep.equal({ principalId: 'prn_a', brokerAccountId: 'bka_user_a' });
    expect(() => oauth.verifyState(state, { principalId: 'prn_b' })).to.throw(/another user/);
    const [p, m] = state.split('.');
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p, 'base64url')), a: 'bka_user_b' })).toString('base64url');
    expect(() => oauth.verifyState(`${forged}.${m}`, { principalId: 'prn_a' })).to.throw(/signature invalid/);
    t.now += 11 * 60_000;
    expect(() => oauth.verifyState(state, { principalId: 'prn_a' })).to.throw(/expired/);
  });

  it('code exchange seals the token for that user only; the caller and the store never see plaintext', async () => {
    const venue = new FakeUpstox();
    venue.tokenGrants['auth-code-1'] = { token: 'fresh-access-token-user-a', userId: 'UA0001' };
    const store = new InMemoryTokenStore();
    const vault = new TokenVault({ store, keyring, clock: () => new Date(T0) });
    const oauth = new UpstoxOAuth({ clientId: 'app-client-id', clientSecret: async () => 'app-secret', redirectUri: 'https://console.example.invalid/cb', stateKey: randomBytes(32), fetch: venue.fetch, vault, clock: () => new Date(T0) });
    const { state } = oauth.authorizationUrl({ principalId: 'prn_a', brokerAccountId: 'bka_user_a' });
    const meta = await oauth.exchangeCode({ code: 'auth-code-1', state, principalId: 'prn_a' });
    expect(meta).to.deep.include({ brokerAccountId: 'bka_user_a', upstoxUserId: 'UA0001', expiresAt: '2026-10-06T22:00:00.000Z' }); // 03:30 IST next morning
    expect(JSON.stringify(meta)).to.not.include('fresh-access-token');
    expect(venue.calls[0].body).to.include({ grant_type: 'authorization_code', code: 'auth-code-1', client_secret: 'app-secret' });
    expect(JSON.stringify(store.dump())).to.not.include('fresh-access-token');
    expect(await vault.get({ principalId: 'prn_a', brokerAccountId: 'bka_user_a' })).to.equal('fresh-access-token-user-a');
    expect(await vault.get({ principalId: 'prn_b', brokerAccountId: 'bka_user_a' })).to.equal(null);

    // an envelope copied to another user, or with an edited expiry, fails authentication
    const [env] = store.dump();
    expect(() => openToken({ keyring, envelope: { ...env, principalId: 'prn_b' }, principalId: 'prn_b', brokerAccountId: 'bka_user_a' })).to.throw(/failed authentication/);
    expect(() => openToken({ keyring, envelope: { ...env, expiresAt: env.expiresAt + 86_400_000 }, principalId: 'prn_a', brokerAccountId: 'bka_user_a' })).to.throw(/failed authentication/);
    expect(() => openToken({ keyring, envelope: env, principalId: 'prn_b', brokerAccountId: 'bka_user_a' })).to.throw(/another user/);
  });

  it('expired or invalidated tokens are gone; the credential loader asks the user to reconnect', async () => {
    const t = { now: T0 };
    const vault = new TokenVault({ store: new InMemoryTokenStore(), keyring, clock: () => new Date(t.now) });
    await vault.put({ principalId: 'prn_a', brokerAccountId: 'bka_user_a', token: 'tok-a', expiresAt: tokenExpiry(T0) });
    const loader = vaultCredentialLoader({ vault, ownerOf: async (bka) => ({ bka_user_a: 'prn_a' })[bka] ?? null });
    expect(await loader.load('bka_user_a')).to.deep.equal({ accessToken: 'tok-a', principalId: 'prn_a' });
    expect((await errOf(loader.load('bka_unknown'))).code).to.equal('AUTH_FAILED');
    t.now = tokenExpiry(T0);
    expect((await errOf(loader.load('bka_user_a'))).message).to.match(/reconnect/);
    t.now = T0;
    await vault.invalidate({ principalId: 'prn_a', brokerAccountId: 'bka_user_a' });
    expect(await vault.get({ principalId: 'prn_a', brokerAccountId: 'bka_user_a' })).to.equal(null);
  });

  it('token expiry is 03:30 IST the next morning whatever the issue time (documented examples)', () => {
    expect(new Date(tokenExpiry(Date.parse('2026-10-06T14:30:00Z'))).toISOString()).to.equal('2026-10-06T22:00:00.000Z'); // 20:00 IST Tue → 03:30 Wed
    expect(new Date(tokenExpiry(Date.parse('2026-10-06T21:00:00Z'))).toISOString()).to.equal('2026-10-06T22:00:00.000Z'); // 02:30 IST Wed → 03:30 Wed
    expect(new Date(tokenExpiry(Date.parse('2026-10-06T22:00:00Z'))).toISOString()).to.equal('2026-10-07T22:00:00.000Z');
  });
});

describe('upstox: portfolio stream and mapping', () => {
  it('authorizes a one-time wss URL with update_types and maps order / position / holding messages', async () => {
    const r = rig();
    let ws;
    const updates = [];
    class FakeWs extends EventTarget { constructor(url) { super(); this.url = url; this.closed = false; } close() { this.closed = true; } push(m) { const ev = new Event('message'); ev.data = JSON.stringify(m); this.dispatchEvent(ev); } }
    const s = await r.adapter.openPortfolioStream('bka_user_a', { updateTypes: ['order', 'position', 'holding'], webSocketFactory: (url) => (ws = new FakeWs(url)), onUpdate: (u) => updates.push(u) });
    expect(r.venue.calls[0]).to.deep.include({ path: '/v2/feed/portfolio-stream-feed/authorize', query: { update_types: 'order,position,holding' } });
    expect(ws.url).to.match(/^wss:\/\/fake\.upstox\.invalid\/.*code=one-time-/);
    ws.push(upstoxFixture('order_update.json'));
    ws.push({ ...upstoxFixture('order_update.json'), tag: 'manual-web-order', status: 'open' });
    ws.push(upstoxFixture('position_update.json'));
    ws.push(upstoxFixture('holding_update.json'));
    ws.push({ update_type: 'gtt_order' });
    expect(updates.map((u) => u.kind)).to.deep.equal(['order', 'order', 'position', 'holding']);
    expect(updates[0]).to.deep.include({ ours: true });
    expect(updates[0].snapshot).to.include({ clientOrderId: 'sl0123456789abcdef01', brokerOrderId: '240221025997024', status: 'pending_new', quantity: '10', filledQuantity: '0', venueTime: '2024-02-21T09:10:02.000Z' });
    expect(updates[1].ours).to.equal(false);
    expect(updates[2]).to.include({ instrumentKey: 'NSE_EQ|INE848E01016', quantity: '2', buyQuantity: '2', buyPrice: '92.925' });
    expect(updates[3]).to.include({ quantity: '3', averagePrice: '89.22' });
    s.close();
    expect(ws.closed).to.equal(true);
  });

  it('every documented Upstox order status maps; partial fills are refined from quantities', () => {
    const documented = ['validation pending', 'modify pending', 'trigger pending', 'put order req received', 'modify after market order req received', 'cancelled after market order', 'open', 'complete', 'modify validation pending',
      'after market order req received', 'modified', 'not cancelled', 'cancel pending', 'rejected', 'cancelled', 'open pending', 'not modified'];
    for (const s of documented) expect(UPSTOX_STATUS, s).to.have.property(s);
    expect(orderSnapshot({ status: 'open', quantity: 10, filled_quantity: 3, average_price: 80.45, tag: 't', order_id: '1' }).status).to.equal('partially_filled');
    expect(orderSnapshot({ status: 'complete', quantity: 10, filled_quantity: 10, average_price: 80.45 }).status).to.equal('filled');
    expect(parseIst('03-Aug-2017 15:03:42')).to.equal('2017-08-03T09:33:42.000Z');
    expect(() => parseIst('03-Foo-2017 15:03:42')).to.throw(/unrecognised/);
    expect(mapStreamMessage(null)).to.equal(null);
  });
});

describe('upstox: static guarantees', () => {
  const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.mjs'));
  const code = (f) => fs.readFileSync(path.join(DIR, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

  it('no process.env, no console, no agent imports, no Upstox SDK; X-Algo-Name only behind the locked flag', () => {
    for (const f of files) {
      const c = code(f);
      expect(c, f).to.not.match(/process\.env/);
      expect(c, f).to.not.match(/console\.(log|info|debug|warn)/);
      expect(c, f).to.not.match(/from ['"][./]*agent\//);
      expect(c, f).to.not.match(/upstox-js-sdk|upstox-nodejs/);
      if (f !== 'config.mjs') expect(c, f).to.not.match(/X-Algo-Name/i);
    }
  });

  it('read-only static IP and no MARKET order construction anywhere', () => {
    expect(code('static_ip.mjs')).to.not.match(/'PUT'|"PUT"/);
    for (const f of files) expect(code(f), f).to.not.match(/order_type:\s*'MARKET'/);
    expect(code('rest_client.mjs')).to.not.match(/\bwhile\s*\(|for\s*\(\s*let\s+attempt/);
  });
});
