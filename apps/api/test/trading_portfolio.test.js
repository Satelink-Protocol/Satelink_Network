import { expect } from 'chai';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  foldPosition, valuePosition, FillConsumer, FILL_CONSUMER, PortfolioSnapshotter, PortfolioReconciler, PortfolioReadService, InMemoryPortfolioStore, PortfolioError, RECON_ACTOR,
} from '../src/trading_agent/portfolio/index.mjs';
import { OrderAcceptanceService, OrderDispatcher, OrderReconciler, InMemoryOmsStore } from '../src/trading_agent/oms/index.mjs';
import { MockBroker, MockScenario } from '../src/trading_agent/brokers/mock_broker.mjs';
import { InstrumentRegistry, defineInstrument } from '../src/trading_agent/brokers/symbols.mjs';
import { InMemoryRiskStore, KillSwitchService, activeKillSwitchesFor } from '../src/trading_agent/risk/index.mjs';

// Stage 18 — portfolio, P&L and broker reconciliation. Pure: no network, no DB, no process.env.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORTFOLIO_DIR = path.resolve(HERE, '../src/trading_agent/portfolio');
const T0 = Date.UTC(2026, 9, 6, 9, 0);
const Q = { quoteCurrency: 'USDT', quoteDecimals: 2 };
let seq = 0;
const fill = (side, quantity, price, { fee = '0', cur = 'USDT', dec = 2, t = ++seq, id = `f${seq}` } = {}) => ({
  fillId: id, side, quantity, price, feeMinor: fee, feeCurrency: cur, feeDecimals: dec, executedAt: new Date(T0 + t * 1000).toISOString(),
});

describe('portfolio: P&L maths (hand-computed fixtures)', () => {
  const cases = [
    {
      name: 'long build, partial close, flip to short (fees in quote)',
      fills: () => [fill('buy', '1', '100', { fee: '10' }), fill('buy', '1', '110', { fee: '11' }), fill('sell', '1.5', '120', { fee: '18' }), fill('sell', '1', '90', { fee: '9' })],
      // avg 105 → sell 1.5 @120: +22.5 → close 0.5 @90: −7.5, then short 0.5 @90; fees 0.48
      want: { quantity: '-0.5', avgEntryPrice: '90', grossRealizedPnl: '15', fees: '0.48', realizedPnl: '14.52', realizedPnlMinor: '1452', feesMinor: '48', fillCount: 4 },
      mark: '80', value: { unrealizedPnl: '5', netExposure: '-40', grossExposure: '40', unrealizedPnlMinor: '500' },
    },
    {
      name: 'short, partial cover at a profit',
      fills: () => [fill('sell', '2', '100'), fill('buy', '1', '90')],
      want: { quantity: '-1', avgEntryPrice: '100', realizedPnl: '10', realizedPnlMinor: '1000' },
      mark: '95', value: { unrealizedPnl: '5', netExposure: '-95' },
    },
    {
      name: 'round trip to flat: avg is null, nothing unrealised',
      fills: () => [fill('buy', '0.5', '30000'), fill('sell', '0.5', '30600')],
      want: { quantity: '0', avgEntryPrice: null, realizedPnl: '300', realizedPnlMinor: '30000' },
      mark: '1', value: { unrealizedPnl: '0', netExposure: '0' },
    },
    {
      name: 'losing long with weighted average',
      fills: () => [fill('buy', '3', '10'), fill('buy', '1', '14'), fill('sell', '2', '9')],
      // avg (30+14)/4 = 11 → sell 2 @9: −4
      want: { quantity: '2', avgEntryPrice: '11', realizedPnl: '-4', realizedPnlMinor: '-400' },
      mark: '12', value: { unrealizedPnl: '2', netExposure: '24', grossExposure: '24' },
    },
    {
      name: 'fee in another currency (BNB) is tracked, never mixed into USDT P&L',
      fills: () => [fill('buy', '1', '100', { fee: '75', cur: 'BNB', dec: 8 }), fill('sell', '1', '101', { fee: '25', cur: 'BNB', dec: 8 })],
      want: { quantity: '0', realizedPnl: '1', fees: '0', unconvertedFees: { BNB: '100' } },
    },
    {
      name: 'tiny quantities: minor units round half-even',
      fills: () => [fill('buy', '0.0003', '33333.33'), fill('sell', '0.0003', '33333.35')],
      // gross 0.000006 USDT → 0.0006 cents → rounds to 0
      want: { realizedPnl: '0.000006', realizedPnlMinor: '0' },
    },
  ];
  for (const c of cases) {
    it(c.name, () => {
      const p = foldPosition(c.fills(), Q);
      expect(p).to.deep.include(c.want);
      if (c.mark) expect(valuePosition(p, c.mark, { quoteDecimals: 2 })).to.deep.include(c.value);
    });
  }

  it('is order-independent and counts a redelivered fill once', () => {
    const fs1 = [fill('buy', '1', '100'), fill('buy', '1', '110'), fill('sell', '1.5', '120'), fill('sell', '1', '90')];
    const a = foldPosition(fs1, Q);
    const b = foldPosition([...fs1].reverse(), Q);
    const c = foldPosition([...fs1, { ...fs1[2] }, { ...fs1[0] }], Q);
    expect(b).to.deep.equal(a);
    expect(c).to.deep.equal(a);
  });

  it('rejects malformed fills', () => {
    for (const bad of [fill('hold', '1', '1'), fill('buy', '0', '1'), fill('buy', '1', '-1'), fill('buy', 1, '1')]) {
      expect(() => foldPosition([bad], Q)).to.throw();
    }
    expect(() => foldPosition([], { quoteCurrency: 'USDT', quoteDecimals: 19 })).to.throw(PortfolioError);
  });
});

