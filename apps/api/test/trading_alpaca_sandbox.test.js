import { expect } from 'chai';
import { AlpacaBrokerAdapter } from '../src/trading_agent/brokers/alpaca/index.mjs';
import { InstrumentRegistry, defineInstrument } from '../src/trading_agent/brokers/symbols.mjs';

// Stage 23 acceptance — Alpaca Broker API SANDBOX (https://broker-api.sandbox.alpaca.markets), opt-in.
// Places ONE far-from-market LIMIT order with a $0.01 notional commission on a sandbox customer
// account, reads it back by client_order_id (commission fields present), and cancels it.
//
// Skipped unless the founder supplies SANDBOX credentials in the local shell (never committed):
//   ALPACA_SANDBOX_API_KEY / ALPACA_SANDBOX_API_SECRET   correspondent sandbox key (broker-app.alpaca.markets, free signup)
//   ALPACA_SANDBOX_ACCOUNT_ID                            a funded sandbox customer account (UUID)
// The adapter itself never reads the environment and refuses production (LIVE_TRADING is locked).
const env = process.env;
const ready = env.ALPACA_SANDBOX_API_KEY && env.ALPACA_SANDBOX_API_SECRET && env.ALPACA_SANDBOX_ACCOUNT_ID;

describe('alpaca: sandbox LIMIT place + lookup + cancel with commission (opt-in)', function () {
  this.timeout(60_000);
  before(function () { if (!ready) this.skip(); });

  it('order carries commission + commission_type, is found by client_order_id, and is cancelled', async () => {
    const adapter = new AlpacaBrokerAdapter({
      credentialLoader: { load: async () => ({ apiKey: env.ALPACA_SANDBOX_API_KEY, apiSecret: env.ALPACA_SANDBOX_API_SECRET }) },
      instruments: new InstrumentRegistry([defineInstrument({ canonical: 'US:AAPL', venue: 'alpaca', venueSymbol: 'AAPL', quoteCurrency: 'USD', quoteDecimals: 2, tickSize: '0.01', lotSize: '1', minQuantity: '1', minNotional: '1' })]),
      fetch: globalThis.fetch, env: { TRADING_FLAG_ALPACA: 'true' }, accounts: { alpacaAccountIdFor: async () => env.ALPACA_SANDBOX_ACCOUNT_ID },
      commissionPolicy: { forOrder: async () => ({ amount: '0.01', type: 'notional' }) },
    });
    const clientOrderId = `sl${Date.now().toString(16)}sandbox`;
    const placed = await adapter.placeOrder('bka_sandbox_1', { clientOrderId, instrument: 'US:AAPL', side: 'buy', type: 'limit', timeInForce: 'day', quantity: '1', limitPrice: '1.00' });
    const found = await adapter.getOrder('bka_sandbox_1', { clientOrderId });
    expect(found.brokerOrderId).to.equal(placed.brokerOrderId);
    expect(found.commissionType).to.equal('notional');
    const cancelled = await adapter.cancelOrder('bka_sandbox_1', { clientOrderId });
    const account = await adapter.readAccount('bka_sandbox_1');
    console.log('[alpaca sandbox]', JSON.stringify({ clientOrderId, brokerOrderId: placed.brokerOrderId, statusAfterPlace: found.status, commission: found.commission, commissionType: found.commissionType, afterCancel: cancelled.status, accountStatus: account.status })); // eslint-disable-line no-console
    expect(['cancelled', 'pending_cancel']).to.include(cancelled.status);
  });
});
