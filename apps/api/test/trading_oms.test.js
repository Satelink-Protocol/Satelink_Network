import { expect } from 'chai';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  OmsState as S, DB_STATUS, TRANSITIONS, FROM_BROKER, TERMINAL, stateOf, canTransition, clientOrderIdFor, VENUE_CLIENT_ID_MAX,
  OrderAcceptanceService, OrderDispatcher, OrderReconciler, InMemoryOmsStore, SimulatedCrash, applyBrokerSnapshot,
} from '../src/trading_agent/oms/index.mjs';
import { BrokerAdapter } from '../src/trading_agent/brokers/adapter.mjs';
import { MockBroker, MockScenario } from '../src/trading_agent/brokers/mock_broker.mjs';
import { defineCapabilities, ExecutionSafety } from '../src/trading_agent/brokers/capabilities.mjs';
import { InstrumentRegistry, defineInstrument } from '../src/trading_agent/brokers/symbols.mjs';
import { BrokerError } from '../src/trading_agent/brokers/errors.mjs';
import { BrokerOrderStatus as BS, TERMINAL_STATUSES, AssetClass, OrderType, TimeInForce, Venue } from '../src/trading_agent/brokers/types.mjs';
import { normalizeOrderRequest } from '../src/trading_agent/brokers/order_request.mjs';

// Stage 17 — order management system. Pure: no network, no DB, no process.env.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const TA = path.resolve(HERE, '../src/trading_agent');
const T0 = Date.UTC(2026, 9, 6, 9, 0);
const SPEC = defineInstrument({ canonical: 'BTC-USDT', venue: 'mock', venueSymbol: 'BTCUSDT', quoteCurrency: 'USDT', quoteDecimals: 2, tickSize: '0.01', lotSize: '0.0001', minQuantity: '0.0001', minNotional: '1' });
const instruments = () => new InstrumentRegistry([SPEC]);
const credentialLoader = { async load() { return {}; } };
const TERMS_HASH = `sha256:${'e'.repeat(64)}`;
const LEASE = 30_000;
const GRACE = 120_000;

/**
 * An unforgiving venue (Binance-like): a client order id is rejected as duplicate ONLY while an
 * order with it is open; once that order is terminal the same id is accepted again, i.e. a blind
 * resend after a fill creates a real second order. Orders become visible to lookups only after a
 * lag (eventual consistency). Faults are scripted per call or drawn from rnd.
 */
class UnforgivingVenue extends BrokerAdapter {
  constructor({ clock, rnd = null, lagMs = 0, chaos = {} } = {}) {
    super({ credentialLoader, instruments: instruments() });
    this.clock = clock; this.rnd = rnd; this.lagMs = lagMs; this.chaos = chaos; this.script = [];
    this.accepted = []; this.placeCalls = 0; this.seq = 0;
  }
  capabilities() {
    return defineCapabilities({
      venue: Venue.MOCK, assetClasses: [AssetClass.CRYPTO_SPOT], orderTypes: [OrderType.MARKET, OrderType.LIMIT], timeInForce: [TimeInForce.GTC],
      supportsClientOrderId: true, clientOrderIdMaxLength: 36, supportsQueryByClientOrderId: true, supportsPartialFills: true, supportsCancel: true,
      supportsPaper: true, requiresStaticIp: false, executionSafety: ExecutionSafety.IDEMPOTENT,
    });
  }
  #next() {
    if (this.script.length) return this.script.shift();
    if (!this.rnd) return 'ack';
    const r = this.rnd();
    const c = this.chaos;
    if (r < c.timeoutAfter) return 'timeout_after';
    if (r < c.timeoutAfter + c.timeoutBefore) return 'timeout_before';
    if (r < c.timeoutAfter + c.timeoutBefore + c.rateLimited) return 'rate_limited';
    if (r < c.timeoutAfter + c.timeoutBefore + c.rateLimited + c.reject) return 'reject';
    if (r < c.timeoutAfter + c.timeoutBefore + c.rateLimited + c.reject + c.fill) return 'fill';
    return 'ack';
  }
  async _placeOrder(_acct, order) {
    this.placeCalls += 1;
    if (this.accepted.some((o) => o.clientOrderId === order.clientOrderId && !TERMINAL_STATUSES.has(o.status))) {
      throw new BrokerError('DUPLICATE_CLIENT_ORDER_ID', { venue: 'mock' });
    }
    const action = this.#next();
    if (action === 'timeout_before') throw new BrokerError('TIMEOUT_BEFORE_ACCEPT', { venue: 'mock' });
    if (action === 'rate_limited') throw new BrokerError('RATE_LIMITED', { venue: 'mock' });
    if (action === 'reject') throw new BrokerError('REJECTED', { venue: 'mock' });
    const rec = { clientOrderId: order.clientOrderId, brokerOrderId: `v-${++this.seq}`, status: action === 'fill' ? BS.FILLED : BS.ACKNOWLEDGED, quantity: order.quantity, filledQuantity: action === 'fill' ? order.quantity : '0', acceptedAt: this.clock() };
    this.accepted.push(rec);
    if (action === 'timeout_after') throw new BrokerError('AMBIGUOUS', { venue: 'mock' });
    return { outcome: 'placed', status: rec.status, clientOrderId: rec.clientOrderId, brokerOrderId: rec.brokerOrderId };
  }
  async _getOrder(_acct, ref) {
    if (this.rnd && this.chaos.lookupError && this.rnd() < this.chaos.lookupError) throw new BrokerError('VENUE_UNAVAILABLE', { venue: 'mock' });
    const visible = this.accepted.filter((o) => o.clientOrderId === ref.clientOrderId && this.clock() - o.acceptedAt >= this.lagMs);
    if (!visible.length) throw new BrokerError('ORDER_NOT_FOUND', { venue: 'mock' });
    const o = visible.at(-1);
    return { clientOrderId: o.clientOrderId, brokerOrderId: o.brokerOrderId, status: o.status, quantity: o.quantity, filledQuantity: o.filledQuantity, averagePrice: o.filledQuantity === '0' ? null : '30000' };
  }
  async _cancelOrder(acct, ref) {
    const o = this.accepted.find((x) => x.clientOrderId === ref.clientOrderId && !TERMINAL_STATUSES.has(x.status));
    if (!o) throw new BrokerError('REJECTED', { venue: 'mock' });
    o.status = BS.CANCELLED;
    return this._getOrder(acct, ref);
  }
  /** The venue moves on its own: fills working orders. */
  tick() {
    for (const o of this.accepted) {
      if (TERMINAL_STATUSES.has(o.status) || !this.rnd || this.rnd() > 0.3) continue;
      if (o.status === BS.ACKNOWLEDGED && this.rnd() < 0.5) { o.status = BS.PARTIALLY_FILLED; o.filledQuantity = '0.0005'; } else { o.status = BS.FILLED; o.filledQuantity = o.quantity; }
    }
  }
  countFor(clientOrderId) { return this.accepted.filter((o) => o.clientOrderId === clientOrderId).length; }
}

