// RoutingKernel — the immutable core (Constitution §3).
//
// Owns the RoutingTransaction state machine and drives the five phases
// DISCOVER -> QUOTE -> ROUTE -> EXECUTE -> SETTLE -> CLOSED. It contains ZERO
// workload/protocol/rail/fee logic: it depends only on injected interfaces
// (a workload adapter resolved from the registry, plus settlement/fee adapters,
// the journal, and the idempotency store). Adding a workload = registering an
// adapter; the kernel is never modified.

import { TxState, RoutingTransaction } from './transaction.js';
import { idemKey } from './idempotency.js';
import { Saga } from './saga.js';
import { SettlementMode } from './interfaces.js';

export class RoutingKernel {
  constructor({ registry, settlement, fee, journal, idempotency, clock }) {
    this.registry = registry;
    this.settlement = settlement;
    this.fee = fee;
    this.journal = journal;
    this.idempotency = idempotency;
    this.clock = clock || (() => Date.now());
  }

  /** Run one guarded, idempotent, journaled phase transition. */
  async _phase(tx, phase, forward, compensation, saga) {
    const key = idemKey(tx.id, phase);
    const fresh = !this.idempotency.has(key);
    const out = await this.idempotency.once(key, forward);
    if (fresh) {
      this.journal.append(tx.id, phase, { state: tx.state, out: out === undefined ? null : out }, this.clock());
      if (compensation) saga.step(compensation);
    }
    return out;
  }

  /**
   * Execute one machine transaction end to end.
   * @param {{workload:string, query?:object, payload?:any, payer?:string}} request
   * @param {{txId:string}} options  txId is derived from the client idempotency key.
   */
  async execute(request, options = {}) {
    const txId = options.txId || ('tx_' + this.clock().toString(36));
    const tx = new RoutingTransaction(txId, request);
    const saga = new Saga();

    try {
      const adapter = this.registry.get(request.workload);
      const caps = adapter.capabilities();
      const mode = caps.settlementMode || SettlementMode.POST;

      // DISCOVER
      tx.state = TxState.DISCOVERING;
      tx.candidates = await this._phase(tx, 'DISCOVER', () => adapter.discover(request.query || {}), null, saga);
      if (!tx.candidates || tx.candidates.length === 0) {
        await this._phase(tx, 'REJECTED', () => ({ reason: 'no_supply' }), null, saga);
        tx.state = TxState.REJECTED; tx.reason = 'no_supply';
        return tx;
      }
      tx.state = TxState.DISCOVERED;

      // QUOTE (trivial single-candidate selection for M1; Policy Engine is post-M1)
      tx.state = TxState.QUOTING;
      tx.supplier = tx.candidates[0];
      tx.quote = await this._phase(tx, 'QUOTE', () => adapter.quote(request, tx.supplier), null, saga);
      tx.state = TxState.QUOTED;

      // ROUTE — bind supplier + fee; enforce fee>=0 invariant (Constitution §1.5)
      tx.state = TxState.ROUTING;
      tx.route = await this._phase(tx, 'ROUTE', () => {
        const fee = this.fee.computeFee(tx.quote, { txId: tx.id });
        if (!fee || fee.amount < 0) throw new Error('INVARIANT_VIOLATION_fee_negative');
        return { supplier: tx.supplier, quote: tx.quote, fee };
      }, null, saga);
      tx.fee = tx.route.fee;
      tx.state = TxState.ROUTED;

      // SETTLE-IN before execute only when the adapter declares PRE (generic branch)
      if (mode === SettlementMode.PRE) {
        tx.state = TxState.SETTLING_IN;
        tx.settlementInRef = await this._phase(
          tx, 'SETTLE_IN',
          () => this.settlement.settleIn(tx.quote.cost, tx.quote.unit, request.payer || 'anon', idemKey(tx.id, 'SETTLE_IN')),
          () => this.settlement.settleOut(tx.quote.cost, tx.quote.unit, request.payer || 'anon', idemKey(tx.id, 'REFUND')),
          saga,
        );
        tx.state = TxState.SETTLED_IN;
      }

      // EXECUTE
      tx.state = TxState.EXECUTING;
      tx.result = await this._phase(
        tx, 'EXECUTE',
        () => adapter.execute(request, tx.supplier, { idemKey: idemKey(tx.id, 'EXECUTE'), deadline: null }),
        null, saga,
      );
      tx.state = TxState.EXECUTED;

      // SETTLE (out)
      tx.state = TxState.SETTLING_OUT;
      tx.settlementOutRef = await this._phase(
        tx, 'SETTLE',
        () => this.settlement.settleOut(tx.quote.cost, tx.quote.unit, tx.supplier.supplierId, idemKey(tx.id, 'SETTLE')),
        null, saga,
      );
      tx.state = TxState.SETTLED;

      // CLOSE
      await this._phase(tx, 'CLOSED', () => ({ state: 'CLOSED' }), null, saga);
      tx.state = TxState.CLOSED;
      return tx;
    } catch (err) {
      const reason = String((err && err.message) || err);
      tx.state = TxState.COMPENSATING;
      this.journal.append(tx.id, 'COMPENSATING', { reason }, this.clock());
      await saga.compensate();
      tx.state = TxState.FAILED;
      tx.reason = reason;
      this.journal.append(tx.id, 'FAILED', { reason }, this.clock());
      return tx;
    }
  }

  /** Replayability: rebuild the phase timeline purely from the journal. */
  reconstruct(txId) {
    const events = this.journal.read(txId);
    return {
      txId,
      phases: events.map((e) => e.phase),
      terminal: events.length ? events[events.length - 1].phase : null,
    };
  }
}
