import { expect } from 'chai';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CHECKS, evaluateChecks, Decision, RiskEngine, InMemoryRiskStore, KillSwitchService, RiskPolicyService, definePolicy,
  activeKillSwitchesFor, reducesExposure, HARD_CAPS,
} from '../src/trading_agent/risk/index.mjs';
import { tradingFlagEnvName as F } from '../src/trading_agent/flags.mjs';

// Stage 15 — deterministic pre-trade risk engine. Pure: no network, no DB, no process.env.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const RISK_DIR = path.resolve(HERE, '../src/trading_agent/risk');
const NOW = Date.UTC(2026, 9, 5, 14, 0); // Monday 2026-10-05 14:00Z (= 10:00 New York, EDT)
const DAY = 86_400_000;

const ORDER = () => ({
  idempotencyKey: 'idem_00000001', principalId: 'prn_alice', brokerAccountId: 'bka_1', mandateId: 'mdt_1', strategyVersionId: 'stv_1',
  origin: 'strategy', approvedBy: 'prn_alice', mode: 'paper', venue: 'binance', instrument: 'BTC-USDT', side: 'buy', type: 'limit',
  quantity: '0.01', limitPrice: '30000',
});
const CTX = () => ({
  now: NOW,
  flagsEnv: { [F('TRADING_AGENT')]: 'true', [F('BINANCE')]: 'true' },
  policy: {
    id: 'rsk_1', version: 1, hash: `sha256:${'a'.repeat(64)}`, currency: 'USDT', decimals: 2,
    maxOrderNotionalMinor: '100000', maxDailyNotionalMinor: '500000', maxDailyLossMinor: '20000', maxLeverage: '2', maxOpenPositions: 3,
    allowedInstruments: ['BTC-USDT', 'ETH-USDT'], killSwitch: false,
    limits: {
      maxPositionNotionalMinor: '200000', maxPriceDeviationBps: 100, maxQuoteAgeMs: 5000, maxOrdersPerMinute: 10, maxOrdersPerDay: 200,
      duplicateWindowMs: 2000, allowShort: false, breakers: { maxConsecutiveLosses: 5, maxConsecutiveRejects: 10, maxBrokerErrors: 5 },
    },
  },
  killSwitchEvents: [],
  brokerAccount: { id: 'bka_1', principalId: 'prn_alice', broker: 'binance', environment: 'paper', status: 'active' },
  mandate: {
    id: 'mdt_1', principalId: 'prn_alice', brokerAccountId: 'bka_1', strategyId: 'stg_1', mode: 'copilot', status: 'active',
    maxNotionalMinor: '100000', currency: 'USDT', decimals: 2, validFrom: NOW - DAY, validUntil: NOW + DAY, approvedAt: NOW - DAY, stepUpMethod: 'passkey',
  },
  strategy: { versionId: 'stv_1', strategyId: 'stg_1', state: 'PAPER', instruments: ['BTC-USDT'] },
  instrument: { canonical: 'BTC-USDT', venue: 'binance', tickSize: '0.01', lotSize: '0.0001', minQuantity: '0.0001', minNotional: '5', quoteCurrency: 'USDT' },
  quote: { instrument: 'BTC-USDT', bid: '29990', ask: '30010', sourceTime: NOW - 500, stale: false },
  account: { equityMinor: '1000000', cashAvailableMinor: '800000', grossExposureMinor: '100000' },
  activity: {
    idempotencyKeyUsed: false, ordersLastMinute: 0, ordersToday: 3, todayNotionalMinor: '100000', realizedPnlTodayMinor: '-500', unrealizedPnlMinor: '200',
    openPositions: [{ instrument: 'ETH-USDT', quantity: '0.5', notionalMinor: '100000' }], lastSimilarOrderAt: null,
    consecutiveLosses: 0, consecutiveRejects: 0, brokerErrorsInWindow: 0,
  },
});
/** A manual sell of the existing ETH long: strictly reduces exposure. */
const ETH_SELL = (o, c) => {
  Object.assign(o, { instrument: 'ETH-USDT', side: 'sell', quantity: '0.5', limitPrice: '2000', origin: 'manual' });
  delete o.strategyVersionId;
  c.instrument = { ...c.instrument, canonical: 'ETH-USDT', lotSize: '0.001', minQuantity: '0.001' };
  c.quote = { ...c.quote, instrument: 'ETH-USDT', bid: '1999', ask: '2001' };
};
/** A consistent NYSE equity order (alpaca); `at` sets the clock. */
const NYSE = (at) => (o, c) => {
  Object.assign(o, { venue: 'alpaca', instrument: 'NASDAQ:AAPL', quantity: '1', limitPrice: '200' });
  c.now = at;
  c.flagsEnv[F('ALPACA')] = 'true';
  c.brokerAccount.broker = 'alpaca';
  c.policy = { ...c.policy, currency: 'USD', allowedInstruments: ['NASDAQ:AAPL'] };
  c.mandate.currency = 'USD';
  c.strategy.instruments = ['NASDAQ:AAPL'];
  c.instrument = { canonical: 'NASDAQ:AAPL', venue: 'alpaca', tickSize: '0.01', lotSize: '1', minQuantity: '1', minNotional: '1', quoteCurrency: 'USD' };
  c.quote = { instrument: 'NASDAQ:AAPL', bid: '199.9', ask: '200.1', sourceTime: at - 500, stale: false };
};

