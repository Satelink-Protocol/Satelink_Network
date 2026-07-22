// Reference echo workload adapter — kernel scaffolding / test double (NOT a
// real workload). Proves the five-phase WorkloadAdapter contract end to end
// without any x402/RPC/AI/DEX logic. Its `key` is parameterized so a second
// instance registers as a distinct workload with zero kernel edits
// (the constitutional acceptance test).

import { WorkloadAdapter, SettlementMode, ExecutionSafety } from './interfaces.js';

export class EchoWorkloadAdapter extends WorkloadAdapter {
  constructor(key = 'echo') { super(); this._key = key; }

  capabilities() {
    return {
      key: this._key,
      resourceTypes: ['echo'],
      settlementMode: SettlementMode.POST,
      executionSafety: ExecutionSafety.IDEMPOTENT,
    };
  }

  async discover(_query) { return [{ supplierId: `${this._key}-supplier-1` }]; }
  async probe(_supplier) { return { ok: true, latency_ms: 0 }; }
  async quote(_request, supplier) { return { cost: 0, unit: 'none', supplierId: supplier.supplierId, expiry: null }; }
  async execute(request, supplier, _ctx) { return { echoed: request.payload, by: supplier.supplierId }; }
}