const INTENT = (k = 'idem_00000001', over = {}) => ({
  idempotencyKey: k, principalId: 'prn_alice', brokerAccountId: 'bka_0001', mandateId: 'mdt_1', origin: 'manual', approvedBy: 'prn_alice',
  mode: 'paper', venue: 'mock', instrument: 'BTC-USDT', side: 'buy', type: 'market', quantity: '0.001', ...over,
});
const MANDATE = { principalId: 'prn_alice', brokerAccountId: 'bka_0001', currency: 'USDT', decimals: 2, termsHash: TERMS_HASH };

function rig({ venue: venueOpt, mandateOk = () => true, guard = null, faults, now = T0, extra = {} } = {}) {
  const t = { now };
  const clock = () => new Date(t.now);
  const store = new InMemoryOmsStore();
  const venue = venueOpt ?? new UnforgivingVenue({ clock: () => t.now });
  const adapters = { forVenue: () => venue };
  const mandates = { async verifyForOrder() { if (!mandateOk()) throw Object.assign(new Error('revoked'), { code: 'REVOKED' }); return MANDATE; } };
  const decisions = [];
  const risk = { async decide(o) { const d = { decision: 'APPROVE', recorded: true, decisionId: `rdc_${decisions.length + 1}`, failedCheck: null }; decisions.push([o.idempotencyKey, d]); return d; } };
  let n = 0;
  const acceptance = new OrderAcceptanceService({ store, mandates, risk, venues: { capabilities: () => venue.capabilities() }, idFactory: (p) => `${p}_${String(++n).padStart(4, '0')}`, clock });
  const dispatcher = (f = faults) => new OrderDispatcher({ store, adapters, mandates, guard, clock, leaseMs: LEASE, submitTimeoutMs: 10_000, notFoundGraceMs: GRACE, faults: f, ...extra });
  const reconciler = new OrderReconciler({ store, adapters, clock, sentGraceMs: 30_000, notFoundGraceMs: GRACE });
  return { t, clock, store, venue, adapters, mandates, risk, decisions, acceptance, dispatcher, reconciler, advance: (ms) => { t.now += ms; } };
}
const orderOf = async (r, id) => r.store.getOrder(id);
const stateFor = async (r, id) => stateOf((await orderOf(r, id)).status);

