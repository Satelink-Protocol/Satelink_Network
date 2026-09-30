import { expect } from 'chai';
import {
  // types
  BrokerOrderStatus as S, SubmitOutcome, Venue, TERMINAL_STATUSES,
  // decimal
  parseDecimal, formatDecimal, toMinor, fromMinor, divRound, Rounding, compareDecimal, addDecimal, mulDecimal, isMultipleOf, floorToStep,
  // errors
  BrokerError, BrokerErrorCode, ERROR_SEMANTICS, BINANCE_ERROR_CODES, mapVenueError,
  // status
  BINANCE_STATUS, ALPACA_STATUS, UPSTOX_STATUS, MOCK_STATUS, STATUS_TABLES, mapVenueStatus, refineByQuantity,
  // symbols / capabilities / orders / fills
  canonicalCrypto, canonicalEquity, assetClassOf, venueCryptoSymbol, InstrumentRegistry,
  defineCapabilities, ExecutionSafety, normalizeOrderRequest, assertNoSecrets, normalizeFill, aggregateFills,
} from '../src/trading_agent/brokers/index.mjs';

// Stage 10 — pure unit tests (no DB, no network).

describe('trading brokers: decimal', () => {
  it('parses and formats canonically', () => {
    expect(parseDecimal('0.00012345')).to.deep.equal({ units: 12345n, scale: 8 });
    expect(parseDecimal('-12.5')).to.deep.equal({ units: -125n, scale: 1 });
    expect(formatDecimal(1250n, 3)).to.equal('1.25');
    expect(formatDecimal(-5n, 3)).to.equal('-0.005');
    expect(formatDecimal(0n, 4)).to.equal('0');
  });
  it('rejects JS numbers and malformed strings', () => {
    expect(() => parseDecimal(0.1)).to.throw(TypeError, /JS numbers are not accepted/);
    for (const bad of ['1e5', '.5', '01', '1.', '+1', '', ' 1', 'NaN']) expect(() => parseDecimal(bad), bad).to.throw(RangeError);
  });
  it('rounds with every mode, including negative ties', () => {
    const cases = [
      // [n, d, mode, expected]
      [25n, 10n, Rounding.FLOOR, 2n], [25n, 10n, Rounding.CEIL, 3n], [25n, 10n, Rounding.HALF_UP, 3n], [25n, 10n, Rounding.HALF_EVEN, 2n],
      [35n, 10n, Rounding.HALF_EVEN, 4n], [24n, 10n, Rounding.HALF_UP, 2n], [26n, 10n, Rounding.HALF_EVEN, 3n],
      [-25n, 10n, Rounding.FLOOR, -3n], [-25n, 10n, Rounding.CEIL, -2n], [-25n, 10n, Rounding.HALF_UP, -3n], [-25n, 10n, Rounding.HALF_EVEN, -2n],
      [-24n, 10n, Rounding.HALF_UP, -2n], [-26n, 10n, Rounding.HALF_EVEN, -3n], [-35n, 10n, Rounding.HALF_EVEN, -4n],
      [20n, 10n, Rounding.EXACT, 2n],
    ];
    for (const [n, d, m, e] of cases) expect(divRound(n, d, m), `${n}/${d} ${m}`).to.equal(e);
    expect(() => divRound(21n, 10n, Rounding.EXACT)).to.throw(RangeError);
    expect(() => divRound(1n, 0n)).to.throw(RangeError);
  });
  it('converts to and from minor units', () => {
    expect(toMinor('12.34', 2)).to.equal(1234n);
    expect(toMinor('12.3', 6)).to.equal(12300000n);
    expect(() => toMinor('12.345', 2)).to.throw(RangeError); // EXACT by default
    expect(toMinor('12.345', 2, Rounding.HALF_EVEN)).to.equal(1234n);
    expect(toMinor('12.345', 2, Rounding.CEIL)).to.equal(1235n);
    expect(fromMinor(1234n, 2)).to.equal('12.34');
    expect(() => toMinor('1', 19)).to.throw(RangeError);
  });
  it('compares, adds, multiplies exactly', () => {
    expect(compareDecimal('0.1', '0.10')).to.equal(0);
    expect(compareDecimal('0.2', '0.1')).to.equal(1);
    expect(addDecimal('0.1', '0.2')).to.equal('0.3');
    expect(mulDecimal('0.00012345', '64123.45')).to.equal('7.9160399025');
  });
  it('checks and floors to lot/tick steps', () => {
    expect(isMultipleOf('0.003', '0.001')).to.equal(true);
    expect(isMultipleOf('0.0035', '0.001')).to.equal(false);
    expect(floorToStep('0.0039', '0.001')).to.equal('0.003');
    expect(() => isMultipleOf('1', '0')).to.throw(RangeError);
  });
});

