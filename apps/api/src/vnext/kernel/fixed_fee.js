// Fixed fee adapter — M1 scaffolding (Constitution §9).
//
// Returns a fixed zero-amount FeeInstruction. This demonstrates the FeeAdapter
// interface and the kernel's fee>=0 invariant enforcement WITHOUT any revenue
// logic, pricing, or fee optimization (all explicitly out of M1 scope).

import { FeeAdapter, FeeCapture } from './interfaces.js';

export class FixedFeeAdapter extends FeeAdapter {
  plan() { return { model: 'FIXED' }; }
  computeFee(_quote, _context) {
    return { amount: 0, unit: 'none', recipient: 'satelink', capture: FeeCapture.IN_MARKUP };
  }
}