// ── OMS → fills → positions, end to end ───────────────────────────────────────

const SPEC = defineInstrument({ canonical: 'BTC-USDT', venue: 'mock', venueSymbol: 'BTCUSDT', quoteCurrency: 'USDT', quoteDecimals: 2, tickSize: '0.01', lotSize: '0.0001', minQuantity: '0.0001', minNotional: '1' });
function omsRig({ scenarios = {} } = {}) {
  const t = { now: T0 };
  const clock = () => new Date(t.now);
  const oms = new InMemoryOmsStore();
  const broker = new MockBroker({ credentialLoader: { async load() { return {}; } }, instruments: new InstrumentRegistry([SPEC]), scenarios, clock, marketPrices: { 'BTC-USDT': '30000' } });
  const adapters = { forVenue: () => broker };
  const mandates = { async verifyForOrder() { return { principalId: 'prn_alice', brokerAccountId: 'bka_0001', currency: 'USDT', decimals: 2, termsHash: `sha256:${'e'.repeat(64)}` }; } };
  let n = 0;
  const acceptance = new OrderAcceptanceService({ store: oms, mandates, risk: { async decide() { return { decision: 'APPROVE', recorded: true, decisionId: `rdc_${++n}` }; } }, venues: { capabilities: () => broker.capabilities() }, idFactory: (p) => `${p}_${String(++n).padStart(4, '0')}`, clock });
  const dispatcher = new OrderDispatcher({ store: oms, adapters, mandates, clock });
  const omsReconciler = new OrderReconciler({ store: oms, adapters, clock });
  const store = new InMemoryPortfolioStore({ oms });
  const consumer = new FillConsumer({ store, adapters, clock });
  return { t, clock, oms, broker, adapters, acceptance, dispatcher, omsReconciler, store, consumer };
}
const INTENT = (k, side = 'buy', quantity = '0.002') => ({ idempotencyKey: k, principalId: 'prn_alice', brokerAccountId: 'bka_0001', mandateId: 'mdt_1', origin: 'manual', approvedBy: 'prn_alice', mode: 'paper', venue: 'mock', instrument: 'BTC-USDT', side, type: 'market', quantity });

