// OutboundGuard — the hard financial safety rail for outbound payments.
//
// Enforces, in code (not policy): a kill switch, per-payment / per-hour /
// per-day caps, an optional wallet-balance floor, and per-idemKey exactly-once
// (no double-spend on retry). Rolling caps are computed from the DURABLE
// outbound ledger, so they survive restart. All money is integer minor units
// as BigInt — no float. The guard AUTHORIZES; it never holds keys or signs.
//
// Fail-safe posture:
//   - kill switch off            -> not authorized, dryRun=true (no money)
//   - any cap breached           -> not authorized, blocked
//   - floor set, balance unknown -> not authorized, blocked (won't pay blind)
//   - already paid (idemKey)     -> authorized, deduped=true (no new spend)

import { toMinor, FeeError } from '../fees/money.js';

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

export class OutboundGuard {
  /**
   * @param {object} o
   *  - store (required): DurableStore (outbound ledger)
   *  - enabled (bool): VNEXT_OUTBOUND_ENABLED
   *  - caps: { maxPerTx, maxPerHour, maxPerDay, walletFloor } minor-unit strings/ints
   *  - balanceReader: optional async () => minorUnits (BigInt|string|int); enables the floor check
   *  - clock: () => ms
   */
  constructor({ store, enabled = false, caps = {}, balanceReader = null, clock } = {}) {
    if (!store) throw new Error('OutboundGuard requires a store');
    this.store = store;
    this.enabled = enabled === true;
    this.clock = clock || (() => Date.now());
    this.balanceReader = balanceReader;
    this._lock = Promise.resolve(); // serializes spend() so rolling caps hold under concurrency
    this.caps = {
      maxPerTx: caps.maxPerTx != null ? toMinor(caps.maxPerTx, 'maxPerTx') : null,
      maxPerHour: caps.maxPerHour != null ? toMinor(caps.maxPerHour, 'maxPerHour') : null,
      maxPerDay: caps.maxPerDay != null ? toMinor(caps.maxPerDay, 'maxPerDay') : null,
      walletFloor: caps.walletFloor != null ? toMinor(caps.walletFloor, 'walletFloor') : null,
    };
  }

  async _spentSince(sinceMs) {
    const rows = await this.store.outboundRowsSince(sinceMs);
    let sum = 0n;
    for (const r of rows) sum += toMinor(r.amount, 'ledger.amount');
    return sum;
  }

  /**
   * Decide whether an outbound payment of `amount` (minor units) is permitted.
   * Does NOT record it — caller records via commit() only after a real send.
   * @returns {{authorized:boolean, dryRun?:boolean, deduped?:boolean, reason?:string, amount:string}}
   */
  async authorize(amount, idemKey) {
    const amt = toMinor(amount, 'amount');
    const now = this.clock();

    // Already paid for this idemKey -> no new spend (idempotent retry).
    const existing = await this.store.outboundGet(idemKey);
    if (existing) return { authorized: true, deduped: true, amount: existing.amount };

    // Kill switch: never move money when disabled.
    if (!this.enabled) return { authorized: false, dryRun: true, reason: 'kill_switch_off', amount: amt.toString() };

    // Per-payment cap.
    if (this.caps.maxPerTx != null && amt > this.caps.maxPerTx) {
      return { authorized: false, reason: 'per_tx_cap', amount: amt.toString() };
    }
    // Rolling per-hour cap.
    if (this.caps.maxPerHour != null) {
      const spent = await this._spentSince(now - HOUR_MS);
      if (spent + amt > this.caps.maxPerHour) return { authorized: false, reason: 'per_hour_cap', amount: amt.toString() };
    }
    // Rolling per-day cap.
    if (this.caps.maxPerDay != null) {
      const spent = await this._spentSince(now - DAY_MS);
      if (spent + amt > this.caps.maxPerDay) return { authorized: false, reason: 'per_day_cap', amount: amt.toString() };
    }
    // Wallet floor: balance after payment must stay >= floor. If a floor is set
    // but balance can't be read, refuse (never pay blind).
    if (this.caps.walletFloor != null) {
      if (!this.balanceReader) return { authorized: false, reason: 'wallet_balance_unknown', amount: amt.toString() };
      const bal = toMinor(await this.balanceReader(), 'walletBalance');
      if (bal - amt < this.caps.walletFloor) return { authorized: false, reason: 'wallet_floor', amount: amt.toString() };
    }
    return { authorized: true, amount: amt.toString() };
  }

  /** Record a completed outbound payment (exactly-once). Call only after send. */
  async commit(amount, idemKey, ref) {
    const amt = toMinor(amount, 'amount');
    return this.store.outboundAdd({ idem_key: idemKey, amount: amt.toString(), ref: ref || null, ts: this.clock() });
  }

  /**
   * Atomically authorize → sign → commit an outbound payment. The whole
   * sequence runs under an internal mutex, so concurrent spends cannot both
   * pass a near-limit rolling cap (no TOCTOU overspend). `signFn` runs ONLY
   * when a real payment is authorized and must return { ref } (and optionally
   * a payment payload); if it throws, nothing is committed.
   * @returns {{status:'dry-run'|'blocked'|'deduped'|'spent', reason?:string, signed?:any, amount:string}}
   */
  async spend(amount, idemKey, signFn) {
    const run = this._lock.then(async () => {
      const decision = await this.authorize(amount, idemKey);
      if (decision.deduped) return { status: 'deduped', amount: decision.amount };
      if (decision.dryRun) return { status: 'dry-run', reason: decision.reason, amount: decision.amount };
      if (!decision.authorized) return { status: 'blocked', reason: decision.reason, amount: decision.amount };
      const signed = await signFn(); // sign under the lock; may throw (nothing committed)
      await this.commit(amount, idemKey, signed && signed.ref);
      return { status: 'spent', signed, amount: decision.amount };
    });
    this._lock = run.then(() => {}, () => {}); // keep the chain alive on failure
    return run;
  }
}

export { FeeError };