function run(mutate) {
  const o = ORDER();
  const c = CTX();
  if (mutate) mutate(o, c);
  return evaluateChecks(o, c);
}

describe('risk: the 20 ordered checks', () => {
  it('registry: exactly checks 1–20, in order, with unique ids', () => {
    expect(CHECKS.map((c) => c.n)).to.deep.equal(Array.from({ length: 20 }, (_, i) => i + 1));
    expect(new Set(CHECKS.map((c) => c.id)).size).to.equal(20);
    expect(CHECKS[0].id).to.equal('kill_switch');
  });

  it('positive: the baseline order passes every check individually and APPROVEs as a whole', () => {
    for (const c of CHECKS) expect(c.fn(ORDER(), CTX()), `${c.n} ${c.id}`).to.deep.equal({ ok: true });
    const r = run();
    expect(r.decision).to.equal(Decision.APPROVE);
    expect(r.trace.map((t) => t.outcome)).to.deep.equal(Array(20).fill('pass'));
  });

  // [check n, code, mutation]
  const NEGATIVE = [
    [1, 'POLICY_MISSING', (o, c) => { c.policy = null; }],
    [1, 'POLICY_KILL_SWITCH', (o, c) => { c.policy.killSwitch = true; }],
    [1, 'POLICY_KILL_SWITCH', (o, c) => { delete c.policy.killSwitch; }], // missing = engaged
    [1, 'KILL_SWITCH', (o, c) => { c.killSwitchEvents = [{ seq: 1, scopeType: 'global', scopeId: null, principalId: null, action: 'engage', source: 'admin', reason: 'incident' }]; }],
    [1, 'KILL_SWITCH', (o, c) => { c.killSwitchEvents = [{ seq: 1, scopeType: 'instrument', scopeId: 'BTC-USDT', principalId: null, action: 'engage', source: 'admin', reason: 'delisting' }]; }],
    [1, 'KILL_SWITCH', (o, c) => { c.killSwitchEvents = [{ seq: 1, scopeType: 'strategy', scopeId: 'stg_1', principalId: 'prn_alice', action: 'engage', source: 'user', reason: 'review' }]; }],
    [2, 'BREAKER_CONSECUTIVE_LOSSES', (o, c) => { c.activity.consecutiveLosses = 5; }],
    [2, 'BREAKER_CONSECUTIVE_REJECTS', (o, c) => { c.activity.consecutiveRejects = 10; }],
    [2, 'BREAKER_BROKER_ERRORS', (o, c) => { c.activity.brokerErrorsInWindow = 5; }],
    [3, 'FLAG_DISABLED', (o, c) => { delete c.flagsEnv[F('BINANCE')]; }],
    [3, 'FLAG_DISABLED', (o, c) => { c.flagsEnv = {}; }],
    [3, 'FLAG_DISABLED', (o, c) => { o.mode = 'live'; for (const f of ['LIVE_TRADING', 'LIVE_SMALL', 'AUTONOMOUS_MODE']) c.flagsEnv[F(f)] = 'true'; }], // LIVE_TRADING is LOCKED
    [3, 'FLAG_DISABLED', (o, c) => { delete o.approvedBy; c.flagsEnv[F('AUTONOMOUS_MODE')] = 'true'; }], // AUTONOMOUS_MODE is LOCKED
    [4, 'INVALID_ORDER', (o) => { o.quantity = 0.01; }],
    [4, 'INVALID_ORDER', (o) => { o.leverage = 10; }],
    [4, 'INVALID_ORDER', (o) => { o.type = 'market'; }],
    [4, 'INVALID_ORDER', (o) => { delete o.limitPrice; }],
    [4, 'INVALID_ORDER', (o) => { delete o.strategyVersionId; }],
    [4, 'INVALID_ORDER', (o, c) => { c.instrument.canonical = 'ETH-USDT'; }],
    [5, 'DUPLICATE_IDEMPOTENCY_KEY', (o, c) => { c.activity.idempotencyKeyUsed = true; }],
    [6, 'ACCOUNT_NOT_FOUND', (o, c) => { c.brokerAccount.principalId = 'prn_mallory'; }],
    [6, 'ACCOUNT_NOT_FOUND', (o, c) => { c.brokerAccount = null; }],
    [6, 'ACCOUNT_INACTIVE', (o, c) => { c.brokerAccount.status = 'suspended'; }],
    [6, 'ACCOUNT_MODE_MISMATCH', (o, c) => { c.brokerAccount.environment = 'live'; }],
    [6, 'ACCOUNT_VENUE_MISMATCH', (o, c) => { c.brokerAccount.broker = 'alpaca'; }],
    [7, 'MANDATE_NOT_FOUND', (o, c) => { c.mandate.principalId = 'prn_mallory'; }],
    [7, 'MANDATE_ACCOUNT_MISMATCH', (o, c) => { c.mandate.brokerAccountId = 'bka_2'; }],
    [7, 'MANDATE_INACTIVE', (o, c) => { c.mandate.status = 'paused'; }],
    [7, 'MANDATE_NOT_APPROVED', (o, c) => { c.mandate.stepUpMethod = null; }],
    [7, 'MANDATE_EXPIRED', (o, c) => { c.mandate.validUntil = NOW; }],
    [7, 'MANDATE_EXPIRED', (o, c) => { c.mandate.validFrom = NOW + 1; }],
    [7, 'APPROVAL_REQUIRED', (o) => { o.approvedBy = 'prn_bob'; }],
    [7, 'CURRENCY_MISMATCH', (o, c) => { c.mandate.currency = 'INR'; }],
    [8, 'STRATEGY_NOT_FOUND', (o, c) => { c.strategy = null; }],
    [8, 'STRATEGY_STATE', (o, c) => { c.strategy.state = 'BACKTESTED'; }],
    [8, 'STRATEGY_STATE', (o, c) => { c.strategy.state = 'PAUSED'; }],
    [8, 'STRATEGY_NOT_IN_MANDATE', (o, c) => { c.mandate.strategyId = 'stg_2'; }],
    [8, 'STRATEGY_UNIVERSE', (o, c) => { c.strategy.instruments = ['ETH-USDT']; }],
    [9, 'INSTRUMENT_NOT_ALLOWED', (o, c) => { c.policy.allowedInstruments = ['ETH-USDT']; }],
    [9, 'INSTRUMENT_NOT_ALLOWED', (o, c) => { c.policy.allowedInstruments = []; }],
    [10, 'MARKET_CLOSED', NYSE(Date.UTC(2026, 9, 5, 21, 0))], // 17:00 New York
    [10, 'MARKET_CLOSED', NYSE(Date.UTC(2026, 9, 4, 15, 0))], // Sunday
    [11, 'NO_MARKET_DATA', (o, c) => { c.quote = null; }],
    [11, 'NO_MARKET_DATA', (o, c) => { c.quote.instrument = 'ETH-USDT'; }],
    [11, 'STALE_MARKET_DATA', (o, c) => { c.quote.stale = true; }],
    [11, 'STALE_MARKET_DATA', (o, c) => { c.quote.sourceTime = NOW - 5001; }],
    [11, 'BAD_MARKET_DATA', (o, c) => { c.quote.bid = '30020'; }],
    [12, 'SPREAD_TOO_WIDE', (o, c) => { c.quote.bid = '29000'; c.quote.ask = '31000'; }],
    [12, 'PRICE_COLLAR', (o) => { o.limitPrice = '30301'; }],
    [13, 'LOT_SIZE', (o) => { o.quantity = '0.01005'; }],
    [13, 'MIN_QUANTITY', (o, c) => { c.instrument.minQuantity = '0.02'; }],
    [13, 'TICK_SIZE', (o) => { o.limitPrice = '30000.005'; }],
    [14, 'MIN_NOTIONAL', (o) => { o.quantity = '0.0001'; }],
    [15, 'CURRENCY_MISMATCH', (o, c) => { c.instrument.quoteCurrency = 'USDC'; }],
    [15, 'MAX_ORDER_NOTIONAL', (o, c) => { c.policy.maxOrderNotionalMinor = '29999'; }],
    [15, 'MANDATE_NOTIONAL', (o, c) => { c.mandate.maxNotionalMinor = '29999'; }],
    [16, 'MAX_DAILY_NOTIONAL', (o, c) => { c.activity.todayNotionalMinor = '470001'; }],
    [17, 'MAX_DAILY_LOSS', (o, c) => { c.activity.realizedPnlTodayMinor = '-20200'; }],
    [18, 'REDUCE_ONLY', (o) => { o.reduceOnly = true; }],
    [18, 'MAX_OPEN_POSITIONS', (o, c) => { c.policy.maxOpenPositions = 1; }],
    [18, 'MAX_POSITION_NOTIONAL', (o, c) => { c.policy.limits.maxPositionNotionalMinor = '29999'; }],
    [19, 'SHORT_NOT_ALLOWED', (o) => { o.side = 'sell'; }],
    [19, 'NO_EQUITY', (o, c) => { c.account.equityMinor = '0'; }],
    [19, 'MAX_LEVERAGE', (o, c) => { c.policy.maxLeverage = '1'; c.account.equityMinor = '129999'; }],
    [19, 'INSUFFICIENT_BUYING_POWER', (o, c) => { c.account.cashAvailableMinor = '29999'; }],
    [20, 'ORDER_RATE_MINUTE', (o, c) => { c.activity.ordersLastMinute = 10; }],
    [20, 'ORDER_RATE_DAY', (o, c) => { c.activity.ordersToday = 200; }],
    [20, 'DUPLICATE_ORDER', (o, c) => { c.activity.lastSimilarOrderAt = NOW - 1999; }],
  ];

  it('negative: each case is rejected by exactly its check, with its code (fail fast, rest not evaluated)', () => {
    for (const [n, code, m] of NEGATIVE) {
      const r = run(m);
      expect([r.decision, r.failed?.n, r.failed?.code], `check ${n} ${code}`).to.deep.equal([Decision.REJECT, n, code]);
      expect(r.trace.slice(0, n - 1).every((t) => t.outcome === 'pass'), `checks before ${n} passed`).to.equal(true);
      expect(r.trace.slice(n).every((t) => t.outcome === 'not_evaluated')).to.equal(true);
    }
  });

  it('100% check coverage: every one of the 20 checks has at least one negative case', () => {
    const covered = new Set(NEGATIVE.map(([n]) => n));
    expect([...covered].sort((a, b) => a - b)).to.deep.equal(CHECKS.map((c) => c.n));
  });

  it('boundary positives: exactly at each limit still passes', () => {
    const atLimit = [
      ['max order notional = limit', (o, c) => { c.policy.maxOrderNotionalMinor = '30000'; c.mandate.maxNotionalMinor = '30000'; }],
      ['daily notional = limit', (o, c) => { c.activity.todayNotionalMinor = '470000'; }],
      ['loss just below limit', (o, c) => { c.activity.realizedPnlTodayMinor = '-20199'; }],
      ['position notional = limit', (o, c) => { c.policy.limits.maxPositionNotionalMinor = '30000'; }],
      ['leverage = max', (o, c) => { c.policy.maxLeverage = '1'; c.account.equityMinor = '130000'; }],
      ['cash = notional', (o, c) => { c.account.cashAvailableMinor = '30000'; }],
      ['quote age = max', (o, c) => { c.quote.sourceTime = NOW - 5000; }],
      ['collar: limit 100 bps from mid', (o) => { o.limitPrice = '30300'; }],
      ['orders: one below the per-minute cap', (o, c) => { c.activity.ordersLastMinute = 9; }],
      ['duplicate window just elapsed', (o, c) => { c.activity.lastSimilarOrderAt = NOW - 2000; }],
      ['min notional exactly', (o, c) => { c.instrument.minNotional = '300'; }], // 0.01 × 30000
      ['NYSE in session', NYSE(Date.UTC(2026, 9, 5, 14, 0))],
      ['mandate without end date', (o, c) => { c.mandate.validUntil = null; }],
      ['other principal\'s switch is ignored', (o, c) => { c.killSwitchEvents = [{ seq: 1, scopeType: 'principal', scopeId: 'prn_bob', principalId: 'prn_bob', action: 'engage', source: 'user', reason: 'x' }]; }],
    ];
    for (const [name, m] of atLimit) {
      const r = run(m);
      expect(r.decision, `${name}: ${r.failed?.n} ${r.failed?.code} ${r.failed?.detail}`).to.equal(Decision.APPROVE);
    }
  });

  it('exposure-reducing orders are exempt from checks 16–19 but never from kill switches or breakers', () => {
    const limitsHit = (o, c) => { ETH_SELL(o, c); c.activity.todayNotionalMinor = '500000'; c.activity.realizedPnlTodayMinor = '-999999'; c.policy.maxOpenPositions = 0; c.account.equityMinor = '0'; o.reduceOnly = true; };
    expect(reducesExposure(...(() => { const o = ORDER(); const c = CTX(); ETH_SELL(o, c); return [o, c]; })())).to.equal(true);
    expect(run(limitsHit).decision).to.equal(Decision.APPROVE);
    expect(run((o, c) => { limitsHit(o, c); o.quantity = '0.6'; c.policy.maxOrderNotionalMinor = '1000000'; c.mandate.maxNotionalMinor = '1000000'; }).failed).to.deep.include({ n: 16, code: 'MAX_DAILY_NOTIONAL' }); // flipping to short is NOT exempt
    expect(run((o, c) => { limitsHit(o, c); c.policy.killSwitch = true; }).failed.n).to.equal(1);
    expect(run((o, c) => { limitsHit(o, c); c.activity.consecutiveLosses = 9; }).failed.n).to.equal(2);
  });
});

