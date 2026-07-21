// Recovery Worker + Dead Letter Queue.
//
// On startup (or on a timer) scans the journal for transactions that were
// SUBMITted but never reached a terminal phase (CLOSED/REJECTED/FAILED), and
// re-runs them through the kernel. Because every kernel phase is idempotent
// (persistent idempotency store), re-running a partially-completed transaction
// resumes from where it stopped and never repeats a settled side effect.
//
// A transaction that still cannot terminate after `retryPolicy.maxAttempts`
// resume attempts is moved to the Dead Letter Queue (durable) and left for
// operator inspection — it is never silently dropped or retried forever.

const TERMINAL = new Set(['CLOSED', 'REJECTED', 'FAILED']);

export class RecoveryWorker {
  constructor({ kernel, journal, store, retryPolicy, clock } = {}) {
    if (!kernel || !journal || !store) throw new Error('RecoveryWorker requires { kernel, journal, store }');
    this.kernel = kernel;
    this.journal = journal;
    this.store = store;
    this.retryPolicy = retryPolicy || { maxAttempts: 5 };
    this.clock = clock || (() => Date.now());
  }

  /** Find SUBMITted txIds whose stream has no terminal phase. */
  incompleteTransactions() {
    const submits = new Map(); // txId -> request
    const terminal = new Set();
    for (const e of this.journal.all()) {
      if (e.phase === 'SUBMIT') submits.set(e.txId, e.payload.request);
      if (TERMINAL.has(e.phase)) terminal.add(e.txId);
    }
    const out = [];
    for (const [txId, request] of submits) if (!terminal.has(txId)) out.push({ txId, request });
    return out;
  }

  /** Resume all incomplete transactions once; DLQ the ones that still fail. */
  async recover() {
    const resumed = [];
    const deadLettered = [];
    for (const { txId, request } of this.incompleteTransactions()) {
      if (await this.store.dlqGet(txId)) continue; // already dead-lettered
      let attempts = 0;
      let terminalPhase = null;
      const max = this.retryPolicy.maxAttempts || 5;
      while (attempts < max) {
        attempts += 1;
        try {
          const tx = await this.kernel.execute(request, { txId });
          terminalPhase = tx.state;
          if (TERMINAL.has(tx.state)) break;
        } catch (_) { /* re-attempt within cap */ }
      }
      if (terminalPhase && TERMINAL.has(terminalPhase) && terminalPhase !== 'FAILED') {
        resumed.push({ txId, state: terminalPhase });
      } else if (terminalPhase === 'FAILED') {
        // A clean FAILED (compensated) is a legitimate terminal state, not a DLQ case.
        resumed.push({ txId, state: 'FAILED' });
      } else {
        await this.store.dlqAdd({ tx_id: txId, reason: 'unresolved_after_retries', attempts, request, failed_at: this.clock() });
        deadLettered.push(txId);
      }
    }
    return { resumed, deadLettered };
  }
}