describe('trading brokers: errors', () => {
  it('declares outcome and retry policy for every code; AMBIGUOUS → UNKNOWN', () => {
    const expected = {
      INVALID_REQUEST: ['not_placed', false], INSUFFICIENT_FUNDS: ['not_placed', false], INSTRUMENT_NOT_TRADABLE: ['not_placed', false],
      MARKET_CLOSED: ['not_placed', false], RATE_LIMITED: ['not_placed', true], AUTH_FAILED: ['not_placed', false],
      PERMISSION_DENIED: ['not_placed', false], DUPLICATE_CLIENT_ORDER_ID: ['not_placed', false], REJECTED: ['not_placed', false],
      ORDER_NOT_FOUND: ['not_placed', false], TIMEOUT_BEFORE_ACCEPT: ['not_placed', true], AMBIGUOUS: ['unknown', false],
      VENUE_UNAVAILABLE: ['not_placed', true], INTERNAL: ['not_placed', false],
    };
    expect(Object.keys(ERROR_SEMANTICS).sort()).to.deep.equal(Object.keys(expected).sort());
    expect(Object.keys(BrokerErrorCode).sort()).to.deep.equal(Object.keys(expected).sort());
    for (const [code, [outcome, retryable]] of Object.entries(expected)) {
      const e = new BrokerError(code);
      expect([e.outcome, e.retryable], code).to.deep.equal([outcome, retryable]);
    }
    expect(new BrokerError('AMBIGUOUS').outcome).to.equal(SubmitOutcome.UNKNOWN);
    expect(() => new BrokerError('NOPE')).to.throw(TypeError);
  });
  it('maps transport failures by whether the request was sent', () => {
    expect(mapVenueError(Venue.BINANCE, { sent: false }).code).to.equal('VENUE_UNAVAILABLE');
    expect(mapVenueError(Venue.BINANCE, { sent: true }).code).to.equal('AMBIGUOUS');
    expect(mapVenueError(Venue.BINANCE, { sent: true }).outcome).to.equal('unknown');
  });
  it('maps every Binance error-code table entry', () => {
    const expected = {
      '-1003': 'RATE_LIMITED', '-1007': 'AMBIGUOUS', '-1013': 'INVALID_REQUEST', '-1015': 'RATE_LIMITED', '-1021': 'INVALID_REQUEST',
      '-1022': 'AUTH_FAILED', '-1121': 'INSTRUMENT_NOT_TRADABLE', '-2013': 'ORDER_NOT_FOUND', '-2014': 'AUTH_FAILED', '-2015': 'AUTH_FAILED',
    };
    expect(BINANCE_ERROR_CODES).to.deep.equal(expected);
    for (const [code, want] of Object.entries(expected)) {
      expect(mapVenueError(Venue.BINANCE, { sent: true, httpStatus: 400, venueCode: Number(code) }).code, code).to.equal(want);
    }
  });
  it('maps Binance -2010/-2011 by message', () => {
    const m = (venueCode, message) => mapVenueError(Venue.BINANCE, { sent: true, httpStatus: 400, venueCode, message }).code;
    expect(m(-2010, 'Account has insufficient balance for requested action.')).to.equal('INSUFFICIENT_FUNDS');
    expect(m(-2010, 'Duplicate order sent.')).to.equal('DUPLICATE_CLIENT_ORDER_ID');
    expect(m(-2010, 'Order would trigger immediately.')).to.equal('REJECTED');
    expect(m(-2011, 'Unknown order sent.')).to.equal('ORDER_NOT_FOUND');
    expect(m(-2011, 'Order was not canceled')).to.equal('REJECTED');
  });
  it('maps generic HTTP statuses', () => {
    const m = (httpStatus, message = '', venue = Venue.ALPACA) => mapVenueError(venue, { sent: true, httpStatus, message }).code;
    expect(m(429)).to.equal('RATE_LIMITED');
    expect(m(418, '', Venue.BINANCE)).to.equal('RATE_LIMITED');
    expect(m(500)).to.equal('AMBIGUOUS');
    expect(m(503)).to.equal('AMBIGUOUS');
    expect(m(401)).to.equal('AUTH_FAILED');
    expect(m(403, 'insufficient buying power')).to.equal('INSUFFICIENT_FUNDS');
    expect(m(403, 'forbidden')).to.equal('PERMISSION_DENIED');
    expect(m(404)).to.equal('ORDER_NOT_FOUND');
    expect(m(409)).to.equal('DUPLICATE_CLIENT_ORDER_ID');
    expect(m(422, 'client_order_id must be unique')).to.equal('DUPLICATE_CLIENT_ORDER_ID');
    expect(m(400, 'market is closed')).to.equal('MARKET_CLOSED');
    expect(m(422, 'qty must be > 0')).to.equal('INVALID_REQUEST');
    expect(m(302)).to.equal('INTERNAL');
  });
});