describe('risk: fail closed', () => {
  it('a missing context field anywhere is a REJECT (CHECK_ERROR), never an exception', () => {
    const paths = ['activity', 'activity.openPositions', 'activity.consecutiveLosses', 'flagsEnv', 'instrument', 'account', 'policy.limits.breakers', 'policy.decimals', 'now', 'quote.sourceTime', 'mandate.validFrom', 'killSwitchEvents'];
    for (const p of paths) {
      const r = run((o, c) => { const ks = p.split('.'); let t = c; for (const k of ks.slice(0, -1)) t = t[k]; delete t[ks.at(-1)]; });
      expect(r.decision, p).to.equal(Decision.REJECT);
      expect(r.failed.code, p).to.equal('CHECK_ERROR');
    }
    expect(evaluateChecks(ORDER(), null).failed).to.deep.include({ n: 1, code: 'CHECK_ERROR' });
    expect(evaluateChecks(undefined, CTX()).decision).to.equal(Decision.REJECT);
  });

  it('a check that throws or returns anything but PASS / a coded rejection REJECTs', () => {
    const fake = (fn) => [{ n: 1, id: 'fake', fn }];
    for (const fn of [() => { throw new Error('boom'); }, () => undefined, () => true, () => ({ ok: 'yes' }), () => ({ ok: false }), () => null]) {
      const r = evaluateChecks(ORDER(), CTX(), fake(fn));
      expect(r.decision).to.equal(Decision.REJECT);
      expect(['CHECK_ERROR', 'INVALID_CHECK_RESULT']).to.include(r.failed.code);
    }
    expect(evaluateChecks(ORDER(), CTX(), []).decision).to.equal(Decision.REJECT); // empty registry ≠ approval (regression: found by this test)
    expect(evaluateChecks(ORDER(), CTX(), CHECKS.slice(0, 19)).decision).to.equal(Decision.REJECT); // partial registry
    expect(evaluateChecks(ORDER(), CTX(), [...CHECKS].reverse()).decision).to.equal(Decision.REJECT); // reordered registry
    expect(evaluateChecks(ORDER(), CTX(), CHECKS).decision).to.equal(Decision.APPROVE);
  });

  it('fuzz: 3000 random corruptions never throw and only APPROVE when all 20 checks passed', () => {
    let seed = 1500;
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    const junk = [undefined, null, 0, -1, 1.5, '', 'x', '-5', '999999999999999999999', [], {}, true, NaN];
    const leaves = (v, p = []) => (v && typeof v === 'object' ? Object.keys(v).flatMap((k) => leaves(v[k], [...p, k])) : [p]);
    let approves = 0;
    for (let i = 0; i < 3000; i += 1) {
      const o = ORDER();
      const c = CTX();
      const target = rnd() < 0.3 ? o : c;
      const ps = leaves(target);
      const p = ps[Math.floor(rnd() * ps.length)];
      let t = target;
      for (const k of p.slice(0, -1)) t = t[k];
      t[p.at(-1)] = junk[Math.floor(rnd() * junk.length)];
      const r = evaluateChecks(o, c);
      if (r.decision === Decision.APPROVE) {
        approves += 1;
        expect(r.trace.every((x) => x.outcome === 'pass')).to.equal(true);
      } else {
        expect(r.failed.code).to.be.a('string');
      }
    }
    expect(approves).to.be.lessThan(3000);
  });

  it('RiskEngine: loader error, loader timeout and a failed decision write all REJECT', async () => {
    let n = 0;
    const ids = (p) => `${p}_${++n}`;
    const okStore = new InMemoryRiskStore();
    const e1 = new RiskEngine({ loadContext: async () => { throw new Error('db down'); }, store: okStore, idFactory: ids });
    const d1 = await e1.decide(ORDER());
    expect([d1.decision, d1.failedCheck.code, d1.recorded]).to.deep.equal(['REJECT', 'CONTEXT_UNAVAILABLE', true]);
    const e2 = new RiskEngine({ loadContext: () => new Promise(() => {}), store: okStore, idFactory: ids, timeoutMs: 30 });
    const d2 = await e2.decide(ORDER());
    expect([d2.decision, d2.failedCheck.code]).to.deep.equal(['REJECT', 'CONTEXT_UNAVAILABLE']);
    expect(d2.failedCheck.detail).to.match(/timed out/);
    const failing = { ...okStore, recordDecision: async () => { throw new Error('disk full'); }, appendKillSwitchEvent: async () => {} };
    const e3 = new RiskEngine({ loadContext: async () => CTX(), store: failing, idFactory: ids });
    const d3 = await e3.decide(ORDER());
    expect(evaluateChecks(ORDER(), CTX()).decision).to.equal('APPROVE'); // the checks alone would approve…
    expect([d3.decision, d3.failedCheck.code, d3.recorded]).to.deep.equal(['REJECT', 'RECORD_FAILED', false]); // …but nothing unrecorded stands
    const e4 = new RiskEngine({ loadContext: async () => CTX(), store: okStore, idFactory: () => { throw new Error('x'); }, clock: () => { throw new Error('y'); } });
    expect((await e4.decide(ORDER())).decision).to.equal('APPROVE');
    expect(okStore.decisions).to.have.length(3);
  });

  it('RiskEngine: an approval is recorded with its full trace, policy version, order hash and context snapshot', async () => {
    const store = new InMemoryRiskStore();
    const engine = new RiskEngine({ loadContext: async () => CTX(), store, idFactory: (p) => `${p}_0001`, clock: () => new Date(NOW) });
    const d = await engine.decide(ORDER());
    expect(d).to.deep.include({ decisionId: 'rdc_0001', decision: 'APPROVE', failedCheck: null, recorded: true, checksVersion: 'risk-checks/1.0', engineVersion: 'risk-1.0' });
    const rec = store.decisions[0];
    expect(rec.policy).to.deep.equal({ id: 'rsk_1', version: 1, hash: CTX().policy.hash });
    expect(rec.trace).to.have.length(20);
    expect(rec.orderHash).to.match(/^sha256:/);
    expect(rec.context.hash).to.match(/^sha256:/);
    expect(rec.context.body.policy.maxOrderNotionalMinor).to.equal('100000');
    expect(rec.decidedAt).to.equal(new Date(NOW).toISOString());
  });
});

