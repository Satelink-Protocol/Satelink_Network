// MockBroker — deterministic in-memory venue for tests (Stage 10).
//
// No network, no randomness, no wall clock: ids come from counters and time
// from an injected clock. A scenario is chosen per clientOrderId (or a default)
// and consumed on first use, so a retry after TIMEOUT_BEFORE_ACCEPT behaves
// like a fresh submit.
//
// Scenarios:
//   ack                    placed, working, no fills
//   partial                placed, filled to half the quantity (rounded down to the lot size)
//   fill                   placed and fully filled
//   reject                 venue rejects synchronously (REJECTED, not on the book)
//   timeout_after_accept   order IS on the book, but the call throws AMBIGUOUS (outcome UNKNOWN)
//   timeout_before_accept  order NOT on the book; call throws TIMEOUT_BEFORE_ACCEPT (safe to retry)
// Any submit reusing a clientOrderId already on the book throws DUPLICATE_CLIENT_ORDER_ID.
import { BrokerAdapter } from './adapter.mjs';
import { defineCapabilities, ExecutionSafety } from './capabilities.mjs';
import { BrokerError, BrokerErrorCode } from './errors.mjs';
import { AssetClass, BrokerOrderStatus as S, OrderType, SubmitOutcome, TERMINAL_STATUSES, TimeInForce, Venue } from './types.mjs';
import { addDecimal, compareDecimal, floorToStep, formatDecimal, mulDecimal, parseDecimal, toMinor, fromMinor, Rounding } from './decimal.mjs';
import { normalizeFill, aggregateFills } from './fills.mjs';

export const MockScenario = Object.freeze({
  ACK: 'ack',
  PARTIAL: 'partial',
  FILL: 'fill',
  REJECT: 'reject',
  TIMEOUT_AFTER_ACCEPT: 'timeout_after_accept',
  TIMEOUT_BEFORE_ACCEPT: 'timeout_before_accept',
});

export const MOCK_CAPABILITIES = defineCapabilities({
  venue: Venue.MOCK,
  assetClasses: [AssetClass.CRYPTO_SPOT, AssetClass.EQUITY],
  orderTypes: [OrderType.MARKET, OrderType.LIMIT, OrderType.STOP, OrderType.STOP_LIMIT],
  timeInForce: [TimeInForce.GTC, TimeInForce.IOC, TimeInForce.FOK, TimeInForce.DAY],
  supportsClientOrderId: true,
  clientOrderIdMaxLength: 64,
  supportsQueryByClientOrderId: true,
  supportsPartialFills: true,
  supportsCancel: true,
  supportsPaper: true,
  requiresStaticIp: false,
  executionSafety: ExecutionSafety.IDEMPOTENT,
  extensions: { mockTag: 'free-form label echoed back in results (demonstrates extension preservation)' },
});

export class MockBroker extends BrokerAdapter {
  #book = new Map();          // clientOrderId → order state
  #scenarios;
  #defaultScenario;
  #clock;
  #feeBps;
  #marketPrices;
  #orderSeq = 0;
  #fillSeq = 0;
  credentialLoads = 0;        // observable in tests; the handle itself is never stored or exposed

  /**
   * @param {object} opts
   * @param {object} opts.credentialLoader
   * @param {import('./symbols.mjs').InstrumentRegistry} opts.instruments
   * @param {Record<string,string>} [opts.scenarios]  clientOrderId → MockScenario
   * @param {string} [opts.defaultScenario]
   * @param {() => Date} [opts.clock]                  deterministic clock
   * @param {bigint} [opts.feeBps]                      fee in basis points of notional
   * @param {Record<string,string>} [opts.marketPrices] canonical → decimal price for market/stop orders
   */
  constructor({ credentialLoader, instruments, scenarios = {}, defaultScenario = MockScenario.ACK, clock = () => new Date('2026-01-01T00:00:00.000Z'), feeBps = 10n, marketPrices = {} } = {}) {
    super({ credentialLoader, instruments });
    if (!Object.values(MockScenario).includes(defaultScenario)) throw new TypeError(`unknown scenario ${defaultScenario}`);
    for (const s of Object.values(scenarios)) if (!Object.values(MockScenario).includes(s)) throw new TypeError(`unknown scenario ${s}`);
    this.#scenarios = new Map(Object.entries(scenarios));
    this.#defaultScenario = defaultScenario;
    this.#clock = clock;
    this.#feeBps = BigInt(feeBps);
    this.#marketPrices = marketPrices;
  }

  capabilities() { return MOCK_CAPABILITIES; }