describe('trading brokers: status mapping (100% of table entries)', () => {
  // Independent expected tables: a change to the source mapping must be made here too.
  const EXPECTED = {
    [Venue.BINANCE]: {
      new: S.ACKNOWLEDGED, pending_new: S.PENDING_NEW, partially_filled: S.PARTIALLY_FILLED, filled: S.FILLED, canceled: S.CANCELLED,
      pending_cancel: S.PENDING_CANCEL, rejected: S.REJECTED, expired: S.EXPIRED, expired_in_match: S.EXPIRED,
    },
    [Venue.ALPACA]: {
      new: S.ACKNOWLEDGED, accepted: S.PENDING_NEW, pending_new: S.PENDING_NEW, accepted_for_bidding: S.PENDING_NEW, held: S.PENDING_NEW,
      partially_filled: S.PARTIALLY_FILLED, filled: S.FILLED, done_for_day: S.ACKNOWLEDGED, canceled: S.CANCELLED, expired: S.EXPIRED,
      replaced: S.CANCELLED, pending_cancel: S.PENDING_CANCEL, pending_replace: S.ACKNOWLEDGED, stopped: S.ACKNOWLEDGED,
      rejected: S.REJECTED, suspended: S.ACKNOWLEDGED, calculated: S.ACKNOWLEDGED,
    },
    [Venue.UPSTOX]: {
      'put order req received': S.PENDING_NEW, 'validation pending': S.PENDING_NEW, 'open pending': S.PENDING_NEW,
      'after market order req received': S.PENDING_NEW, open: S.ACKNOWLEDGED, 'trigger pending': S.ACKNOWLEDGED,
      'modify pending': S.ACKNOWLEDGED, 'modify validation pending': S.ACKNOWLEDGED, 'modify after market order req received': S.ACKNOWLEDGED,
      modified: S.ACKNOWLEDGED, 'not modified': S.ACKNOWLEDGED, 'not cancelled': S.ACKNOWLEDGED, 'cancel pending': S.PENDING_CANCEL,
      complete: S.FILLED, rejected: S.REJECTED, cancelled: S.CANCELLED, 'cancelled after market order': S.CANCELLED,
    },
    [Venue.MOCK]: Object.fromEntries(Object.values(S).map((s) => [s, s])),
  };

  it('covers every venue that has a table', () => {
    expect(Object.keys(STATUS_TABLES).sort()).to.deep.equal(Object.keys(EXPECTED).sort());
    expect(BINANCE_STATUS).to.deep.equal(EXPECTED[Venue.BINANCE]);
    expect(ALPACA_STATUS).to.deep.equal(EXPECTED[Venue.ALPACA]);
    expect(UPSTOX_STATUS).to.deep.equal(EXPECTED[Venue.UPSTOX]);
    expect(MOCK_STATUS).to.deep.equal(EXPECTED[Venue.MOCK]);
  });

  for (const [venue, table] of Object.entries(EXPECTED)) {
    it(`${venue}: every raw status maps as expected (case/whitespace-insensitive)`, () => {
      for (const [raw, want] of Object.entries(table)) {
        expect(mapVenueStatus(venue, raw), `${venue}:${raw}`).to.equal(want);
        expect(mapVenueStatus(venue, `  ${raw.toUpperCase()} `), `${venue}:${raw} upper`).to.equal(want);
      }
    });
  }

  it('maps anything unmapped to UNKNOWN, never a guess', () => {
    for (const venue of Object.keys(EXPECTED)) expect(mapVenueStatus(venue, 'totally_new_status')).to.equal(S.UNKNOWN);
    expect(mapVenueStatus('nyse', 'filled')).to.equal(S.UNKNOWN);
    expect(mapVenueStatus(Venue.BINANCE, null)).to.equal(S.UNKNOWN);
    expect(mapVenueStatus(Venue.BINANCE, 'constructor')).to.equal(S.UNKNOWN); // no prototype leakage
  });

  it('every normalized status is reachable from some venue table', () => {
    const reached = new Set(Object.values(EXPECTED).flatMap((t) => Object.values(t)));
    for (const s of Object.values(S)) expect(reached.has(s), s).to.equal(true);
    expect([...TERMINAL_STATUSES].sort()).to.deep.equal([S.CANCELLED, S.EXPIRED, S.FILLED, S.REJECTED].sort());
  });

  it('refines an open order with a partial fill to PARTIALLY_FILLED', () => {
    const upOpen = mapVenueStatus(Venue.UPSTOX, 'open');
    expect(refineByQuantity(upOpen, { filledQuantity: '3', quantity: '10' }, compareDecimal)).to.equal(S.PARTIALLY_FILLED);
    expect(refineByQuantity(upOpen, { filledQuantity: '0', quantity: '10' }, compareDecimal)).to.equal(S.ACKNOWLEDGED);
    expect(refineByQuantity(upOpen, { filledQuantity: '10', quantity: '10' }, compareDecimal)).to.equal(S.ACKNOWLEDGED);
    expect(refineByQuantity(S.FILLED, { filledQuantity: '3', quantity: '10' }, compareDecimal)).to.equal(S.FILLED);
    expect(refineByQuantity(upOpen, {}, compareDecimal)).to.equal(S.ACKNOWLEDGED);
  });
});

