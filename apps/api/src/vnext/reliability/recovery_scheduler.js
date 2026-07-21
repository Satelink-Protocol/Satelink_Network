// Recovery Scheduler — runs the RecoveryWorker on a timer.
//
// Self-rescheduling (setTimeout, not setInterval) so a slow sweep never stacks:
// the next sweep is scheduled only AFTER the previous one settles. Runs are
// non-overlapping by construction. The timer is unref()'d so it never keeps the
// process alive on its own. Errors are routed to onError and swallowed so one
// failed sweep does not stop the loop. Timers are injectable for deterministic
// tests; runOnce() drives a single sweep without any timer.

export class RecoveryScheduler {
  constructor({ worker, recover, intervalMs = 30_000, onError, setTimer, clearTimer, withLock } = {}) {
    const fn = recover || (worker && (() => worker.recover()));
    if (!fn) throw new Error('RecoveryScheduler requires { worker } or { recover }');
    this._recover = fn;
    // Optional cross-instance guard: withLock(fn) -> {ran, result}. When a peer
    // instance is already sweeping, ran=false and this sweep is skipped.
    this._withLock = withLock || (async (f) => ({ ran: true, result: await f() }));
    this.intervalMs = intervalMs;
    this.onError = onError || (() => {});
    this._setTimer = setTimer || ((cb, ms) => {
      const t = setTimeout(cb, ms);
      if (t && typeof t.unref === 'function') t.unref();
      return t;
    });
    this._clearTimer = clearTimer || ((t) => clearTimeout(t));
    this._timer = null;
    this._stopped = true;
    this._inFlight = null; // Promise of the current sweep, or null
    this.lastResult = null;
    this.lastError = null;
    this.sweeps = 0;
    this.skipped = 0; // sweeps skipped because a peer instance held the lock
  }

  /** Start the periodic loop. Idempotent (a second start is a no-op). */
  start() {
    if (!this._stopped) return this;
    this._stopped = false;
    this._schedule();
    return this;
  }

  /** Stop the loop. In-flight sweep (if any) is awaited via drain(). */
  stop() {
    this._stopped = true;
    if (this._timer) { this._clearTimer(this._timer); this._timer = null; }
    return this;
  }

  /** Await the current in-flight sweep, if one is running. */
  async drain() { if (this._inFlight) await this._inFlight; }

  _schedule() {
    if (this._stopped) return;
    this._timer = this._setTimer(() => { this._tick(); }, this.intervalMs);
  }

  async _tick() {
    await this.runOnce();
    this._schedule(); // reschedule only after this sweep settles (non-overlapping)
  }

  /** Run exactly one recovery sweep. Never throws; records result/error. */
  async runOnce() {
    if (this._inFlight) return this._inFlight; // guard: never overlap
    this._inFlight = (async () => {
      try {
        const { ran, result } = await this._withLock(() => this._recover());
        if (!ran) { this.skipped += 1; return null; } // a peer instance is sweeping
        this.lastResult = result;
        this.lastError = null;
        return result;
      } catch (err) {
        this.lastError = err;
        this.onError(err);
        return null;
      } finally {
        this.sweeps += 1;
        this._inFlight = null;
      }
    })();
    return this._inFlight;
  }
}