describe('oms: state machine', () => {
  it('has exactly the documented edges; terminal states have none', () => {
    expect(Object.keys(TRANSITIONS).sort()).to.deep.equal(Object.values(S).sort());
    for (const s of TERMINAL) expect(TRANSITIONS[s]).to.deep.equal([]);
    expect(canTransition(S.NEW, S.SENT)).to.equal(true);
    for (const [from, to] of [[S.NEW, S.ACK], [S.NEW, S.UNKNOWN], [S.FILLED, S.CANCELLED], [S.ACK, S.NEW], [S.PARTIAL, S.NEW], [S.CANCELLED, S.NEW], [S.REJECTED, S.SENT], [S.UNKNOWN, S.SENT]]) {
      expect(canTransition(from, to), `${from}→${to}`).to.equal(false);
    }
  });

  it('every broker status maps to an OMS state; every OMS state maps to a 021/027 orders.status', () => {
    expect(Object.keys(FROM_BROKER).sort()).to.deep.equal(Object.values(BS).sort());
    for (const s of Object.values(S)) expect(stateOf(DB_STATUS[s])).to.equal(s);
    expect(stateOf('expired')).to.equal(S.CANCELLED);
  });

  it('the SQL trigger in migration 027 allows exactly the JS transition table (no drift)', () => {
    const sql = fs.readFileSync(path.resolve(HERE, '../../../database/migrations/027_oms.sql'), 'utf8');
    const block = sql.split('OMS-TRANSITIONS-BEGIN')[1].split('OMS-TRANSITIONS-END')[0];
    const sqlPairs = [...block.matchAll(/\('([a-z_]+)', '([a-z_]+)'\)/g)].map((m) => `${m[1]}>${m[2]}`).sort();
    const jsPairs = Object.entries(TRANSITIONS).flatMap(([f, tos]) => tos.filter((t) => t !== f).map((t) => `${DB_STATUS[f]}>${DB_STATUS[t]}`)).sort();
    expect(sqlPairs).to.deep.equal(jsPairs);
  });
});

describe('oms: client_order_id generator', () => {
  it('is deterministic, venue-length-bounded, and valid for the Stage 10 order request', () => {
    const caps = { clientOrderIdMaxLength: 64 };
    expect(clientOrderIdFor('ord_1', 'binance', caps)).to.equal(clientOrderIdFor('ord_1', 'binance', caps));
    for (const [venue, max] of Object.entries(VENUE_CLIENT_ID_MAX)) {
      const id = clientOrderIdFor('ord_abc', venue, caps);
      expect(id.length, venue).to.equal(Math.min(max, 32));
      expect(id).to.match(/^sl[0-9a-f]+$/);
      expect(() => normalizeOrderRequest({ clientOrderId: id, instrument: 'BTC-USDT', side: 'buy', type: 'market', quantity: '1' }, { instrument: SPEC, capabilities: new UnforgivingVenue({ clock: () => 0 }).capabilities() })).to.not.throw();
    }
    expect(clientOrderIdFor('ord_abc', 'binance', { clientOrderIdMaxLength: 24 })).to.have.length(24);
    expect(() => clientOrderIdFor('ord_abc', 'binance', { clientOrderIdMaxLength: 12 })).to.throw(/allows only 12/);
    const ids = new Set(Array.from({ length: 20_000 }, (_, i) => clientOrderIdFor(`ord_${i}`, 'upstox', caps)));
    expect(ids.size).to.equal(20_000); // 20-char upstox ids: no collisions
  });
});

describe('oms: acceptance (risk + mandate required; one transaction)', () => {
  it('accepts into NEW with an order_events row and one outbox event, atomically', async () => {
    const r = rig();
    const a = await r.acceptance.accept(INTENT());
    expect(a).to.deep.include({ accepted: true, duplicate: false, orderId: 'ord_0001', status: 'approved', decisionId: 'rdc_1' });
    const o = await orderOf(r, a.orderId);
    expect(o).to.deep.include({ status: 'approved', clientOrderId: clientOrderIdFor('ord_0001', 'mock', r.venue.capabilities()), riskDecisionId: 'rdc_1', mandateTermsHash: TERMS_HASH, dispatchCount: 0 });
    expect(r.store.state.events.map((e) => e.eventType)).to.deep.equal(['accepted']);
    expect(r.store.state.outbox.map((e) => [e.eventType, e.idempotencyKey, e.status])).to.deep.equal([['order.place', 'place:ord_0001:0', 'pending']]);
    expect(r.venue.placeCalls).to.equal(0); // acceptance never talks to a broker
  });

  it('the same idempotency key never creates a second order (no re-decision, no second outbox event)', async () => {
    const r = rig();
    const a = await r.acceptance.accept(INTENT());
    const b = await r.acceptance.accept(INTENT());
    expect(b).to.deep.include({ accepted: true, duplicate: true, orderId: a.orderId });
    expect(r.decisions).to.have.length(1);
    expect(r.store.state.outbox).to.have.length(1);
    const [c, d] = await Promise.all([r.acceptance.accept(INTENT('idem_race_0001')), r.acceptance.accept(INTENT('idem_race_0001'))]);
    expect(c.orderId).to.equal(d.orderId);
    expect(r.store.state.orders.size).to.equal(2);
  });

  it('refuses without a valid mandate, a recorded risk APPROVE, or an exactly-once-capable venue — nothing is written', async () => {
    const r = rig({ mandateOk: () => false });
    expect(await r.acceptance.accept(INTENT())).to.deep.include({ accepted: false, reason: 'MANDATE_REVOKED' });
    const s = rig();
    s.risk.decide = async () => ({ decision: 'REJECT', recorded: true, decisionId: 'rdc_x', failedCheck: { code: 'KILL_SWITCH', detail: 'halted' } });
    expect(await s.acceptance.accept(INTENT())).to.deep.include({ accepted: false, reason: 'RISK_KILL_SWITCH', decisionId: 'rdc_x' });
    s.risk.decide = async () => ({ decision: 'APPROVE', recorded: false, decisionId: 'rdc_y' }); // unrecorded approval
    expect((await s.acceptance.accept(INTENT())).accepted).to.equal(false);
    const u = rig();
    u.venue.capabilities = () => ({ ...new UnforgivingVenue({ clock: () => 0 }).capabilities(), executionSafety: 'AT_MOST_ONCE' });
    expect(await u.acceptance.accept(INTENT())).to.deep.include({ accepted: false, reason: 'VENUE_NOT_EXACTLY_ONCE' });
    const w = rig();
    w.mandates.verifyForOrder = async () => ({ ...MANDATE, brokerAccountId: 'bka_other' });
    expect(await w.acceptance.accept(INTENT())).to.deep.include({ accepted: false, reason: 'MANDATE_MISMATCH' });
    for (const x of [r, s, u, w]) { expect(x.store.state.orders.size).to.equal(0); expect(x.store.state.outbox).to.have.length(0); }
  });

  it('a failure inside the acceptance transaction leaves neither the order nor the outbox event', async () => {
    const r = rig();
    r.store.insertOutbox = async () => { throw new Error('disk full'); };
    let err;
    try { await r.acceptance.accept(INTENT()); } catch (e) { err = e; }
    expect(err.message).to.equal('disk full');
    expect([r.store.state.orders.size, r.store.state.events.length]).to.deep.equal([0, 0]);
  });
});

