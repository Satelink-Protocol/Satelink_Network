// Adapter SDK contracts (Constitution §4, §8, §9).
//
// The RoutingKernel depends ONLY on these interfaces (Constitution §1.1):
// no workload, protocol, rail, or fee concept ever appears inside the kernel.
// Concrete adapters extend these base classes and are injected/registered.

export const SettlementMode = Object.freeze({ PRE: 'PRE', POST: 'POST', ESCROW: 'ESCROW' });
export const ExecutionSafety = Object.freeze({ IDEMPOTENT: 'IDEMPOTENT', AT_MOST_ONCE: 'AT_MOST_ONCE' });
export const FeeCapture = Object.freeze({ IN_MARKUP: 'IN_MARKUP', OUT_SKIM: 'OUT_SKIM', SEPARATE: 'SEPARATE', SPREAD: 'SPREAD' });

/** A workload maps the five phases onto exactly one interface. */
export class WorkloadAdapter {
  /** @returns {{key:string, resourceTypes:string[], settlementMode:string, executionSafety:string}} */
  capabilities() { throw new Error('WorkloadAdapter.capabilities() not implemented'); }
  async discover(_query) { throw new Error('WorkloadAdapter.discover() not implemented'); }
  async probe(_supplier) { return { ok: true }; }
  async quote(_request, _supplier) { throw new Error('WorkloadAdapter.quote() not implemented'); }
  async execute(_request, _supplier, _ctx) { throw new Error('WorkloadAdapter.execute() not implemented'); }
}

/** Generic value movement. Never assumes blockchain/fiat/x402 (Constitution §8). */
export class SettlementAdapter {
  capabilities() { throw new Error('SettlementAdapter.capabilities() not implemented'); }
  async settleIn(_amount, _unit, _payer, _idemKey) { throw new Error('SettlementAdapter.settleIn() not implemented'); }
  async settleOut(_amount, _unit, _payee, _idemKey) { throw new Error('SettlementAdapter.settleOut() not implemented'); }
  async verify(_ref) { throw new Error('SettlementAdapter.verify() not implemented'); }
}

/** Satelink's business, made generic (Constitution §9). Kernel executes a fee, never computes one. */
export class FeeAdapter {
  plan() { throw new Error('FeeAdapter.plan() not implemented'); }
  /** @returns {{amount:number, unit:string, recipient:string, capture:string}} */
  computeFee(_quote, _context) { throw new Error('FeeAdapter.computeFee() not implemented'); }
}