describe('portfolio: fill consumer (OMS events → fills → positions)', () => {
  it('ingests fills from OMS broker events and builds the position; re-runs are idempotent', async () => {
    const r = omsRig();
    const a = await r.acceptance.accept(INTENT('idem_pf_0001'));
    const b = await r.acceptance.accept(INTENT('idem_pf_0002', 'buy', '0.001'));
    const m = new MockBroker({ credentialLoader: { async load() { return {}; } }, instruments: new InstrumentRegistry([SPEC]), clock: r.clock, marketPrices: { 'BTC-USDT': '30000' }, scenarios: { [a.clientOrderId]: MockScenario.FILL, [b.clientOrderId]: MockScenario.FILL } });
    r.adapters.forVenue = () => m;
    await r.dispatcher.runOnce(); await r.dispatcher.runOnce();
    const out = await r.consumer.runOnce();
    expect(out).to.deep.include({ fillsInserted: 2, error: null });
    const [pos] = await r.store.positions('prn_alice');
    // 0.003 BTC @30000 = 90 USDT; MockBroker fee 10 bps on each fill: 0.06 + 0.03 → realised −0.09
    expect(pos).to.deep.include({ quantity: '0.003', avgEntryPrice: '30000', realizedPnlMinor: '-9', feesMinor: '9', fillCount: 2, mode: 'paper', currency: 'USDT' });
    expect(r.store.state.fills.every((f) => f.ledgerTxnId === undefined)).to.equal(true); // never the ledger
    expect((await r.consumer.runOnce()).fillsInserted).to.equal(0);
    expect(await r.store.getCursor(FILL_CONSUMER)).to.equal(out.cursor);
  });

  it('picks up later fills (partial → more fills reported by the OMS reconciler) and realises P&L on a sell', async () => {
    const r = omsRig();
    const a = await r.acceptance.accept(INTENT('idem_pf_0003', 'buy', '0.004'));
    const m = new MockBroker({ credentialLoader: { async load() { return {}; } }, instruments: new InstrumentRegistry([SPEC]), clock: r.clock, marketPrices: { 'BTC-USDT': '30000' }, scenarios: { [a.clientOrderId]: MockScenario.PARTIAL } });
    r.adapters.forVenue = () => m;
    await r.dispatcher.runOnce();
    await r.consumer.runOnce();
    expect((await r.store.positions('prn_alice'))[0].quantity).to.equal('0.002');
    m.simulateFill(a.clientOrderId, '0.002');
    r.t.now += 31_000;
    await r.omsReconciler.runOnce(); // OMS writes broker_status → consumer sees it
    expect((await r.consumer.runOnce()).fillsInserted).to.equal(1);
    expect((await r.store.positions('prn_alice'))[0]).to.deep.include({ quantity: '0.004', fillCount: 2 });
  });

  it('a venue error stops the consumer before that event (cursor not advanced past it); a failed write rolls back', async () => {
    const r = omsRig();
    const a = await r.acceptance.accept(INTENT('idem_pf_0004'));
    const b = await r.acceptance.accept(INTENT('idem_pf_0005', 'buy', '0.001'));
    const m = new MockBroker({ credentialLoader: { async load() { return {}; } }, instruments: new InstrumentRegistry([SPEC]), clock: r.clock, marketPrices: { 'BTC-USDT': '30000' }, scenarios: { [a.clientOrderId]: MockScenario.FILL, [b.clientOrderId]: MockScenario.FILL } });
    r.adapters.forVenue = () => m;
    await r.dispatcher.runOnce(); await r.dispatcher.runOnce();
    // Only the FIRST order's fills are unavailable; a later event for another order is fine.
    r.adapters.forVenue = () => ({ listFills: async (acct, ref) => { if (ref.clientOrderId === a.clientOrderId) throw Object.assign(new Error('down'), { code: 'VENUE_UNAVAILABLE' }); return m.listFills(acct, ref); } });
    const out = await r.consumer.runOnce();
    expect(out.error).to.match(/VENUE_UNAVAILABLE/);
    expect(out.fillsInserted).to.equal(0); // stopped AT the failed event: nothing after it was processed
    expect(await r.store.getCursor(FILL_CONSUMER)).to.equal(0); // never skips past a failed event
    r.adapters.forVenue = () => m;
    const orig = r.store.upsertPosition.bind(r.store);
    r.store.upsertPosition = async () => { throw new Error('crash mid-transaction'); };
    let err;
    try { await r.consumer.runOnce(); } catch (e) { err = e; }
    expect(err.message).to.equal('crash mid-transaction');
    expect(r.store.state.fills).to.have.length(0); // fill insert rolled back with the position
    r.store.upsertPosition = orig;
    expect((await r.consumer.runOnce()).fillsInserted).to.equal(2); // both orders' fills, none lost
    expect((await r.store.positions('prn_alice'))[0].quantity).to.equal('0.003');
  });
});