describe('risk: kill switch precedence and circuit breakers', () => {
  const ev = (seq, scopeType, scopeId, principalId, action, source = 'admin') => ({ seq, scopeType, scopeId, principalId, action, source, reason: `${action} ${scopeType}` });

  it('check 1 wins over every other failing check', () => {
    const r = run((o, c) => {
      Object.assign(o, { quantity: 'bad', mode: 'live' });
      c.brokerAccount = null; c.mandate = null; c.quote = null; c.activity.consecutiveLosses = 99;
      c.killSwitchEvents = [ev(1, 'global', null, null, 'engage')];
    });
    expect(r.failed).to.deep.include({ n: 1, code: 'KILL_SWITCH' });
    expect(r.trace.filter((t) => t.outcome === 'not_evaluated')).to.have.length(19);
  });

  it('broadest engaged scope is reported; narrower releases never override broader engages; latest event wins', () => {
    const order = { ...ORDER(), strategyId: 'stg_1' };
    const both = [ev(1, 'instrument', 'BTC-USDT', null, 'engage'), ev(2, 'global', null, null, 'engage')];
    expect(activeKillSwitchesFor(both, order).map((e) => e.scopeType)).to.deep.equal(['global', 'instrument']);
    const narrowRelease = [ev(1, 'principal', 'prn_alice', 'prn_alice', 'engage', 'user'), ev(2, 'mandate', 'mdt_1', 'prn_alice', 'release', 'user')];
    expect(activeKillSwitchesFor(narrowRelease, order).map((e) => e.scopeType)).to.deep.equal(['principal']);
    const cycle = [ev(1, 'mandate', 'mdt_1', 'prn_alice', 'engage', 'user'), ev(2, 'mandate', 'mdt_1', 'prn_alice', 'release', 'user'), ev(3, 'mandate', 'mdt_1', 'prn_alice', 'engage', 'user')];
    expect(activeKillSwitchesFor(cycle, order)).to.have.length(1);
    expect(activeKillSwitchesFor(cycle.slice(0, 2), order)).to.have.length(0);
    expect(activeKillSwitchesFor([...cycle].reverse(), order)).to.have.length(1); // order by seq, not array position
    for (const [scope, id] of [['broker_account', 'bka_1'], ['venue', 'binance'], ['strategy', 'stg_1']]) {
      expect(activeKillSwitchesFor([ev(1, scope, id, 'prn_alice', 'engage', 'user')], order), scope).to.have.length(1);
      expect(activeKillSwitchesFor([ev(1, scope, `${id}x`, 'prn_alice', 'engage', 'user')], order), `${scope} other`).to.have.length(0);
    }
  });

  it('new policies default to kill switch ON (halted until explicitly cleared)', () => {
    const { policy } = definePolicy({ currency: 'USDT', decimals: 2, maxOrderNotionalMinor: '1', maxDailyNotionalMinor: '1', maxDailyLossMinor: '1', allowedInstruments: [] });
    expect(policy.killSwitch).to.equal(true);
    expect(run((o, c) => { c.policy.killSwitch = policy.killSwitch; }).failed.code).to.equal('POLICY_KILL_SWITCH');
  });

  it('a tripped circuit breaker engages a mandate kill switch: the next order stops at check 1; only a human can release it', async () => {
    const store = new InMemoryRiskStore();
    let losses = 5;
    const engine = new RiskEngine({
      loadContext: async (o) => { const c = CTX(); c.activity.consecutiveLosses = losses; c.killSwitchEvents = await store.killSwitchEvents({ principalId: o.principalId }); return c; },
      store, idFactory: (() => { let i = 0; return (p) => `${p}_${++i}`; })(),
    });
    const d1 = await engine.decide(ORDER());
    expect([d1.decision, d1.failedCheck.n, d1.failedCheck.code, d1.trip.engaged]).to.deep.equal(['REJECT', 2, 'BREAKER_CONSECUTIVE_LOSSES', true]);
    expect(store.killSwitches[0]).to.deep.include({ scopeType: 'mandate', scopeId: 'mdt_1', principalId: 'prn_alice', action: 'engage', source: 'circuit_breaker' });
    losses = 0; // the condition clears, but the switch stays engaged
    const d2 = await engine.decide({ ...ORDER(), idempotencyKey: 'idem_00000002' });
    expect([d2.failedCheck.n, d2.failedCheck.code]).to.deep.equal([1, 'KILL_SWITCH']);
    const ks = new KillSwitchService({ store });
    const rel = (actor) => ks.release({ actor, scopeType: 'mandate', scopeId: 'mdt_1', principalId: 'prn_alice', reason: 'reviewed losses' });
    expect(await rel({ principalId: 'prn_bot', kind: 'agent' }).catch((e) => e.code)).to.equal('FORBIDDEN');
    expect(await rel({ principalId: 'prn_risk', kind: 'platform' }).catch((e) => e.code)).to.equal('FORBIDDEN');
    await rel({ principalId: 'prn_alice', kind: 'human', role: 'user' });
    expect((await engine.decide({ ...ORDER(), idempotencyKey: 'idem_00000003' })).decision).to.equal('APPROVE');
  });

  it('kill switch permissions: agents never; users own scopes; admins anything; admin-engaged needs an admin to release', async () => {
    const store = new InMemoryRiskStore();
    const ks = new KillSwitchService({ store });
    const alice = { principalId: 'prn_alice', kind: 'human', role: 'user' };
    const admin = { principalId: 'prn_ops', kind: 'human', role: 'admin' };
    const code = (p) => p.then(() => null, (e) => e.code);
    expect(await code(ks.engage({ actor: { principalId: 'prn_bot', kind: 'agent' }, scopeType: 'principal', scopeId: 'prn_alice', principalId: 'prn_alice', reason: 'x' }))).to.equal('FORBIDDEN');
    expect(await code(ks.engage({ actor: alice, scopeType: 'principal', scopeId: 'prn_bob', principalId: 'prn_bob', reason: 'x' }))).to.equal('FORBIDDEN');
    expect(await code(ks.engage({ actor: alice, scopeType: 'global', reason: 'x' }))).to.equal('FORBIDDEN');
    expect(await code(ks.engage({ actor: alice, scopeType: 'global', principalId: 'prn_alice', reason: 'x' }))).to.equal('INVALID');
    expect(await code(ks.engage({ actor: alice, scopeType: 'mandate', principalId: 'prn_alice', reason: 'x' }))).to.equal('INVALID');
    expect(await code(ks.engage({ actor: alice, scopeType: 'mandate', scopeId: 'mdt_1', principalId: 'prn_alice', reason: '' }))).to.equal('INVALID');
    await ks.engage({ actor: alice, scopeType: 'mandate', scopeId: 'mdt_1', principalId: 'prn_alice', reason: 'pause' });
    await ks.engage({ actor: admin, scopeType: 'global', reason: 'exchange incident' });
    await ks.engage({ actor: admin, scopeType: 'principal', scopeId: 'prn_alice', principalId: 'prn_alice', reason: 'compliance hold' });
    await ks.engage({ actor: { principalId: 'prn_risk', kind: 'platform' }, scopeType: 'venue', scopeId: 'binance', reason: 'venue degraded' });
    expect(await code(ks.release({ actor: alice, scopeType: 'principal', scopeId: 'prn_alice', principalId: 'prn_alice', reason: 'x' }))).to.equal('FORBIDDEN'); // admin-engaged
    expect(await code(ks.release({ actor: alice, scopeType: 'global', reason: 'x' }))).to.equal('FORBIDDEN');
    await ks.release({ actor: alice, scopeType: 'mandate', scopeId: 'mdt_1', principalId: 'prn_alice', reason: 'resume' });
    expect(await code(ks.release({ actor: alice, scopeType: 'mandate', scopeId: 'mdt_1', principalId: 'prn_alice', reason: 'again' }))).to.equal('CONFLICT');
    await ks.release({ actor: admin, scopeType: 'global', reason: 'resolved' });
    expect((await ks.engaged('prn_alice')).map((e) => e.scopeType).sort()).to.deep.equal(['principal', 'venue']);
  });
});

