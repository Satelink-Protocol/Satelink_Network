import { expect } from 'chai';
import fs from 'node:fs';
import { runLimitLifecycle } from './helpers/binance_lifecycle.mjs';

// Stage 21 acceptance — Binance SPOT TESTNET (https://testnet.binance.vision), opt-in.
// Places ONE LIMIT BUY at 0.6 × the market price (never marketable), then cancels it through the
// OMS (CANCEL_REQUESTED → reconciler), and assembles the Stage 19 receipt for the audit trace.
//
// Skipped unless the founder supplies TESTNET keys in the local shell (never committed):
//   BINANCE_TESTNET_API_KEY            + one of
//   BINANCE_TESTNET_API_SECRET         (HMAC key)  or
//   BINANCE_TESTNET_ED25519_KEY_PATH   (path to a PKCS#8 PEM Ed25519 private key)
//   BINANCE_LINK_ID                    optional (default SLTEST01; any prefix works on testnet)
//   BINANCE_TESTNET_TRACE_OUT          optional path to write the redacted receipt JSON
// The adapter itself never reads the environment and refuses production (LIVE_TRADING is locked).
const env = process.env;
const apiKey = env.BINANCE_TESTNET_API_KEY;
const credential = !apiKey ? null
  : env.BINANCE_TESTNET_ED25519_KEY_PATH ? { apiKey, keyType: 'ed25519', privateKeyPem: fs.readFileSync(env.BINANCE_TESTNET_ED25519_KEY_PATH, 'utf8') }
    : env.BINANCE_TESTNET_API_SECRET ? { apiKey, keyType: 'hmac', secret: env.BINANCE_TESTNET_API_SECRET } : null;

describe('binance: Spot Testnet LIMIT place + cancel (opt-in)', function () {
  this.timeout(60_000);
  before(function () { if (!credential) this.skip(); });

  it('LIMIT → ACK → CANCEL_REQUESTED → CANCELLED on testnet.binance.vision, recorded in the audit trace', async () => {
    const r = await runLimitLifecycle({ fetch: globalThis.fetch, credential, linkId: env.BINANCE_LINK_ID ?? 'SLTEST01', environment: 'testnet' });
    expect(r.lifecycleOk, JSON.stringify(r.states)).to.equal(true);
    expect(r.atVenue.status).to.equal('acknowledged');
    expect(r.afterCancel.status).to.equal('cancelled');
    expect(r.receipt.completeness.complete).to.equal(true);
    const summary = { venueClientOrderId: r.venueClientOrderId, brokerOrderId: r.receipt.what.brokerOrderId, states: r.states, limitPrice: r.limitPrice, quantity: r.quantity, traceparent: r.receipt.traceparent, receiptHash: r.receipt.receiptHash };
    console.log('[binance testnet]', JSON.stringify(summary)); // eslint-disable-line no-console
    if (env.BINANCE_TESTNET_TRACE_OUT) fs.writeFileSync(env.BINANCE_TESTNET_TRACE_OUT, JSON.stringify(r.receipt, null, 2));
  });
});