// ── snapshots, reconciliation, auto-pause ─────────────────────────────────────

function pfRig({ broker = [], marks = { 'BTC-USDT': { price: '31000', stale: false } }, tolerance = { defaultQty: '0.0001' }, mismatchesToPause = 2 } = {}) {
  const r = omsRig();
  const riskStore = new InMemoryRiskStore();
  const killSwitches = new KillSwitchService({ store: riskStore, clock: r.clock });
  const accounts = { async get(id) { return { bka_0001: { principalId: 'prn_alice' }, bka_bob: { principalId: 'prn_bob' } }[id] ?? null; } };
  const paused = [];
  const brokerState = { positions: broker, fail: false };
  const reconciler = new PortfolioReconciler({
    store: r.store, accounts, killSwitches, clock: r.clock, tolerance, mismatchesToPause,
    brokerPositions: { async snapshot() { if (brokerState.fail) throw Object.assign(new Error('x'), { code: 'VENUE_UNAVAILABLE' }); return { asOf: r.clock().toISOString(), positions: brokerState.positions }; } },
    strategyPauser: async (x) => { paused.push(x); return ['stv_1']; },
  });
  let k = 0;
  const snapshotter = new PortfolioSnapshotter({ store: r.store, marks: { async mark(i) { return marks[i] ?? null; } }, clock: r.clock, idFactory: () => `pfs_${++k}` });
  const reads = new PortfolioReadService({ store: r.store, accounts });
  return { ...r, riskStore, killSwitches, accounts, paused, brokerState, reconciler, snapshotter, reads };
}
async function seedPosition(r, quantity = '0.003') {
  await r.store.upsertPosition({ id: 'pos_1', principalId: 'prn_alice', brokerAccountId: 'bka_0001', instrument: 'BTC-USDT', mode: 'paper', quantity, avgEntryPrice: quantity === '0' ? null : '30000', realizedPnlMinor: '-9', currency: 'USDT', decimals: 2, feesMinor: '9', fillCount: 2, lastFillAt: null, unconvertedFees: {}, updatedAt: '' });
}

describe('portfolio: snapshots', () => {
  it('values positions at marks; hashes the snapshot', async () => {
    const r = pfRig();
    await seedPosition(r);
    const s = await r.snapshotter.take({ principalId: 'prn_alice', brokerAccountId: 'bka_0001', mode: 'paper' });
    expect(s).to.deep.include({ marksComplete: true, unrealizedPnlMinor: '300', grossExposureMinor: '9300', netExposureMinor: '9300', realizedPnlMinor: '-9', feesMinor: '9' }); // 0.003 × (31000 − 30000)
    expect(s.snapshotHash).to.match(/^sha256:/);
  });
  it('a stale or missing mark makes unrealised P&L null, never a guess', async () => {
    for (const marks of [{ 'BTC-USDT': { price: '31000', stale: true } }, {}]) {
      const r = pfRig({ marks });
      await seedPosition(r);
      const s = await r.snapshotter.take({ principalId: 'prn_alice', brokerAccountId: 'bka_0001', mode: 'paper' });
      expect(s).to.deep.include({ marksComplete: false, unrealizedPnlMinor: null, grossExposureMinor: null });
      expect(s.positions[0]).to.deep.include({ mark: null, unrealizedPnlMinor: null });
    }
  });
});

