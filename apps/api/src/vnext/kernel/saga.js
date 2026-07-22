// Saga orchestration (Constitution §2, §3).
//
// Each forward phase may register a compensating action. On failure the kernel
// runs compensations in reverse order, driving the transaction to a clean
// terminal state (no delivery -> no charge; settle-in without execute -> refund).

export class Saga {
  constructor() { this._compensations = []; }

  /** Register a compensation for the most recent successful forward step. */
  step(compensation) {
    if (typeof compensation === 'function') this._compensations.push(compensation);
  }

  /** Run all compensations in reverse. Best-effort; failures are swallowed here
   *  and journaled by the caller so recovery can retry. */
  async compensate() {
    for (let i = this._compensations.length - 1; i >= 0; i--) {
      try { await this._compensations[i](); } catch (_) { /* journaled by caller */ }
    }
  }
}