describe('oms: dispatcher with MockBroker failure injection (brief §11)', () => {
  const mock = (r, scenarios) => {
    const m = new MockBroker({ credentialLoader, instruments: instruments(), scenarios, clock: () => new Date(r.t.now), marketPrices: { 'BTC-USDT': '30000' } });
    r.adapters.forVenue = () => m;
    return m;
  };

  it('happy path: NEW → SENT → ACK / FILLED / PARTIAL; reject → REJECTED', async () => {
    for (const [scenario, want] of [[MockScenario.ACK, S.ACK], [MockScenario.FILL, S.FILLED], [MockScenario.PARTIAL, S.PARTIAL], [MockScenario.REJECT, S.REJECTED]]) {
      const r = rig();
      const a = await r.acceptance.accept(INTENT());
      const m = mock(r, { [a.clientOrderId]: scenario });
      const out = await r.dispatcher().runOnce();
      expect(await stateFor(r, a.orderId), scenario).to.equal(want);
      expect(out).to.equal(want === S.REJECTED ? 'rejected' : 'placed');
      expect(r.store.state.outbox[0].status).to.equal('published');
      const evs = r.store.state.events.filter((e) => e.orderId === a.orderId).map((e) => e.toStatus);
      expect(evs.slice(0, 2)).to.deep.equal(['approved', 'submitted']); // write-ahead SENT before the call
      if (want !== S.REJECTED) expect((await m.getOrder('bka_0001', { clientOrderId: a.clientOrderId })).clientOrderId).to.equal(a.clientOrderId);
      // regression (found by the Stage 19 receipt): a fill reported at submit must record its quantity
      if (want === S.FILLED) expect((await orderOf(r, a.orderId)).filledQuantity).to.equal('0.001');
      if (want === S.PARTIAL) expect((await orderOf(r, a.orderId)).filledQuantity).to.equal('0.0005');
    }
  });

  it('timeout-after-accept → UNKNOWN (never resent by the dispatcher) → reconciler finds it → a SINGLE broker order', async () => {
    const r = rig();
    const a = await r.acceptance.accept(INTENT());
    r.venue.script.push('timeout_after');
    expect(await r.dispatcher().runOnce()).to.equal('unknown');
    expect(await stateFor(r, a.orderId)).to.equal(S.UNKNOWN);
    expect(await r.dispatcher().runOnce()).to.equal(null); // nothing to resend
    r.advance(31_000);
    await r.reconciler.runOnce();
    expect(await stateFor(r, a.orderId)).to.equal(S.ACK);
    expect(r.venue.countFor(a.clientOrderId)).to.equal(1);
    expect(r.venue.placeCalls).to.equal(1);
  });

  it('MockBroker timeout-after-accept: the second attempt is refused as a duplicate ⇒ recorded as existing', async () => {
    const r = rig();
    const a = await r.acceptance.accept(INTENT());
    const m = mock(r, { [a.clientOrderId]: MockScenario.TIMEOUT_AFTER_ACCEPT });
    expect(await r.dispatcher().runOnce()).to.equal('unknown');
    r.advance(31_000);
    expect((await r.reconciler.runOnce()).updated).to.equal(1);
    expect(await stateFor(r, a.orderId)).to.equal(S.ACK);
    expect((await m.getOrder('bka_0001', { clientOrderId: a.clientOrderId })).status).to.equal('acknowledged');
  });

  it('crash between the DB write and the send → recovered after the lease, sent exactly once', async () => {
    for (const point of ['after_claim', 'after_mark_sent']) {
      const r = rig();
      const a = await r.acceptance.accept(INTENT());
      const crashOnce = { fired: false, crash(p) { if (p === point && !this.fired) { this.fired = true; throw new SimulatedCrash(p); } } };
      let crashed = null;
      try { await r.dispatcher(crashOnce).runOnce(); } catch (e) { crashed = e; }
      expect(crashed).to.be.instanceOf(SimulatedCrash);
      expect(r.venue.placeCalls, point).to.equal(0);
      expect(await r.dispatcher().runOnce(), point).to.equal(null); // lease still held
      r.advance(LEASE + 1);
      const out = await r.dispatcher().runOnce();
      if (point === 'after_mark_sent') { // it MAY have been sent: wait out the not-found grace before resending
        expect(out).to.equal('awaiting_grace');
        r.advance(GRACE);
        expect(await r.dispatcher().runOnce()).to.equal('placed');
      } else {
        expect(out).to.equal('placed');
      }
      expect([await stateFor(r, a.orderId), r.venue.countFor(a.clientOrderId)], point).to.deep.equal([S.ACK, 1]);
    }
  });

  it('crash after the broker accepted but before the result was recorded → reconciled, never resent', async () => {
    for (const point of ['after_broker_call', 'after_record_result']) {
      const r = rig();
      const a = await r.acceptance.accept(INTENT());
      const crashOnce = { fired: false, crash(p) { if (p === point && !this.fired) { this.fired = true; throw new SimulatedCrash(p); } } };
      try { await r.dispatcher(crashOnce).runOnce(); } catch { /* process died */ }
      r.advance(LEASE + 1);
      const out = await r.dispatcher().runOnce();
      expect(['reconciled', 'noop']).to.include(out);
      expect([await stateFor(r, a.orderId), r.venue.countFor(a.clientOrderId), r.venue.placeCalls], point).to.deep.equal([S.ACK, 1, 1]);
    }
  });

  it('duplicate outbox events and duplicate broker snapshots are idempotent', async () => {
    const r = rig();
    const a = await r.acceptance.accept(INTENT());
    await r.store.insertOutbox({ aggregateId: a.orderId, eventType: 'order.place', payload: { orderId: a.orderId }, idempotencyKey: 'place:dup:1', nextAttemptAt: r.t.now });
    expect(await r.store.insertOutbox({ aggregateId: a.orderId, eventType: 'order.place', payload: {}, idempotencyKey: 'place:dup:1', nextAttemptAt: r.t.now })).to.deep.equal({ inserted: false });
    const outs = [await r.dispatcher().runOnce(), await r.dispatcher().runOnce(), await r.dispatcher().runOnce()];
    expect(outs).to.deep.equal(['placed', 'noop', null]);
    expect(r.venue.placeCalls).to.equal(1);
    const o = await orderOf(r, a.orderId);
    const snap = await r.venue.getOrder('bka_0001', { clientOrderId: a.clientOrderId });
    const before = r.store.state.events.length;
    expect((await applyBrokerSnapshot(r.store, o, snap, { actor: 't', at: r.t.now, source: 'dup' })).changed).to.equal(false);
    expect((await applyBrokerSnapshot(r.store, o, snap, { actor: 't', at: r.t.now, source: 'dup' })).changed).to.equal(false);
    expect(r.store.state.events.length).to.equal(before);
    const filled = { ...snap, status: 'filled', filledQuantity: '0.001' };
    const f = await applyBrokerSnapshot(r.store, o, filled, { actor: 't', at: r.t.now, source: 'x' });
    expect((await applyBrokerSnapshot(r.store, f.order, snap, { actor: 't', at: r.t.now, source: 'stale' })).ignored).to.match(/terminal|stale/); // never backwards
    expect(await stateFor(r, a.orderId)).to.equal(S.FILLED);
  });

  it('DUPLICATE_CLIENT_ORDER_ID ⇒ the order exists: it is looked up and recorded, never rejected or resent', async () => {
    const r = rig();
    const a = await r.acceptance.accept(INTENT());
    // The venue already holds an open order with this client id (e.g. sent by a previous process).
    r.venue.accepted.push({ clientOrderId: a.clientOrderId, brokerOrderId: 'v-old', status: 'partially_filled', quantity: '0.001', filledQuantity: '0.0004', acceptedAt: r.t.now });
    expect(await r.dispatcher().runOnce()).to.equal('exists');
    expect(await orderOf(r, a.orderId)).to.deep.include({ status: 'partially_filled', brokerOrderId: 'v-old', filledQuantity: '0.0004' });
    expect(r.venue.countFor(a.clientOrderId)).to.equal(1);
  });

  it('a stale broker snapshot never moves an order backwards', async () => {
    const r = rig();
    const a = await r.acceptance.accept(INTENT());
    await r.dispatcher().runOnce();
    const o = await orderOf(r, a.orderId);
    const p = await applyBrokerSnapshot(r.store, o, { clientOrderId: a.clientOrderId, brokerOrderId: o.brokerOrderId, status: 'partially_filled', filledQuantity: '0.0005' }, { actor: 't', at: r.t.now, source: 'x' });
    const stale = await applyBrokerSnapshot(r.store, p.order, { clientOrderId: a.clientOrderId, brokerOrderId: o.brokerOrderId, status: 'acknowledged', filledQuantity: '0' }, { actor: 't', at: r.t.now, source: 'stale' });
    expect(stale.changed).to.equal(false);
    expect(stale.ignored).to.match(/stale/);
    expect(await orderOf(r, a.orderId)).to.deep.include({ status: 'partially_filled', filledQuantity: '0.0005' });
  });

  it('two dispatchers racing on one event send once (claim lease + CAS)', async () => {
    const r = rig();
    const a = await r.acceptance.accept(INTENT());
    await r.store.insertOutbox({ aggregateId: a.orderId, eventType: 'order.place', payload: {}, idempotencyKey: 'place:race:1', nextAttemptAt: r.t.now });
    const outs = await Promise.all([r.dispatcher().runOnce(), r.dispatcher().runOnce(), r.dispatcher().runOnce()]);
    expect(outs.filter((x) => x === 'placed')).to.have.length(1);
    expect(r.venue.countFor(a.clientOrderId)).to.equal(1);
  });

  it('regression (found by the randomized runs): two workers holding DIFFERENT events for one SENT order cannot both re-send', async () => {
    const r = rig();
    const a = await r.acceptance.accept(INTENT());
    await r.store.insertOutbox({ aggregateId: a.orderId, eventType: 'order.place', payload: {}, idempotencyKey: 'place:second:1', nextAttemptAt: r.t.now });
    const crashOnce = { fired: false, crash(p) { if (p === 'after_mark_sent' && !this.fired) { this.fired = true; throw new SimulatedCrash(p); } } };
    try { await r.dispatcher(crashOnce).runOnce(); } catch { /* died after marking SENT */ }
    r.advance(LEASE + GRACE + 1);
    r.venue.script.push('fill', 'fill'); // the first resend fills at once: a Binance-like venue would accept a second one
    const outs = await Promise.all([r.dispatcher().runOnce(), r.dispatcher().runOnce()]);
    expect(outs.filter((x) => x === 'placed')).to.have.length(1);
    expect(r.venue.countFor(a.clientOrderId)).to.equal(1);
  });

  it('retryable NOT_PLACED retries with backoff and the SAME client order id; non-retryable → REJECTED', async () => {
    const r = rig();
    const a = await r.acceptance.accept(INTENT());
    r.venue.script.push('timeout_before', 'rate_limited');
    expect(await r.dispatcher().runOnce()).to.equal('retry');
    expect(await stateFor(r, a.orderId)).to.equal(S.NEW);
    expect(await r.dispatcher().runOnce()).to.equal(null); // backoff
    r.advance(1000);
    expect(await r.dispatcher().runOnce()).to.equal('retry');
    r.advance(2000);
    expect(await r.dispatcher().runOnce()).to.equal('placed');
    expect(r.venue.accepted.map((o) => o.clientOrderId)).to.deep.equal([a.clientOrderId]);
    const z = rig({ extra: { maxAttempts: 2 } });
    const b = await z.acceptance.accept(INTENT());
    z.venue.script.push('rate_limited', 'rate_limited');
    await z.dispatcher().runOnce(); z.advance(5000);
    expect(await z.dispatcher().runOnce()).to.equal('rejected');
    expect(await stateFor(z, b.orderId)).to.equal(S.REJECTED);
  });

  it('a dispatcher-side timeout (hung broker call) is UNKNOWN, not a retry', async () => {
    const r = rig({ extra: { submitTimeoutMs: 20, leaseMs: 100, notFoundGraceMs: 50 } });
    const a = await r.acceptance.accept(INTENT());
    r.venue._placeOrder = () => new Promise(() => {}); // never answers
    expect(await r.dispatcher().runOnce()).to.equal('unknown');
    expect(await orderOf(r, a.orderId)).to.deep.include({ status: 'unknown', lastError: 'DISPATCH_TIMEOUT' });
  });

  it('authority is re-checked at dispatch: revoked mandate or engaged guard → CANCELLED, nothing sent', async () => {
    let ok = true;
    const r = rig({ mandateOk: () => ok });
    const a = await r.acceptance.accept(INTENT());
    ok = false;
    expect(await r.dispatcher().runOnce()).to.equal('refused');
    expect(await orderOf(r, a.orderId)).to.deep.include({ status: 'cancelled', lastError: 'mandate REVOKED' });
    const g = rig({ guard: async () => ({ ok: false, reason: 'principal kill switch' }) });
    const b = await g.acceptance.accept(INTENT());
    expect(await g.dispatcher().runOnce()).to.equal('refused');
    expect(await stateFor(g, b.orderId)).to.equal(S.CANCELLED);
    expect([r.venue.placeCalls, g.venue.placeCalls]).to.deep.equal([0, 0]);
  });
});