describe('portfolio: broker reconciliation → auto-pause', () => {
  const run = (r) => r.reconciler.runOnce({ principalId: 'prn_alice', brokerAccountId: 'bka_0001', mode: 'paper' });

  it('a difference within tolerance is a match; no pause', async () => {
    const r = pfRig({ broker: [{ instrument: 'BTC-USDT', quantity: '0.0031' }] });
    await seedPosition(r);
    expect(await run(r)).to.deep.include({ status: 'match', action: 'none', consecutiveMismatches: 0 });
    expect(r.riskStore.killSwitches).to.have.length(0);
  });

  it('a mismatch that persists pauses the account once: kill switch + strategy.auto_paused + hook', async () => {
    const r = pfRig({ broker: [{ instrument: 'BTC-USDT', quantity: '0.005' }, { instrument: 'ETH-USDT', quantity: '1' }] });
    await seedPosition(r);
    const e1 = await run(r);
    expect(e1).to.deep.include({ status: 'mismatch', consecutiveMismatches: 1, action: 'none' }); // a single read can be a race with fills
    expect(e1.details.diffs.map((d) => [d.instrument, d.internal, d.broker, d.diff])).to.deep.equal([['BTC-USDT', '0.003', '0.005', '0.002'], ['ETH-USDT', '0', '1', '1']]);
    const e2 = await run(r);
    expect(e2).to.deep.include({ status: 'mismatch', consecutiveMismatches: 2, action: 'paused' });
    expect(r.riskStore.killSwitches).to.have.length(1);
    expect(r.riskStore.killSwitches[0]).to.deep.include({ scopeType: 'broker_account', scopeId: 'bka_0001', principalId: 'prn_alice', action: 'engage', source: 'system', actorId: RECON_ACTOR.principalId });
    expect(r.store.state.outbox).to.have.length(1);
    expect(r.store.state.outbox[0]).to.deep.include({ aggregateType: 'strategy', eventType: 'strategy.auto_paused', idempotencyKey: `strategy.auto_paused:${e2.id}` });
    expect(r.store.state.outbox[0].payload).to.deep.include({ brokerAccountId: 'bka_0001', reconciliationEventId: e2.id, pausedStrategies: ['stv_1'] });
    expect(r.store.state.audit.map((a) => a.action)).to.deep.equal(['strategy.auto_paused']);
    expect(r.paused).to.have.length(1);
    expect(await run(r)).to.deep.include({ consecutiveMismatches: 3, action: 'already_paused' });
    expect(r.riskStore.killSwitches).to.have.length(1); // not re-engaged within the streak
    // Stage 15 check 1 now stops every order on the account
    const order = { principalId: 'prn_alice', brokerAccountId: 'bka_0001', mandateId: 'mdt_1', strategyId: null, venue: 'mock', instrument: 'BTC-USDT' };
    expect(activeKillSwitchesFor(r.riskStore.killSwitches, order).map((s) => s.scopeType)).to.deep.equal(['broker_account']);
    // the pause stays until a human releases it, even after the books agree again
    r.brokerState.positions = [{ instrument: 'BTC-USDT', quantity: '0.003' }];
    expect(await run(r)).to.deep.include({ status: 'match', consecutiveMismatches: 0 });
    expect(activeKillSwitchesFor(r.riskStore.killSwitches, order)).to.have.length(1);
    await r.killSwitches.release({ actor: { principalId: 'prn_alice', kind: 'human', role: 'user' }, scopeType: 'broker_account', scopeId: 'bka_0001', principalId: 'prn_alice', reason: 'reviewed' });
    expect(activeKillSwitchesFor(r.riskStore.killSwitches, order)).to.have.length(0);
  });

  it('broker read errors count as not-matching (cannot confirm) and pause after the streak', async () => {
    const r = pfRig({ mismatchesToPause: 3 });
    await seedPosition(r);
    r.brokerState.fail = true;
    expect((await run(r)).status).to.equal('error');
    expect((await run(r)).action).to.equal('none');
    expect(await run(r)).to.deep.include({ status: 'error', consecutiveMismatches: 3, action: 'paused' });
  });

  it('relative tolerance, a failed pause, and the tenant check', async () => {
    const r = pfRig({ broker: [{ instrument: 'BTC-USDT', quantity: '100.4' }], tolerance: { defaultQty: '0', relativeBps: 50 } });
    await seedPosition(r, '100');
    expect((await run(r)).status).to.equal('match'); // 0.4 ≤ 0.5 % of 100.4
    r.brokerState.positions = [{ instrument: 'BTC-USDT', quantity: '101' }];
    expect((await run(r)).status).to.equal('mismatch'); // 1 > 0.5 % of 101
    const s = pfRig({ broker: [{ instrument: 'BTC-USDT', quantity: '9' }], mismatchesToPause: 1 });
    await seedPosition(s);
    s.killSwitches.engage = async () => { throw new Error('risk store down'); };
    const e = await run(s);
    expect(e).to.deep.include({ action: 'pause_failed' });
    expect(e.details.pauseError).to.equal('risk store down');
    let err;
    try { await r.reconciler.runOnce({ principalId: 'prn_alice', brokerAccountId: 'bka_bob', mode: 'paper' }); } catch (x) { err = x; }
    expect(err.code).to.equal('NOT_FOUND');
  });
});