describe('trading brokers: symbols, capabilities, order normalization, fills', () => {
  const reg = new InstrumentRegistry([
    { canonical: 'BTC-USDT', venue: Venue.MOCK, venueSymbol: 'BTC-USDT', quoteCurrency: 'USDT', quoteDecimals: 6, tickSize: '0.01', lotSize: '0.00001', minQuantity: '0.00001', minNotional: '5' },
    { canonical: 'NSE:RELIANCE', venue: Venue.MOCK, venueSymbol: 'NSE_EQ|INE002A01018', quoteCurrency: 'INR', quoteDecimals: 2, tickSize: '0.05', lotSize: '1', minQuantity: '1', minNotional: '1' },
  ]);
  const caps = defineCapabilities({
    venue: Venue.MOCK, assetClasses: ['crypto_spot', 'equity'], orderTypes: ['market', 'limit'], timeInForce: ['gtc', 'ioc'],
    supportsClientOrderId: true, clientOrderIdMaxLength: 36, supportsQueryByClientOrderId: true, supportsPartialFills: true,
    supportsCancel: true, supportsPaper: true, requiresStaticIp: false, executionSafety: ExecutionSafety.IDEMPOTENT, extensions: { postOnly: 'x' },
  });
  const btc = reg.byCanonical(Venue.MOCK, 'BTC-USDT');
  const base = { clientOrderId: 'coid-0001', instrument: 'BTC-USDT', side: 'buy', type: 'limit', timeInForce: 'gtc', quantity: '0.001', limitPrice: '64123.45' };

  it('builds and classifies canonical ids and venue symbols', () => {
    expect(canonicalCrypto('btc', 'usdt')).to.equal('BTC-USDT');
    expect(canonicalEquity('nse', 'reliance')).to.equal('NSE:RELIANCE');
    expect(assetClassOf('BTC-USDT')).to.equal('crypto_spot');
    expect(assetClassOf('NSE:RELIANCE')).to.equal('equity');
    expect(venueCryptoSymbol(Venue.BINANCE, 'btc', 'usdt')).to.equal('BTCUSDT');
    expect(venueCryptoSymbol(Venue.ALPACA, 'btc', 'usd')).to.equal('BTC/USD');
    expect(() => venueCryptoSymbol(Venue.UPSTOX, 'btc', 'usd')).to.throw(RangeError);
    expect(reg.byVenueSymbol(Venue.MOCK, 'NSE_EQ|INE002A01018').canonical).to.equal('NSE:RELIANCE');
    expect(reg.byCanonical(Venue.BINANCE, 'BTC-USDT')).to.equal(null);
    expect(() => reg.register({ ...btc })).to.throw(/duplicate/);
  });

  it('validates capability descriptors', () => {
    expect(Object.isFrozen(caps) && Object.isFrozen(caps.extensions)).to.equal(true);
    expect(() => defineCapabilities({ ...caps, executionSafety: 'SOMETIMES' })).to.throw(/executionSafety/);
    expect(() => defineCapabilities({ ...caps, supportsClientOrderId: false })).to.throw(/IDEMPOTENT requires/);
    expect(() => defineCapabilities({ ...caps, orderTypes: ['iceberg'] })).to.throw(/unknown value/);
  });

  it('normalizes a valid limit order with notional in minor units rounded up', () => {
    const o = normalizeOrderRequest(base, { instrument: btc, capabilities: caps });
    expect(o.notionalMinor).to.equal(64123450n); // 0.001 * 64123.45 = 64.12345 USDT → 64123450 (6 dp)
    expect(o.venueSymbol).to.equal('BTC-USDT');
    expect(Object.isFrozen(o)).to.equal(true);
  });

  it('rejects invalid orders with INVALID_REQUEST', () => {
    const bad = (patch, re) => {
      try { normalizeOrderRequest({ ...base, ...patch }, { instrument: btc, capabilities: caps }); expect.fail('should throw'); }
      catch (e) { expect(e).to.be.instanceOf(BrokerError); expect(e.code).to.equal('INVALID_REQUEST'); if (re) expect(e.message).to.match(re); }
    };
    bad({ quantity: 0.001 }, /decimal string/);
    bad({ quantity: '0.000015' }, /lot size/);
    bad({ quantity: '0.00001', limitPrice: '10.00' }, /notional/);
    bad({ limitPrice: '64123.455' }, /tick/);
    bad({ type: 'market' }, /limitPrice not allowed/);
    bad({ type: 'stop', limitPrice: null, stopPrice: '64000.00' }, /order type stop not supported/);
    bad({ type: 'stop', limitPrice: null }, /stopPrice must be a decimal string/);
    bad({ side: 'short' }, /side/);
    bad({ clientOrderId: 'x' }, /clientOrderId/);
    bad({ clientOrderId: 'c'.repeat(40) }, /longer than 36/);
    bad({ instrument: 'ETH-USDT' }, /does not match/);
    bad({ extensions: { iceberg: true } }, /extension iceberg not declared/);
    bad({ foo: 1 }, /unknown field/);
    bad({ timeInForce: 'fok' }, /not supported/);
  });

  it('refuses secrets anywhere in a request', () => {
    for (const k of ['apiKey', 'api_secret', 'password', 'token', 'signature', 'privateKey', 'credentials']) {
      expect(() => assertNoSecrets({ extensions: { nested: { [k]: 'x' } } }), k).to.throw(BrokerError, /secrets must not be passed/);
    }
    expect(() => normalizeOrderRequest({ ...base, extensions: { apiKey: 'x' } }, { instrument: btc, capabilities: caps })).to.throw(/secrets must not be passed/);
    expect(() => assertNoSecrets({ clientOrderId: 'coid-0001', extensions: { postOnly: true } })).to.not.throw();
  });

  it('normalizes fills and aggregates exactly, deduping redelivered fills', () => {
    const f1 = normalizeFill({ fillId: 'a', clientOrderId: 'coid-0001', quantity: '0.0004', price: '64000.00', fee: { amount: '0.0256', currency: 'USDT', decimals: 6 }, executedAt: '2026-01-01T00:00:00Z' });
    const f2 = normalizeFill({ fillId: 'b', clientOrderId: 'coid-0001', quantity: '0.0006', price: '64100.00', fee: { amount: '0.03846', currency: 'USDT', decimals: 6 }, executedAt: '2026-01-01T00:00:01Z' });
    expect(f1.feeMinor).to.equal(25600n);
    const agg = aggregateFills([f1, f2, f1], { priceDecimals: 2 });
    expect(agg).to.deep.include({ fillCount: 2, filledQuantity: '0.001', notional: '64.06', averagePrice: '64060' });
    expect(agg.fees.USDT).to.deep.equal({ minor: 64060n, decimals: 6 });
    expect(() => normalizeFill({ fillId: 'c', clientOrderId: 'x', quantity: '1', price: '1', fee: { amount: '0.0000001', currency: 'USDT', decimals: 6 }, executedAt: '2026-01-01T00:00:00Z' })).to.throw(RangeError);
    expect(() => normalizeFill({ fillId: 'd', clientOrderId: 'x', quantity: '0', price: '1', executedAt: '2026-01-01T00:00:00Z' })).to.throw(RangeError);
    expect(aggregateFills([], { priceDecimals: 2 }).averagePrice).to.equal(null);
  });
});
