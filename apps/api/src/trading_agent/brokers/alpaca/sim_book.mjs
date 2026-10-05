// Simulated commission book (Stage 23). Maps fills with commission into balanced double entries
// so the Phase 12 commission path can be exercised end to end WITHOUT the ledger: Stage 20
// (revenue) is stopped (U2 = PARTIAL; new ledger_txns kinds unapproved), so nothing here imports or
// writes ledger code. Entries are idempotent by fill id and carry both Satelink's expected
// commission and Alpaca's reported one when known, so variance is visible.
import { BrokerError, BrokerErrorCode } from '../errors.mjs';

export class SimCommissionBook {
  #entries = []; #seen = new Set();

  /** @param row { fillId, alpacaAccountId, clientOrderId, expectedCents (bigint), reportedCents?: bigint|null, at } */
  post(row) {
    if (this.#seen.has(row.fillId)) return { posted: false, duplicate: true };
    if (typeof row.expectedCents !== 'bigint' || row.expectedCents < 0n) throw new BrokerError(BrokerErrorCode.INTERNAL, { venue: 'alpaca', message: 'expectedCents must be a non-negative bigint' });
    const amount = row.reportedCents ?? row.expectedCents; // Alpaca's figure is the authority when present
    this.#seen.add(row.fillId);
    if (amount === 0n) return { posted: false, zero: true };
    const base = { fillId: row.fillId, clientOrderId: row.clientOrderId, at: row.at, currency: 'USD', simulated: true };
    this.#entries.push(Object.freeze({ ...base, account: `sim:customer:${row.alpacaAccountId}:cash`, debitCents: amount, creditCents: 0n }));
    this.#entries.push(Object.freeze({ ...base, account: 'sim:correspondent:commission_revenue', debitCents: 0n, creditCents: amount }));
    return { posted: true, amountCents: amount, varianceCents: row.reportedCents == null ? null : row.reportedCents - row.expectedCents };
  }
  entries() { return [...this.#entries]; }
  balance(account) { return this.#entries.filter((e) => e.account === account).reduce((s, e) => s + e.creditCents - e.debitCents, 0n); }
  /** Σ debits = Σ credits, always. */
  balanced() { return this.#entries.reduce((s, e) => s + e.debitCents - e.creditCents, 0n) === 0n; }
}