  #takeScenario(clientOrderId) {
    const s = this.#scenarios.get(clientOrderId) ?? this.#defaultScenario;
    this.#scenarios.delete(clientOrderId); // consumed once: a retry runs the default path
    return s;
  }

  async _placeOrder(brokerAccountId, order, instrument) {
    await this._credentials(brokerAccountId);
    this.credentialLoads += 1;

    if (this.#book.has(order.clientOrderId)) {
      throw new BrokerError(BrokerErrorCode.DUPLICATE_CLIENT_ORDER_ID, { venue: Venue.MOCK, message: `duplicate clientOrderId ${order.clientOrderId}` });
    }
    const scenario = this.#takeScenario(order.clientOrderId);
    if (scenario === MockScenario.TIMEOUT_BEFORE_ACCEPT) {
      throw new BrokerError(BrokerErrorCode.TIMEOUT_BEFORE_ACCEPT, { venue: Venue.MOCK, message: 'timed out before the venue accepted the order' });
    }
    if (scenario === MockScenario.REJECT) {
      throw new BrokerError(BrokerErrorCode.REJECTED, { venue: Venue.MOCK, venueCode: 'MOCK_REJECT', message: 'rejected by mock venue' });
    }

    this.#orderSeq += 1;
    const state = {
      brokerAccountId,
      clientOrderId: order.clientOrderId,
      brokerOrderId: `mock-ord-${String(this.#orderSeq).padStart(6, '0')}`,
      order,
      instrument,
      status: S.ACKNOWLEDGED,
      fills: [],
      createdAt: this.#clock().toISOString(),
    };
    this.#book.set(order.clientOrderId, state);

    if (scenario === MockScenario.FILL) this.#fill(state, order.quantity);
    if (scenario === MockScenario.PARTIAL) {
      const half = floorToStep(halve(order.quantity), instrument.lotSize);
      if (compareDecimal(half, '0') > 0) this.#fill(state, half);
    }
    if (scenario === MockScenario.TIMEOUT_AFTER_ACCEPT) {
      throw new BrokerError(BrokerErrorCode.AMBIGUOUS, { venue: Venue.MOCK, message: 'connection lost after the order was sent' });
    }
    return this.#result(state);
  }

  async _cancelOrder(brokerAccountId, ref) {
    const state = this.#find(brokerAccountId, ref);
    if (TERMINAL_STATUSES.has(state.status)) {
      throw new BrokerError(BrokerErrorCode.REJECTED, { venue: Venue.MOCK, message: `cannot cancel an order in status ${state.status}` });
    }
    state.status = S.CANCELLED;
    return this.#snapshot(state);
  }

  async _getOrder(brokerAccountId, ref) { return this.#snapshot(this.#find(brokerAccountId, ref)); }

  async _listFills(brokerAccountId, ref) { return [...this.#find(brokerAccountId, ref).fills]; }

  /** Test helper: deliver another fill to a working order (deterministic ids/time). */
  simulateFill(clientOrderId, quantity) {
    const state = this.#book.get(clientOrderId);
    if (!state) throw new BrokerError(BrokerErrorCode.ORDER_NOT_FOUND, { venue: Venue.MOCK });
    if (TERMINAL_STATUSES.has(state.status)) throw new BrokerError(BrokerErrorCode.REJECTED, { venue: Venue.MOCK, message: 'order is terminal' });
    this.#fill(state, quantity);
    return this.#snapshot(state);
  }

  #fill(state, quantity) {
    const { order, instrument } = state;
    const price = order.limitPrice ?? this.#marketPrices[order.instrument];
    if (!price) throw new BrokerError(BrokerErrorCode.INTERNAL, { venue: Venue.MOCK, message: `no mock price for ${order.instrument}` });
    const filledSoFar = state.fills.reduce((acc, f) => addDecimal(acc, f.quantity), '0');
    const remaining = addDecimal(order.quantity, negate(filledSoFar));
    if (compareDecimal(quantity, remaining) > 0) throw new BrokerError(BrokerErrorCode.INVALID_REQUEST, { venue: Venue.MOCK, message: 'overfill' });
    const notionalMinor = toMinor(mulDecimal(quantity, price), instrument.quoteDecimals, Rounding.HALF_EVEN);
    const feeMinor = (notionalMinor * this.#feeBps + 5000n) / 10000n; // HALF_UP on non-negative values
    this.#fillSeq += 1;
    state.fills.push(normalizeFill({
      fillId: `mock-fill-${String(this.#fillSeq).padStart(6, '0')}`,
      clientOrderId: state.clientOrderId,
      brokerOrderId: state.brokerOrderId,
      quantity,
      price,
      fee: { amount: fromMinor(feeMinor, instrument.quoteDecimals), currency: instrument.quoteCurrency, decimals: instrument.quoteDecimals },
      executedAt: this.#clock().toISOString(),
    }));
    const total = addDecimal(filledSoFar, quantity);
    state.status = compareDecimal(total, order.quantity) === 0 ? S.FILLED : S.PARTIALLY_FILLED;
  }

  #find(brokerAccountId, ref) {
    let state = ref.clientOrderId ? this.#book.get(ref.clientOrderId) : null;
    if (!state && ref.brokerOrderId) state = [...this.#book.values()].find((s) => s.brokerOrderId === ref.brokerOrderId) ?? null;
    if (!state || state.brokerAccountId !== brokerAccountId) {
      throw new BrokerError(BrokerErrorCode.ORDER_NOT_FOUND, { venue: Venue.MOCK, message: 'order not found' });
    }
    return state;
  }

  #result(state) {
    return {
      outcome: SubmitOutcome.PLACED,
      status: state.status,
      clientOrderId: state.clientOrderId,
      brokerOrderId: state.brokerOrderId,
      extensions: state.order.extensions.mockTag ? { mockTag: state.order.extensions.mockTag } : undefined,
    };
  }

  #snapshot(state) {
    const agg = aggregateFills(state.fills, { priceDecimals: decimalsOf(state.instrument.tickSize) });
    return Object.freeze({
      clientOrderId: state.clientOrderId,
      brokerOrderId: state.brokerOrderId,
      instrument: state.order.instrument,
      status: state.status,
      quantity: state.order.quantity,
      filledQuantity: agg.filledQuantity,
      averagePrice: agg.averagePrice,
      fees: agg.fees,
      createdAt: state.createdAt,
    });
  }
}

function halve(d) {
  const { units, scale } = parseDecimal(d);
  return formatDecimal(units * 5n, scale + 1); // d/2 = (units*5) / 10^(scale+1), exact
}
function negate(d) { return d.startsWith('-') ? d.slice(1) : d === '0' ? '0' : `-${d}`; }
function decimalsOf(step) { return parseDecimal(step).scale; }
