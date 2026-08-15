// apps/api/src/capacity/parity_recorder.js
//
// In-memory recorder for the M8 dual-evaluation window. Holds rolling counters
// (decisions evaluated, agreements, disagreements by reason) and a bounded
// latency reservoir per path so /internal/capacity-parity can report p50/p99.
//
// Process-local by design: the dual window is a bounded operational probe, not a
// durable store. Restart resets it. No secrets are ever recorded.

const RESERVOIR = 2000; // samples kept per path for percentile estimation

function makeReservoir() {
  return { samples: [], count: 0 };
}

function addSample(r, ms) {
  r.count += 1;
  if (r.samples.length < RESERVOIR) {
    r.samples.push(ms);
  } else {
    // Reservoir sampling keeps the distribution unbiased once full.
    const j = Math.floor(Math.random() * r.count);
    if (j < RESERVOIR) r.samples[j] = ms;
  }
}

function percentile(samples, p) {
  if (samples.length === 0) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return Number(sorted[idx].toFixed(3));
}

class ParityRecorder {
  constructor() {
    this.reset();
  }

  reset() {
    this.startedAt = new Date().toISOString();
    this.decisionsEvaluated = 0;
    this.agreements = 0;
    this.disagreements = 0;
    this.disagreementsByReason = {}; // "legacy=<d>|new=<d>" -> count
    this.latency = { legacy: makeReservoir(), new: makeReservoir() };
  }

  /**
   * Record one dual-evaluation observation.
   * @param {{decision:'allow'|'deny', reason?:string}} legacy
   * @param {{decision:'allow'|'deny', reason?:string}} neu
   * @param {number} legacyMs
   * @param {number} newMs
   */
  record(legacy, neu, legacyMs, newMs) {
    this.decisionsEvaluated += 1;
    addSample(this.latency.legacy, legacyMs);
    addSample(this.latency.new, newMs);
    const agree = legacy.decision === neu.decision;
    if (agree) {
      this.agreements += 1;
    } else {
      this.disagreements += 1;
      const legacyLabel = `legacy=${legacy.decision}${legacy.reason ? `:${legacy.reason}` : ''}`;
      const newLabel = `new=${neu.decision}${neu.reason ? `:${neu.reason}` : ''}`;
      const key = `${legacyLabel}|${newLabel}`;
      this.disagreementsByReason[key] = (this.disagreementsByReason[key] || 0) + 1;
    }
  }

  snapshot() {
    const p = (path) => ({
      count: this.latency[path].count,
      p50_ms: percentile(this.latency[path].samples, 50),
      p99_ms: percentile(this.latency[path].samples, 99),
    });
    const legacy = p('legacy');
    const neu = p('new');
    const p99Delta =
      legacy.p99_ms != null && neu.p99_ms != null
        ? Number((neu.p99_ms - legacy.p99_ms).toFixed(3))
        : null;
    return {
      ok: true,
      started_at: this.startedAt,
      path: process.env.CAPACITY_ENFORCEMENT_PATH || 'legacy',
      decisions_evaluated: this.decisionsEvaluated,
      agreements: this.agreements,
      disagreements: this.disagreements,
      disagreements_by_reason: this.disagreementsByReason,
      latency: { legacy, new: neu, new_minus_legacy_p99_ms: p99Delta },
      ts: new Date().toISOString(),
    };
  }
}

// Process-wide singleton (the RPC gateway records; the endpoint reads).
export const parityRecorder = new ParityRecorder();
