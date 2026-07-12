// Pluggable ledger store. Default is in-memory (great for a single process /
// demo). Swap for a Postgres/Redis-backed store in production by implementing
// the same async interface.
//
// Model: each customer has (a) a lifetime free allowance counted via `usage`,
// and (b) prepaid `credits` (integer number of billable calls) topped up by ANY
// rail. A served call consumes one free unit, else one credit.

export class MemoryStore {
  constructor() {
    this.credits = new Map();
    this.usage = new Map();
  }
  async getCredits(id) { return this.credits.get(id) || 0; }
  async addCredits(id, n) {
    const next = (this.credits.get(id) || 0) + n;
    this.credits.set(id, next);
    return next;
  }
  async debit(id, n = 1) {
    const c = this.credits.get(id) || 0;
    if (c < n) return false;
    this.credits.set(id, c - n);
    return true;
  }
  async incrUsage(id) {
    const u = (this.usage.get(id) || 0) + 1;
    this.usage.set(id, u);
    return u;
  }
  async getUsage(id) { return this.usage.get(id) || 0; }
}
