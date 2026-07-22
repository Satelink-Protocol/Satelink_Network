// Retry policy — exponential backoff with jitter and a max-attempts cap.
// Pure and deterministic given an injected RNG (so tests are reproducible and
// replay is stable). Delays are in milliseconds.

export class RetryPolicy {
  constructor({ maxAttempts = 5, baseMs = 100, factor = 2, maxMs = 30_000, jitter = 0.5, rng = () => 0.5 } = {}) {
    this.maxAttempts = maxAttempts;
    this.baseMs = baseMs;
    this.factor = factor;
    this.maxMs = maxMs;
    this.jitter = jitter; // fraction of the delay applied as +/- jitter
    this.rng = rng;       // () -> [0,1)
  }

  /** Should attempt N (1-based) proceed? */
  shouldRetry(attempt) { return attempt < this.maxAttempts; }

  /** Backoff delay before attempt N+1 (attempt is 1-based, the one that just failed). */
  delayMs(attempt) {
    const exp = Math.min(this.maxMs, this.baseMs * Math.pow(this.factor, Math.max(0, attempt - 1)));
    const spread = exp * this.jitter;
    const delta = (this.rng() * 2 - 1) * spread; // +/- jitter
    return Math.max(0, Math.round(Math.min(this.maxMs, exp + delta)));
  }
}