describe('oms: reconciliation worker', () => {
  it('UNKNOWN + not found: waits out the grace window (eventual consistency), then re-queues with the same client id', async () => {
    const r = rig({ venue: undefined });
    r.venue.lagMs = 0;
    const a = await r.acceptance.accept(INTENT());
    r.venue._placeOrder = async () => { throw new BrokerError('AMBIGUOUS', { venue: 'mock' }); }; // it did NOT land
    await r.dispatcher().runOnce();
    r.advance(31_000);
    expect((await r.reconciler.runOnce()).requeued).to.equal(0);
    expect(await stateFor(r, a.orderId)).to.equal(S.UNKNOWN);
    r.advance(GRACE);
    expect((await r.reconciler.runOnce()).requeued).to.equal(1);
    expect(await stateFor(r, a.orderId)).to.equal(S.NEW);
    delete r.venue._placeOrder;
    r.venue._placeOrder = UnforgivingVenue.prototype._placeOrder.bind(r.venue);
    expect(await r.dispatcher().runOnce()).to.equal('placed');
    expect(r.venue.accepted.map((o) => o.clientOrderId)).to.deep.equal([a.clientOrderId]);
  });

  it('reconciles from HISTORY: a filled (no longer open) order is found and not resent', async () => {
    const r = rig();
    const a = await r.acceptance.accept(INTENT());
    r.venue.script.push('timeout_after');
    await r.dispatcher().runOnce();
    r.venue.accepted[0].status = 'filled'; r.venue.accepted[0].filledQuantity = '0.001';
    r.advance(31_000);
    await r.reconciler.runOnce();
    expect(await orderOf(r, a.orderId)).to.deep.include({ status: 'filled', filledQuantity: '0.001' });
    r.advance(GRACE * 2);
    await r.reconciler.runOnce();
    expect(await r.dispatcher().runOnce()).to.equal(null);
    expect(r.venue.countFor(a.clientOrderId)).to.equal(1); // the Binance-like venue WOULD have accepted a resend
  });

  it('an acknowledged order that vanishes is never re-sent automatically', async () => {
    const r = rig();
    const a = await r.acceptance.accept(INTENT());
    await r.dispatcher().runOnce();
    r.venue.accepted.length = 0; // venue "loses" it
    r.advance(31_000);
    await r.reconciler.runOnce();
    expect(await stateFor(r, a.orderId)).to.equal(S.ACK); // within the grace window: eventual consistency, wait
    r.advance(GRACE);
    await r.reconciler.runOnce();
    expect(await stateFor(r, a.orderId)).to.equal(S.UNKNOWN);
    r.advance(GRACE * 3);
    await r.reconciler.runOnce();
    expect(await orderOf(r, a.orderId)).to.deep.include({ status: 'unknown', lastError: 'acknowledged order missing at venue: manual review required' });
    expect(await r.dispatcher().runOnce()).to.equal(null);
  });

  it('CANCEL_REQUESTED (Stage 16 revocation) is cancelled at the venue', async () => {
    const r = rig();
    const a = await r.acceptance.accept(INTENT());
    await r.dispatcher().runOnce();
    const o = await orderOf(r, a.orderId);
    await r.store.updateOrder(o.id, 'acknowledged', { status: 'cancel_requested' }); // what Stage 16 writes
    const out = await r.reconciler.runOnce();
    expect(out.cancelsRequested).to.equal(1);
    expect(await stateFor(r, a.orderId)).to.equal(S.CANCELLED);
    expect(r.venue.accepted[0].status).to.equal('cancelled');
  });
});

