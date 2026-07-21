// InboundSettlement — the revenue-collection leg. Charges the CALLER before
// Satelink does any work: issues an x402 402 challenge for `price`, and verifies
// the caller's X-PAYMENT on retry. Verification is injectable: in production the
// `verifier` is the CDP facilitator (verify+settle moves USDC from the caller to
// Satelink's payTo on-chain); in tests it is a mock. Absent a verifier, inbound
// cannot settle (fail-safe — never serve paid work for free).

export class InboundSettlement {
  constructor({ payTo, network, verifier = null } = {}) {
    if (!payTo) throw new Error('InboundSettlement requires a payTo (Satelink receiving address)');
    this.payTo = payTo;
    this.network = network || 'eip155:8453';
    this.verifier = verifier; // async ({ header, price, unit, resource }) -> { settled, amount, txRef, payer }
  }

  /** x402 402 payment-requirements body challenging the caller for `price`. */
  challenge(price, unit, resource) {
    return {
      x402Version: 1,
      accepts: {
        scheme: 'exact',
        network: this.network,
        payTo: this.payTo,
        maxAmountRequired: String(price),
        asset: unit,
        resource,
        mimeType: 'application/json',
      },
    };
  }

  /**
   * Verify the caller's inbound payment covers `price`. Returns a normalized
   * settlement result. Never throws on a bad payment — returns {settled:false}.
   * @returns {{settled:boolean, amount?:string, txRef?:string, payer?:string, reason?:string}}
   */
  async verify(header, price, unit, resource) {
    if (!header) return { settled: false, reason: 'no_payment' };
    if (!this.verifier) return { settled: false, reason: 'no_verifier' }; // fail-safe
    let out;
    try {
      out = await this.verifier({ header, price: String(price), unit, resource, payTo: this.payTo, network: this.network });
    } catch (e) {
      return { settled: false, reason: `verify_error:${(e && e.message) || e}` };
    }
    if (!out || out.settled !== true) return { settled: false, reason: (out && out.reason) || 'not_settled' };
    // The facilitator must confirm the settled amount covers the quoted price.
    if (out.amount != null && BigInt(out.amount) < BigInt(price)) return { settled: false, reason: 'underpaid' };
    return { settled: true, amount: String(out.amount != null ? out.amount : price), txRef: out.txRef || null, payer: out.payer || null };
  }
}
