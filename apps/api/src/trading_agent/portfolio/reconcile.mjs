// Broker-snapshot reconciliation (Stage 18): the broker is authoritative.
//
// Compares internal positions with the broker's positions for one (account, mode). A
// difference above tolerance (absolute quantity per instrument, plus optional relative bps)
// is a mismatch; a broker read error counts as not-matching too (we can't confirm). When
// the streak of non-matching checks reaches `mismatchesToPause` the account is auto-paused,
// once per streak:
//   1. Stage 15 kill switch, scope broker_account (platform actor) — every new order on the
//      account is stopped at risk check 1;
//   2. 'strategy.auto_paused' emitted to trading_outbox (aggregate 'strategy') + audit_events;
//   3. optional strategyPauser hook (e.g. Stage 13 lifecycle → PAUSED for bound versions).
// Releasing is a human decision (Stage 15 kill-switch rules). Every check is recorded in
// reconciliation_events (append-only).
import { randomBytes } from 'node:crypto';
import { PortfolioError } from './errors.mjs';
import { fx, toDecimal, abs, mul, div, fxInt } from '../strategies/fixed.mjs';

export const RECON_ACTOR = Object.freeze({ principalId: 'prn_portfolio_reconciler', kind: 'platform' });

export class PortfolioReconciler {
  #store; #broker; #accounts; #kill; #pauser; #clock; #ids; #o;

  /**
   * @param deps.brokerPositions { snapshot({ brokerAccountId, mode }) → { asOf, positions: [{ instrument, quantity }] } }
   * @param deps.accounts        { get(brokerAccountId) → { principalId } } — tenant check
   * @param deps.killSwitches    Stage 15 KillSwitchService
   * @param deps.strategyPauser  optional async ({ principalId, brokerAccountId, reason }) → [pausedId…]
   * @param deps.tolerance       { defaultQty: decimal, perInstrument: { [instrument]: decimal }, relativeBps: int }
   */
  constructor({ store, brokerPositions, accounts, killSwitches, strategyPauser = null, clock = () => new Date(), idFactory = () => `rce_${randomBytes(12).toString('hex')}`, tolerance = {}, mismatchesToPause = 2 }) {
    if (!store || typeof brokerPositions?.snapshot !== 'function' || typeof accounts?.get !== 'function' || typeof killSwitches?.engage !== 'function') {
      throw new PortfolioError('CONFIG', 'PortfolioReconciler needs store, brokerPositions, accounts and killSwitches');
    }
    if (!Number.isInteger(mismatchesToPause) || mismatchesToPause < 1) throw new PortfolioError('CONFIG', 'mismatchesToPause must be ≥ 1');
    this.#store = store; this.#broker = brokerPositions; this.#accounts = accounts; this.#kill = killSwitches; this.#pauser = strategyPauser;
    this.#clock = clock; this.#ids = idFactory;
    this.#o = { tolerance: { defaultQty: tolerance.defaultQty ?? '0', perInstrument: tolerance.perInstrument ?? {}, relativeBps: tolerance.relativeBps ?? 0 }, mismatchesToPause };
  }

  #tolFor(instrument, brokerQty) {
    const absTol = fx(this.#o.tolerance.perInstrument[instrument] ?? this.#o.tolerance.defaultQty);
    const rel = div(mul(abs(fx(brokerQty)), fxInt(this.#o.tolerance.relativeBps)), fxInt(10_000));
    return absTol > rel ? absTol : rel;
  }

  async runOnce({ principalId, brokerAccountId, mode }) {
    const account = await this.#accounts.get(brokerAccountId);
    if (!account || account.principalId !== principalId) throw new PortfolioError('NOT_FOUND', 'broker account not found');
    const at = this.#clock().toISOString();
    const id = this.#ids();
    const internal = new Map((await this.#store.positions(principalId, { brokerAccountId, mode })).map((p) => [p.instrument, p.quantity]));
    let status = 'match';
    let brokerAsOf = null;
    const details = { diffs: [] };
    try {
      const snap = await this.#broker.snapshot({ brokerAccountId, mode });
      brokerAsOf = snap.asOf ?? null;
      const broker = new Map(snap.positions.map((p) => [p.instrument, p.quantity]));
      for (const inst of [...new Set([...internal.keys(), ...broker.keys()])].sort()) {
        const i = internal.get(inst) ?? '0';
        const b = broker.get(inst) ?? '0';
        const diff = abs(fx(i) - fx(b));
        const tol = this.#tolFor(inst, b);
        if (diff > tol) details.diffs.push({ instrument: inst, internal: i, broker: b, diff: toDecimal(diff), tolerance: toDecimal(tol) });
      }
      if (details.diffs.length) status = 'mismatch';
    } catch (e) {
      status = 'error';
      details.error = String(e?.code ?? e?.message ?? e).slice(0, 200);
    }
    const prev = (await this.#store.reconciliationEvents(principalId, { brokerAccountId, mode, limit: 1 }))[0] ?? null;
    const streak = status === 'match' ? 0 : (prev && prev.status !== 'match' ? prev.consecutiveMismatches : 0) + 1;
    const alreadyPaused = status !== 'match' && prev && prev.status !== 'match' && (prev.action === 'paused' || prev.action === 'already_paused');
    let action = 'none';
    if (status !== 'match' && streak >= this.#o.mismatchesToPause) action = alreadyPaused ? 'already_paused' : await this.#autoPause({ id, principalId, brokerAccountId, mode, status, details, at });
    const event = { id, principalId, brokerAccountId, mode, checkedAt: at, status, consecutiveMismatches: streak, action, brokerAsOf, tolerance: this.#o.tolerance, details };
    await this.#store.insertReconciliationEvent(event);
    return Object.freeze(event);
  }

  async #autoPause({ id, principalId, brokerAccountId, mode, status, details, at }) {
    const reason = `portfolio reconciliation ${status} (${details.diffs.map((d) => d.instrument).join(', ') || details.error || 'unknown'}) [${id}]`.slice(0, 500);
    try {
      await this.#kill.engage({ actor: RECON_ACTOR, scopeType: 'broker_account', scopeId: brokerAccountId, principalId, reason });
    } catch (e) {
      details.pauseError = String(e?.message ?? e).slice(0, 200);
      return 'pause_failed';
    }
    let paused = [];
    if (this.#pauser) {
      try { paused = await this.#pauser({ principalId, brokerAccountId, reason }); } catch (e) { details.strategyPauseError = String(e?.message ?? e).slice(0, 200); }
    }
    const payload = { brokerAccountId, mode, reconciliationEventId: id, reason, killSwitch: { scopeType: 'broker_account', scopeId: brokerAccountId }, pausedStrategies: paused };
    await this.#store.transaction(async (tx) => {
      await tx.insertOutbox({ aggregateType: 'strategy', aggregateId: brokerAccountId, eventType: 'strategy.auto_paused', payload, idempotencyKey: `strategy.auto_paused:${id}` });
      await tx.appendAudit({ at, actorId: RECON_ACTOR.principalId, principalId, action: 'strategy.auto_paused', targetType: 'broker_account', targetId: brokerAccountId, payload });
    });
    return 'paused';
  }
}