describe('risk: policy versioning and who may edit', () => {
  const DRAFT = (over = {}) => ({ currency: 'USDT', decimals: 2, maxOrderNotionalMinor: '100000', maxDailyNotionalMinor: '500000', maxDailyLossMinor: '20000', maxLeverage: '2', maxOpenPositions: 3, allowedInstruments: ['BTC-USDT'], killSwitch: false, ...over });
  const CAPS = { currency: 'USDT', maxOrderNotionalMinor: '200000', maxDailyNotionalMinor: '1000000', maxDailyLossMinor: '50000', maxLeverage: '3', maxOpenPositions: 5, maxOrdersPerMinute: 20, maxOrdersPerDay: 500, maxPositionNotionalMinor: '500000', allowShort: false };
  const mk = (caps = CAPS) => {
    let n = 0;
    const store = new InMemoryRiskStore();
    return { store, svc: new RiskPolicyService({ store, planCaps: async (p) => (p === 'prn_alice' ? caps : null), idFactory: (p) => `${p}_${++n}` }) };
  };
  const alice = { principalId: 'prn_alice', kind: 'human', role: 'user' };
  const admin = { principalId: 'prn_ops', kind: 'human', role: 'admin' };
  const code = (p) => p.then(() => null, (e) => e.code);

  it('users create immutable, hashed versions within their plan caps', async () => {
    const { store, svc } = mk();
    const v1 = await svc.createVersion({ actor: alice, principalId: 'prn_alice', draft: DRAFT() });
    const v2 = await svc.createVersion({ actor: alice, principalId: 'prn_alice', draft: DRAFT({ maxLeverage: '2.0' }) });
    expect([v1.version, v2.version]).to.deep.equal([1, 2]);
    expect(v2.policyHash).to.equal(v1.policyHash); // same content, canonical hash
    expect((await svc.activePolicy('prn_alice', 'mdt_x')).version).to.equal(2); // falls back to principal-level
    await svc.createVersion({ actor: alice, principalId: 'prn_alice', mandateId: 'mdt_x', draft: DRAFT({ maxOpenPositions: 1 }) });
    expect((await svc.activePolicy('prn_alice', 'mdt_x')).maxOpenPositions).to.equal(1);
    expect(store.policies).to.have.length(3);
    expect(typeof store.updatePolicy).to.equal('undefined');
  });

  it('agents never; users never for others or above plan caps; admins within hard caps only', async () => {
    const { svc } = mk();
    expect(await code(svc.createVersion({ actor: { principalId: 'prn_bot', kind: 'agent' }, principalId: 'prn_alice', draft: DRAFT() }))).to.equal('FORBIDDEN');
    expect(await code(svc.createVersion({ actor: { principalId: 'prn_bot', kind: 'agent', role: 'admin' }, principalId: 'prn_alice', draft: DRAFT() }))).to.equal('FORBIDDEN');
    expect(await code(svc.createVersion({ actor: { principalId: 'prn_bob', kind: 'human', role: 'user' }, principalId: 'prn_alice', draft: DRAFT() }))).to.equal('FORBIDDEN');
    for (const over of [{ maxOrderNotionalMinor: '200001' }, { maxLeverage: '3.5' }, { maxOpenPositions: 6 }, { currency: 'INR' }, { limits: { allowShort: true } }, { limits: { maxOrdersPerMinute: 21 } }]) {
      expect(await code(svc.createVersion({ actor: alice, principalId: 'prn_alice', draft: DRAFT(over) })), JSON.stringify(over)).to.equal('CAP_EXCEEDED');
    }
    expect((await svc.createVersion({ actor: admin, principalId: 'prn_alice', draft: DRAFT({ maxLeverage: '5', maxOpenPositions: 50 }) })).version).to.equal(1);
    expect(await code(svc.createVersion({ actor: admin, principalId: 'prn_alice', draft: DRAFT({ maxLeverage: '10.5' }) }))).to.equal('CAP_EXCEEDED');
    expect(await code(svc.createVersion({ actor: admin, principalId: 'prn_alice', draft: DRAFT({ limits: { maxOrdersPerMinute: HARD_CAPS.maxOrdersPerMinute + 1 } }) }))).to.equal('CAP_EXCEEDED');
    const noCaps = mk(null);
    expect(await code(noCaps.svc.createVersion({ actor: alice, principalId: 'prn_alice', draft: DRAFT() }))).to.equal('CAP_EXCEEDED'); // fail closed
    expect(await code(svc.createVersion({ actor: alice, principalId: 'prn_alice', draft: DRAFT({ maxLeverage: 2 }) }))).to.equal('INVALID');
  });
});

describe('risk: only deterministic code decides (static)', () => {
  it('risk/** imports no LLM, agent, provider, network or randomness', () => {
    for (const f of fs.readdirSync(RISK_DIR).filter((x) => x.endsWith('.mjs'))) {
      const src = fs.readFileSync(path.join(RISK_DIR, f), 'utf8').replace(/\/\/.*$/gm, '');
      const specs = [...src.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
      for (const s of specs) expect(s, `${f} → ${s}`).to.not.match(/agent\/|ai_gateway|providers|openai|anthropic|groq|^(node:http|node:https|node:net|node:child_process|node:fs|ioredis|redis)$/);
      expect(src, f).to.not.match(/Math\.random|process\.env|fetch\(/);
      if (['checks.mjs', 'evaluate.mjs', 'kill_switch.mjs'].includes(f)) expect(src, f).to.not.match(/Date\.now|new Date\(/);
    }
  });
});
