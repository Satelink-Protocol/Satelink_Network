// Shared handoff context for the x402 adapter pair.
//
// The kernel passes only (cost, unit, payer, idemKey) to settlement and only
// (request, supplier, {idemKey}) to execute — it does NOT thread the payment
// proof from SETTLE_IN into EXECUTE. The x402 workload adapter and x402
// settlement adapter therefore coordinate the payment handoff through this
// shared object, keyed by txId (parsed from the idemKey `${txId}:${phase}`).
// This is adapter-side wiring only; the kernel remains unaware and unedited.

export class X402Context {
  constructor() {
    /** @type {Map<string, {header:string, ref:string, amount:number, unit:string, payTo:string, network:string}>} */
    this.payments = new Map();
  }
}

/** Extract the txId from a kernel idemKey of the form `${txId}:${phase}`. */
export function txIdOf(idemKey) { return String(idemKey).split(':')[0]; }
