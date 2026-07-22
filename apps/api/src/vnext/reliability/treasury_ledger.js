// TreasuryLedger — THE record of real collected revenue.
//
// One durable row per fulfilled resale, exactly-once by txId. Each row records
// what was collected from the caller (amount_in), what was paid to the supplier
// (cost), and the net revenue (spread = amount_in - cost), with the inbound
// settlement reference for external audit. Revenue is spread; the treasury
// balance is the sum of spreads. All money is integer minor units as BigInt.
//
// Invariant: spread >= 0 is enforced at credit time (never book a loss as
// revenue). A caller must have paid at least the supplier cost.

import { toMinor, FeeError } from '../fees/money.js';

export class TreasuryLedger {
  constructor({ store, clock } = {}) {
    if (!store) throw new Error('TreasuryLedger requires a store');
    this.store = store;
    this.clock = clock || (() => Date.now());
  }

  /**
   * Credit the treasury for one fulfilled resale. Exactly-once by txId (a retry
   * returns the existing row and books nothing new).
   * @returns {{credited:boolean, deduped?:boolean, spread:string, entry:object}}
   */
  async credit({ txId, amountIn, cost, unit, txInRef, payer }) {
    if (!txId) throw new FeeError('CONFIG', 'treasury.credit requires txId');
    if (!unit) throw new FeeError('CONFIG', 'treasury.credit requires unit');
    const inAmt = toMinor(amountIn, 'amountIn');
    const costAmt = toMinor(cost, 'cost');
    const spread = inAmt - costAmt;
    if (spread < 0n) throw new FeeError('NEGATIVE', 'inbound amount is below supplier cost — refusing to book a loss as revenue');

    const existing = await this.store.treasuryGet(txId);
    if (existing) return { credited: false, deduped: true, spread: existing.spread, entry: existing };

    const entry = {
      tx_id: txId,
      amount_in: inAmt.toString(),
      cost: costAmt.toString(),
      spread: spread.toString(),
      unit,
      tx_in_ref: txInRef || null,
      payer: payer || null,
      ts: this.clock(),
    };
    const res = await this.store.treasuryAdd(entry);
    // If a concurrent writer won the PK race, treat as deduped.
    if (!res.inserted) return { credited: false, deduped: true, spread: res.entry.spread, entry: res.entry };
    return { credited: true, spread: entry.spread, entry };
  }

  /** Treasury totals for a unit: gross collected, total supplier cost, net spread. */
  async totals(unit) {
    const rows = await this.store.treasuryRows(unit);
    let gross = 0n; let cost = 0n; let spread = 0n;
    for (const r of rows) {
      gross += toMinor(r.amount_in, 'amount_in');
      cost += toMinor(r.cost, 'cost');
      spread += toMinor(r.spread, 'spread');
    }
    return { unit: unit || null, count: rows.length, gross: gross.toString(), cost: cost.toString(), spread: spread.toString() };
  }

  /** Net revenue balance (sum of spreads) for a unit. */
  async balance(unit) { return (await this.totals(unit)).spread; }

  async get(txId) { return this.store.treasuryGet(txId); }
}

export { FeeError };
