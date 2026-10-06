// Ledger posting for settled subscription payments (Stage 27).
//   test mode → SimSubscriptionBook (balanced, idempotent, clearly simulated). This is the brief's
//               acceptance ("test-mode subscription posts to sim book").
//   live mode → RealBookPosting REFUSES: the Financial-OS ledger needs new ledger_txns kinds and the
//               U2 prerequisites (Stage 20 is STOPPED pending a founder decision). Nothing here imports
//               ledger code; live keys are refused anyway.
import { BillingError } from './errors.mjs';

export class SimSubscriptionBook {
  #entries = []; #seen = new Set();
  post({ postingKey, principalId, currency, amountMinor, at, kind = 'payment' }) {
    if (this.#seen.has(postingKey)) return { posted: false, duplicate: true };
    const amount = BigInt(amountMinor);
    if (amount <= 0n) throw new BillingError('INVALID', 'posting amount must be positive');
    this.#seen.add(postingKey);
    const [dr, cr] = kind === 'refund'
      ? ['sim:platform:subscription_revenue', 'sim:gateway:razorpay:clearing']
      : ['sim:gateway:razorpay:clearing', 'sim:platform:subscription_revenue'];
    const base = { postingKey, principalId, currency, at, simulated: true };
    this.#entries.push(Object.freeze({ ...base, account: dr, debitMinor: amount, creditMinor: 0n }));
    this.#entries.push(Object.freeze({ ...base, account: cr, debitMinor: 0n, creditMinor: amount }));
    return { posted: true };
  }
  entries() { return [...this.#entries]; }
  balance(account) { return this.#entries.filter((e) => e.account === account).reduce((s, e) => s + e.creditMinor - e.debitMinor, 0n); }
  balanced() { return this.#entries.reduce((s, e) => s + e.debitMinor - e.creditMinor, 0n) === 0n; }
}

export class RealBookPosting {
  post() {
    throw new BillingError('LEDGER_NOT_APPROVED', 'real-book posting needs the Stage 20 decision (U2 prerequisites + new ledger_txns kinds); nothing was posted');
  }
}

export function bookFor(mode, { sim, real = new RealBookPosting() }) {
  return mode === 'test' ? sim : real;
}
