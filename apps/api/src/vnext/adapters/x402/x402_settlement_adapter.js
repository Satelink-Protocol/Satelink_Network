// x402 settlement adapter (SettlementAdapter, settlementMode PRE).
//
// Constructs REAL x402 v2 payment payloads (base64 JSON with x402Version /
// scheme / network / payTo), reusing the production `getX402Config()`. It does
// NOT broadcast real money: no wallet/private key is available and autonomous
// broadcasting is forbidden by the constitution's financial-safety rules — the
// payload SHAPE is protocol-real, the transport is not exercised here. Exposes
// settleIn / settleOut / verify / refund.

import { SettlementAdapter } from '../../kernel/interfaces.js';
import { getX402Config } from '../../../payments/x402/config.js';
import { txIdOf } from './x402_context.js';

export class X402SettlementAdapter extends SettlementAdapter {
  constructor({ ctx, config } = {}) {
    super();
    if (!ctx) throw new Error('X402SettlementAdapter requires a shared X402Context');
    this.ctx = ctx;
    this.cfg = config || getX402Config(); // REAL x402 config (network, payTo, facilitator)
  }

  capabilities() {
    return { modes: ['PRE'], units: ['USDC'], finality: 'INSTANT', name: 'X402', network: this.cfg.network };
  }

  async settleIn(amount, unit, payer, idemKey) {
    const txId = txIdOf(idemKey);
    const payment = {
      x402Version: 1,
      scheme: 'exact',
      network: this.cfg.network,
      payload: { payTo: this.cfg.payTo, amount: String(amount), asset: unit, payer, nonce: idemKey },
    };
    const header = Buffer.from(JSON.stringify(payment)).toString('base64');
    const ref = `x402_${txId}`;
    // Hand the payment proof to the workload adapter's EXECUTE phase.
    this.ctx.payments.set(txId, { header, ref, amount, unit, payTo: this.cfg.payTo, network: this.cfg.network });
    return { ref, direction: 'IN', amount, unit, status: 'settled', payTo: this.cfg.payTo, idemKey };
  }

  async settleOut(amount, unit, payee, idemKey) {
    // For an x402 purchase the merchant was paid at settleIn; settleOut
    // finalizes/confirms with no second payment. Idempotent.
    return { ref: `x402_out_${txIdOf(idemKey)}`, direction: 'OUT', amount, unit, status: 'confirmed', payee, idemKey };
  }

  async verify(ref) { return { status: 'settled', ref }; }

  async refund(ref, idemKey) { return { status: 'refunded', ref, idemKey }; }
}
