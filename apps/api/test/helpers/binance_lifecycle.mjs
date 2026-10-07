// Stage 21 acceptance scenario, shared by the unit suite (fake venue) and the opt-in Spot Testnet
// test (real venue): one LIMIT order far from the market → OMS accept → dispatch (ACK) →
// CANCEL_REQUESTED → reconciler cancels at the venue → CANCELLED, all under one W3C trace, then
// assembled into a Stage 19 trade receipt (the audit trace). Credentials are passed in; nothing
// here reads the environment.
import { BinanceSpotAdapter, BinanceRestClient, instrumentsFromExchangeInfo } from '../../src/trading_agent/brokers/binance/index.mjs';
import { InstrumentRegistry } from '../../src/trading_agent/brokers/symbols.mjs';
import { floorToStep, mulDecimal, compareDecimal } from '../../src/trading_agent/brokers/decimal.mjs';
import { OrderAcceptanceService, OrderDispatcher, OrderReconciler, InMemoryOmsStore, OmsState as S, stateOf } from '../../src/trading_agent/oms/index.mjs';
import { newTrace, runWithTrace, TradeReceiptAssembler } from '../../src/trading_agent/audit/index.mjs';

const TERMS_HASH = `sha256:${'b'.repeat(64)}`;
export const BINANCE_ON = Object.freeze({ TRADING_FLAG_BINANCE: 'true' });

export async function runLimitLifecycle({ fetch, credential, linkId, environment = 'testnet', symbol = 'BTCUSDT', clock = () => new Date(), sentGraceMs = 0, timeoutMs = 10_000 }) {
  const baseUrl = environment === 'testnet' ? 'https://testnet.binance.vision' : null;
  const pub = new BinanceRestClient({ baseUrl, fetch, clock, timeoutMs });
  const [spec] = instrumentsFromExchangeInfo(await pub.request('GET', '/api/v3/exchangeInfo', { symbol }), { symbols: [symbol] });
  const { price: last } = await pub.request('GET', '/api/v3/ticker/price', { symbol });
  // 0.6 × last: never marketable, and inside testnet's PERCENT_PRICE_BY_SIDE (bidMultiplierDown 0.5 of the
  // 5-minute average, checked 2026-10-05); quantity ≈ 2× the minimum notional
  const limitPrice = floorToStep(String((Number(last) * 0.6).toFixed(8)), spec.tickSize);
  let quantity = floorToStep(String(((Number(spec.minNotional) * 2) / Number(limitPrice)).toFixed(8)), spec.lotSize);
  while (compareDecimal(mulDecimal(quantity, limitPrice), spec.minNotional) < 0 || compareDecimal(quantity, spec.minQuantity) < 0) quantity = floorToStep(String((Number(quantity) * 1.5).toFixed(8)), spec.lotSize);

  const adapter = new BinanceSpotAdapter({ credentialLoader: { load: async () => credential }, instruments: new InstrumentRegistry([spec]), environment, linkId, fetch, clock, env: BINANCE_ON, timeoutMs });
  const store = new InMemoryOmsStore();
  const adapters = { forVenue: () => adapter };
  const mandate = { id: 'mdt_testnet', principalId: 'prn_founder', brokerAccountId: 'bka_testnet', currency: spec.quoteCurrency, decimals: 2, termsHash: TERMS_HASH, status: 'active', approvedBy: 'prn_founder', mode: 'paper' };
  const mandates = { async verifyForOrder() { return mandate; } };
  const decision = { decisionId: 'rdc_testnet_1', decision: 'APPROVE', recorded: true, failedCheck: null, checksVersion: 'risk-checks/1.1', engineVersion: 'test', trace: [] };
  const risk = { async decide() { return decision; } };
  let n = 0;
  const acceptance = new OrderAcceptanceService({ store, mandates, risk, venues: { capabilities: () => adapter.capabilities() }, idFactory: (p) => `${p}_${Date.now().toString(36)}_${++n}`, clock });
  const dispatcher = new OrderDispatcher({ store, adapters, mandates, clock, leaseMs: 30_000, submitTimeoutMs: timeoutMs + 1_000, notFoundGraceMs: 120_000 });
  const reconciler = new OrderReconciler({ store, adapters, clock, sentGraceMs, timeoutMs: timeoutMs + 1_000 });

  const trace = newTrace();
  const states = [];
  const out = await runWithTrace(trace, async () => {
    const a = await acceptance.accept({ idempotencyKey: `idem_${Date.now().toString(36)}`, principalId: 'prn_founder', brokerAccountId: 'bka_testnet', mandateId: mandate.id, origin: 'manual', approvedBy: 'prn_founder',
      mode: 'paper', venue: 'binance', instrument: spec.canonical, side: 'buy', type: 'limit', timeInForce: 'gtc', quantity, limitPrice });
    if (!a.accepted) throw new Error(`order not accepted: ${a.reason}`);
    const snap = async () => { const o = await store.getOrder(a.orderId); states.push(stateOf(o.status)); return o; };
    await snap();
    await dispatcher.runOnce();
    const acked = await snap();
    const atVenue = await adapter.getOrder('bka_testnet', { clientOrderId: a.clientOrderId });
    await store.updateOrder(a.orderId, acked.status, { status: 'cancel_requested' }); // what a Stage 16 revocation / user cancel writes
    await snap();
    const rec = await reconciler.runOnce();
    const final = await snap();
    const afterCancel = await adapter.getOrder('bka_testnet', { clientOrderId: a.clientOrderId });
    return { a, acked, atVenue, rec, final, afterCancel };
  });

  // Stage 19 receipt over the in-memory OMS rows. In Postgres the trace id / span are stamped by
  // the 029 BEFORE INSERT triggers; here the lifecycle ran inside one trace and we stamp it the same way.
  const span = trace.spanId;
  const source = {
    order: async (id) => { const o = await store.getOrder(id); return o && { ...o, traceId: trace.traceId, spanId: span }; },
    orderEvents: async (id) => store.state.events.filter((e) => e.orderId === id).map((e) => ({ ...e, createdAt: e.at, traceId: trace.traceId, spanId: span })),
    fills: async () => [],
    riskDecision: async () => decision,
    mandate: async () => ({ ...mandate, signedAt: clock().getTime() }),
    agentRuns: async () => [], toolCalls: async () => [], signals: async () => [], auditByTrace: async () => [],
  };
  const receipt = await new TradeReceiptAssembler({ source, clock }).explainOrder({ principalId: 'prn_founder', orderId: out.a.orderId });
  return {
    ...out, states, spec, limitPrice, quantity, receipt,
    venueClientOrderId: `${adapter.clientIdPrefix}${out.a.clientOrderId}`,
    lifecycleOk: out.acked && stateOf(out.acked.status) === S.ACK && stateOf(out.final.status) === S.CANCELLED && out.afterCancel.status === 'cancelled',
  };
}
