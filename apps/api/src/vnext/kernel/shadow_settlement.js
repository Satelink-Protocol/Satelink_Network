// Settlement wrapper (Constitution §8 — WRAP verdict from the Kernel Reality
// Audit). Adapts the EXISTING production `ShadowAdapter` (batch-payout shaped:
// createBatch/getBatchStatus) to the kernel's settleIn/settleOut/verify
// interface. No money moves — Shadow simulates settlement, which is exactly
// what M1 needs to run the full path safely.

import { SettlementAdapter, SettlementMode } from './interfaces.js';
import { ShadowAdapter } from '../../settlement/adapters/ShadowAdapter.js';

export class ShadowSettlementAdapter extends SettlementAdapter {
  constructor() { super(); this._shadow = new ShadowAdapter(); }

  capabilities() {
    return { modes: [SettlementMode.PRE, SettlementMode.POST], units: ['none', 'USDT'], finality: 'INSTANT', name: this._shadow.getName() };
  }

  async settleIn(amount, unit, payer, idemKey) {
    const batch = await this._shadow.createBatch({ id: idemKey, items: [{ wallet: payer, amount }] });
    return { ref: batch.external_ref, direction: 'IN', amount, unit, status: batch.status, idemKey };
  }

  async settleOut(amount, unit, payee, idemKey) {
    const batch = await this._shadow.createBatch({ id: idemKey, items: [{ wallet: payee, amount }] });
    return { ref: batch.external_ref, direction: 'OUT', amount, unit, status: batch.status, idemKey };
  }

  async verify(ref) { return this._shadow.getBatchStatus(ref); }
}