describe('oms: 1,000 randomized injected-failure runs (acceptance: zero duplicate broker orders)', function () {
  this.timeout(120_000);
  const mulberry = (seed) => { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };

  async function oneRun(seed) {
    const rnd = mulberry(seed);
    const t = { now: T0 };
    const chaos = { timeoutAfter: 0.15, timeoutBefore: 0.1, rateLimited: 0.08, reject: 0.05, fill: 0.15, lookupError: 0.1 };
    const venue = new UnforgivingVenue({ clock: () => t.now, rnd, lagMs: Math.floor(rnd() * GRACE * 0.8), chaos });
    const r = rig({ venue });
    r.t.now = t.now;
    Object.defineProperty(t, 'now', { get: () => r.t.now, set: (v) => { r.t.now = v; } });
    let crashP = 0.12;
    const faults = { crash(point) { if (rnd() < crashP) throw new SimulatedCrash(point); } };
    const ids = [];
    const nOrders = 1 + Math.floor(rnd() * 4);
    for (let i = 0; i < nOrders; i += 1) {
      const key = rnd() < 0.2 && ids.length ? `idem_run${seed}_0` : `idem_run${seed}_${i}`; // some duplicate submissions
      const a = await r.acceptance.accept(INTENT(key));
      if (!ids.includes(a.orderId)) ids.push(a.orderId);
      if (rnd() < 0.3) await r.store.insertOutbox({ aggregateId: a.orderId, eventType: 'order.place', payload: {}, idempotencyKey: `place:${a.orderId}:extra:${i}`, nextAttemptAt: r.t.now }); // duplicate event
    }
    const step = async () => {
      const k = rnd();
      const d = () => r.dispatcher(faults).runOnce().catch((e) => { if (!(e instanceof SimulatedCrash)) throw e; });
      if (k < 0.35) await d();
      else if (k < 0.55) await Promise.all([d(), d()]); // concurrent dispatchers
      else if (k < 0.7) await Promise.all([d(), r.reconciler.runOnce()]); // dispatcher racing the reconciler
      else if (k < 0.8) await r.reconciler.runOnce();
      else if (k < 0.88) venue.tick();
      else r.advance(Math.floor(rnd() * (LEASE + GRACE)));
    };
    for (let i = 0; i < 120; i += 1) await step();
    // Drain: no more chaos; let leases and grace windows pass until everything settles.
    crashP = 0; venue.rnd = null; venue.script = [];
    for (let i = 0; i < 40; i += 1) {
      r.advance(GRACE + LEASE);
      while ((await r.dispatcher().runOnce()) !== null) { /* drain */ }
      await r.reconciler.runOnce();
    }
    const dupes = [];
    const stuck = [];
    for (const id of ids) {
      const o = await r.store.getOrder(id);
      const n = venue.countFor(o.clientOrderId);
      if (n > 1) dupes.push({ seed, id, n });
      const st = stateOf(o.status);
      const atVenue = venue.accepted.find((x) => x.clientOrderId === o.clientOrderId);
      if (atVenue) {
        if (st !== FROM_BROKER[atVenue.status] && !(st === S.UNKNOWN && o.lastError?.includes('manual review'))) stuck.push({ seed, id, st, venue: atVenue.status });
      } else if (st !== S.REJECTED) stuck.push({ seed, id, st, venue: null });
    }
    return { dupes, stuck, placeCalls: venue.placeCalls, orders: ids.length, venueOrders: venue.accepted.length };
  }

  it('no OMS order ever produced more than one broker order, and every order converged', async () => {
    let dupes = [];
    let stuck = [];
    let calls = 0;
    let orders = 0;
    let venueOrders = 0;
    for (let seed = 1; seed <= 1000; seed += 1) {
      const res = await oneRun(seed);
      dupes = dupes.concat(res.dupes);
      stuck = stuck.concat(res.stuck);
      calls += res.placeCalls; orders += res.orders; venueOrders += res.venueOrders;
    }
    expect(dupes, JSON.stringify(dupes.slice(0, 5))).to.deep.equal([]);
    expect(stuck, JSON.stringify(stuck.slice(0, 5))).to.deep.equal([]);
    expect(calls, 'the chaos actually forced re-sends').to.be.greaterThan(orders);
    expect(venueOrders).to.be.at.most(orders);
  });
});

