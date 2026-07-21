// Durable kernel assembly — wires the M6 reliability layer into the kernel path.
//
// Given a DurableStore (memory or PostgreSQL) plus the workload adapter registry
// and settlement/engine wiring, this builds a fully crash-safe RoutingKernel:
//   - PersistentJournal          (durable, hash-linked, replay-verified)
//   - PersistentIdempotencyStore (cross-restart exactly-once)
//   - PersistentSupplierRegistry (durable supply, rehydrated on boot) [optional]
//   - RecoveryWorker             (resume incomplete txns on boot) + DLQ
//   - ReliableExecutor           (persists SUBMIT before running)
//
// No kernel edits: the kernel already accepts journal/idempotency/supplierRegistry
// as injections. This is pure composition. `boot()` rehydrates state and runs one
// recovery pass BEFORE serving new traffic, so a restarted process finishes any
// transaction that was in flight when it died.

import { RoutingKernel } from '../kernel/kernel.js';
import { PersistentJournal } from './persistent_journal.js';
import { PersistentIdempotencyStore } from './persistent_idempotency.js';
import { PersistentSupplierRegistry } from './persistent_supplier_registry.js';
import { ReliableExecutor } from './reliable_executor.js';
import { RecoveryWorker } from './recovery_worker.js';
import { RecoveryScheduler } from './recovery_scheduler.js';
import { RetryPolicy } from './retry_policy.js';

export class DurableKernel {
  constructor({ kernel, journal, idempotency, supplierRegistry, executor, recoveryWorker, store }) {
    this.kernel = kernel;
    this.journal = journal;
    this.idempotency = idempotency;
    this.supplierRegistry = supplierRegistry;
    this.executor = executor;
    this.recoveryWorker = recoveryWorker;
    this.store = store;
    this.recoveryScheduler = null;
  }

  /**
   * Assemble a durable kernel from a store. Rehydrates the journal and (if a
   * HealthMonitor factory is supplied) the supplier registry, then wires the
   * kernel with the durable journal/idempotency plus any injected engines.
   *
   * @param {object} opts
   *  - store (required): a DurableStore
   *  - registry (required): workload adapter Registry
   *  - settlement (required): SettlementAdapter
   *  - clock, fee, decisionEngine, policy, feeEngine, feePolicy, feeCurrency, feeReceiver
   *  - useDurableSuppliers (bool): rehydrate a PersistentSupplierRegistry
   *  - makeHealthMonitor(registry): optional -> HealthMonitor
   *  - retryPolicy: optional RetryPolicy for the recovery worker
   */
  static async boot(opts) {
    const { store, registry, settlement, clock } = opts;
    if (!store) throw new Error('DurableKernel.boot requires a store');
    if (!registry) throw new Error('DurableKernel.boot requires a workload registry');

    const journal = await PersistentJournal.load(store);
    if (!journal.verifyChain()) throw new Error('journal hash chain invalid on boot — refusing to start');
    const idempotency = new PersistentIdempotencyStore(store);

    let supplierRegistry = opts.supplierRegistry || null;
    if (!supplierRegistry && opts.useDurableSuppliers) {
      supplierRegistry = await PersistentSupplierRegistry.load({ store, journal, clock });
    }
    const healthMonitor = supplierRegistry && opts.makeHealthMonitor ? opts.makeHealthMonitor(supplierRegistry) : null;

    const kernel = new RoutingKernel({
      registry, settlement, journal, idempotency, clock,
      fee: opts.fee,
      decisionEngine: opts.decisionEngine, policy: opts.policy,
      feeEngine: opts.feeEngine, feePolicy: opts.feePolicy, feeCurrency: opts.feeCurrency, feeReceiver: opts.feeReceiver,
      supplierRegistry, healthMonitor,
    });

    const executor = new ReliableExecutor({ kernel, journal, clock });
    const recoveryWorker = new RecoveryWorker({
      kernel, journal, store, clock,
      retryPolicy: opts.retryPolicy || new RetryPolicy(),
    });

    const dk = new DurableKernel({ kernel, journal, idempotency, supplierRegistry, executor, recoveryWorker, store });
    // Finish any transaction that was in flight when the previous process died,
    // BEFORE accepting new work.
    dk.lastRecovery = await recoveryWorker.recover();
    // Optionally keep sweeping on a timer (default off; caller opts in).
    if (opts.recoveryIntervalMs) dk.startRecoveryTimer({ intervalMs: opts.recoveryIntervalMs, onError: opts.onRecoveryError, setTimer: opts.setTimer, clearTimer: opts.clearTimer });
    return dk;
  }

  /** Submit a new transaction through the durable path (SUBMIT persisted first). */
  submit(request, options) { return this.executor.submit(request, options); }

  /** Run a recovery sweep on demand. */
  recover() { return this.recoveryWorker.recover(); }

  /** Start periodic recovery sweeps on a timer. Idempotent. */
  startRecoveryTimer({ intervalMs = 30_000, onError, setTimer, clearTimer } = {}) {
    if (!this.recoveryScheduler) {
      this.recoveryScheduler = new RecoveryScheduler({ worker: this.recoveryWorker, intervalMs, onError, setTimer, clearTimer });
    }
    this.recoveryScheduler.start();
    return this.recoveryScheduler;
  }

  /** Stop periodic recovery sweeps (and drain any in-flight sweep). */
  async stopRecoveryTimer() {
    if (this.recoveryScheduler) { this.recoveryScheduler.stop(); await this.recoveryScheduler.drain(); }
  }
}