describe('portfolio: tenant filters', () => {
  it('reads only ever return the caller\'s rows; another tenant\'s account is not found', async () => {
    const r = pfRig({ broker: [{ instrument: 'BTC-USDT', quantity: '0.003' }] });
    await seedPosition(r);
    await r.store.upsertPosition({ id: 'pos_2', principalId: 'prn_bob', brokerAccountId: 'bka_bob', instrument: 'ETH-USDT', mode: 'paper', quantity: '1', avgEntryPrice: '2000', realizedPnlMinor: '0', currency: 'USDT', decimals: 2, feesMinor: '0', fillCount: 1, lastFillAt: null, unconvertedFees: {}, updatedAt: '' });
    await r.snapshotter.take({ principalId: 'prn_alice', brokerAccountId: 'bka_0001', mode: 'paper' });
    await r.reconciler.runOnce({ principalId: 'prn_alice', brokerAccountId: 'bka_0001', mode: 'paper' });
    expect((await r.reads.positions('prn_alice')).map((p) => p.instrument)).to.deep.equal(['BTC-USDT']);
    expect((await r.reads.positions('prn_bob')).map((p) => p.instrument)).to.deep.equal(['ETH-USDT']);
    expect(await r.reads.snapshots('prn_bob')).to.deep.equal([]);
    expect(await r.reads.reconciliationEvents('prn_bob')).to.deep.equal([]);
    for (const fn of ['positions', 'snapshots', 'reconciliationEvents']) {
      let err;
      try { await r.reads[fn]('prn_bob', { brokerAccountId: 'bka_0001' }); } catch (e) { err = e; }
      expect(err?.code, fn).to.equal('NOT_FOUND');
    }
    let bad;
    try { await r.reads.positions('not-a-principal'); } catch (e) { bad = e; }
    expect(bad.code).to.equal('INVALID');
  });
});

describe('portfolio: never the real ledger (static)', () => {
  it('portfolio/** writes no ledger table and imports no ledger / billing / settlement code', () => {
    for (const f of fs.readdirSync(PORTFOLIO_DIR).filter((x) => x.endsWith('.mjs'))) {
      const src = fs.readFileSync(path.join(PORTFOLIO_DIR, f), 'utf8').replace(/\/\/.*$/gm, '');
      expect(src, f).to.not.match(/INSERT INTO (ledger|journal|ledger_entries|ledger_txns|accounts|revenue)|UPDATE (ledger|journal|ledger_entries|accounts)|ledger_txn_id\s*[,)=]/i);
      const specs = [...src.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
      for (const s of specs) expect(s, `${f} → ${s}`).to.not.match(/ledger|billing|settlement|economics|^(ioredis|redis|bullmq)$/);
      expect(src, f).to.not.match(/process\.env|fetch\(/);
    }
  });
});