describe('oms: security (static)', () => {
  const files = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? files(path.join(dir, d.name)) : [path.join(dir, d.name)]));
  it('the dispatcher is the only caller of adapter.placeOrder in the trading module', () => {
    const callers = files(TA).filter((f) => f.endsWith('.mjs') && !f.includes(`${path.sep}brokers${path.sep}`))
      .filter((f) => /\.placeOrder\s*\(/.test(fs.readFileSync(f, 'utf8').replace(/\/\/.*$/gm, '')));
    expect(callers.map((f) => path.relative(TA, f))).to.deep.equal([path.join('oms', 'dispatcher.mjs')]);
    const d = fs.readFileSync(path.join(TA, 'oms', 'dispatcher.mjs'), 'utf8').replace(/\/\/.*$/gm, '');
    expect(d.match(/\.placeOrder\s*\(/g)).to.have.length(1); // exactly one call site, no retry loop around it
  });
  it('oms/** uses no queue library, Redis, process.env or network of its own', () => {
    for (const f of files(path.join(TA, 'oms'))) {
      const src = fs.readFileSync(f, 'utf8').replace(/\/\/.*$/gm, '');
      expect(src, f).to.not.match(/from ['"](bullmq|ioredis|redis|node:http|node:https|node:net)['"]|process\.env|fetch\(/);
    }
  });
});
