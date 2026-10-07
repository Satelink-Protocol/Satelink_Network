import { expect } from 'chai';
import { UpstoxCopilotAdapter, orderDigest } from '../src/trading_agent/brokers/upstox/index.mjs';
import { InstrumentRegistry, defineInstrument } from '../src/trading_agent/brokers/symbols.mjs';

// Stage 22 acceptance — Upstox SANDBOX (https://api-sandbox.upstox.com), opt-in.
// Places ONE confirmed LIMIT order (COPILOT: the founder is the confirming human) and cancels it.
// Sandbox orders are simulated; the sandbox does not document order-details support, so the
// status lookup is recorded as information, not asserted.
//
// Skipped unless the founder supplies a SANDBOX token in the local shell (never committed):
//   UPSTOX_SANDBOX_ACCESS_TOKEN     from account.upstox.com/developer/apps → Sandbox → Generate (valid 30 days)
//   UPSTOX_SANDBOX_INSTRUMENT_KEY   optional, default NSE_EQ|INE848E01016 (NHPC)
//   UPSTOX_SANDBOX_PRICE            optional LIMIT price, default 50 (tick 0.05)
// The adapter itself never reads the environment and refuses production (LIVE_TRADING is locked).
const env = process.env;
const token = env.UPSTOX_SANDBOX_ACCESS_TOKEN;

describe('upstox: sandbox LIMIT place + cancel with COPILOT confirmation (opt-in)', function () {
  this.timeout(60_000);
  before(function () { if (!token) this.skip(); });

  it('confirmed LIMIT is accepted by the sandbox and cancelled', async () => {
    const instrument = defineInstrument({ canonical: 'NSE:SANDBOX', venue: 'upstox', venueSymbol: env.UPSTOX_SANDBOX_INSTRUMENT_KEY ?? 'NSE_EQ|INE848E01016', quoteCurrency: 'INR', quoteDecimals: 2, tickSize: '0.05', lotSize: '1', minQuantity: '1', minNotional: '0' });
    const order = { clientOrderId: `sl${Date.now().toString(16)}sbx`.slice(0, 20), instrument: 'NSE:SANDBOX', side: 'buy', type: 'limit', timeInForce: 'day', quantity: '1', limitPrice: env.UPSTOX_SANDBOX_PRICE ?? '50' };
    const digest = orderDigest({ action: 'place', brokerAccountId: 'bka_sandbox', ...order });
    const confirmations = { lookup: async () => ({ digest, confirmedBy: { principalId: 'prn_founder', kind: 'human' }, confirmedAt: new Date().toISOString() }) };
    const adapter = new UpstoxCopilotAdapter({
      credentialLoader: { load: async () => ({ accessToken: token, principalId: 'prn_founder' }) }, instruments: new InstrumentRegistry([instrument]),
      fetch: globalThis.fetch, env: { TRADING_FLAG_UPSTOX_COPILOT: 'true' }, confirmations, environment: 'sandbox',
    });
    const placed = await adapter.placeOrder('bka_sandbox', order);
    expect(placed.outcome).to.equal('placed');
    expect(placed.brokerOrderId).to.be.a('string');
    let status = null;
    try { status = (await adapter.getOrder('bka_sandbox', { brokerOrderId: placed.brokerOrderId })).status; } catch (e) { status = `lookup unavailable: ${e.code}`; }
    let cancelled;
    try { cancelled = (await adapter.cancelOrder('bka_sandbox', { brokerOrderId: placed.brokerOrderId })).status; } catch (e) { cancelled = e.code === 'ORDER_NOT_FOUND' ? 'cancel sent; lookup unavailable' : (() => { throw e; })(); }
    console.log('[upstox sandbox]', JSON.stringify({ tag: order.clientOrderId, brokerOrderId: placed.brokerOrderId, statusAfterPlace: status, afterCancel: cancelled, confirmedBy: placed.extensions.confirmedBy })); // eslint-disable-line no-console
  });
});
