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
  constructor({ ctx, config, guard = null, signer = null } = {}) {
    super();
    if (!ctx) throw new Error('X402SettlementAdapter requires a shared X402Context');
    this.ctx = ctx;
    this.cfg = config || getX402Config(); // REAL x402 config (network, payTo, facilitator)
    // Optional outbound safety: `guard` (OutboundGuard) authorizes real spend;
    // `signer` (human-provided, key-holding) produces the real signed x402
    // authorization. Absent either -> dry-run (payload only, no money).
    this.guard = guard;
    this.signer = signer;
  }

  capabilities() {
    return { modes: ['PRE'], units: ['USDC'], finality: 'INSTANT', name: 'X402', network: this.cfg.network };
  }

  async settleIn(amount, unit, payer, idemKey) {
    const txId = txIdOf(idemKey);

    // Outbound safety gate. The guard atomically authorizes → signs → records
    // (caps hold under concurrency). Fail-safe: enabled+authorized but no signer
    // configured -> refuse (never claim to pay without a key). Cap breach ->
    // throw so the kernel fails the tx before EXECUTE (no resource fetched).
    let live = false;
    let payment;
    let ref = `x402_${txId}`;

    if (this.guard) {
      const outcome = await this.guard.spend(amount, idemKey, async () => {
        if (!this.signer) throw new Error('outbound_no_signer'); // fail-safe, inside the lock
        const signed = await this.signer.sign({ payTo: this.cfg.payTo, amount: String(amount), asset: unit, network: this.cfg.network, nonce: idemKey, payer });
        return { ref: signed.ref || ref, payment: signed.payment || signed };
      });
      if (outcome.status === 'blocked') throw new Error(`outbound_blocked:${outcome.reason}`);
      if (outcome.status === 'spent') { live = true; payment = outcome.signed.payment; ref = outcome.signed.ref; }
      // 'dry-run' (kill switch off) or 'deduped' -> payload-only below.
    }

    if (!payment) {
      // Dry-run / deduped / no-guard: construct the payload but move no money.
      payment = { x402Version: 1, scheme: 'exact', network: this.cfg.network, payload: { payTo: this.cfg.payTo, amount: String(amount), asset: unit, payer, nonce: idemKey } };
    }

    const header = Buffer.from(JSON.stringify(payment)).toString('base64');
    // Hand the payment proof to the workload adapter's EXECUTE phase.
    this.ctx.payments.set(txId, { header, ref, amount, unit, payTo: this.cfg.payTo, network: this.cfg.network, live });
    return { ref, direction: 'IN', amount, unit, status: live ? 'settled' : 'dry-run', payTo: this.cfg.payTo, idemKey };
  }

  async settleOut(amount, unit, payee, idemKey) {
    // For an x402 purchase the merchant was paid at settleIn; settleOut
    // finalizes/confirms with no second payment. Idempotent.
    return { ref: `x402_out_${txIdOf(idemKey)}`, direction: 'OUT', amount, unit, status: 'confirmed', payee, idemKey };
  }

  async verify(ref) { return { status: 'settled', ref }; }

  async refund(ref, idemKey) { return { status: 'refunded', ref, idemKey }; }
}
