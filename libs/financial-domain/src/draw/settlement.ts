/**
 * Settlement — ENTITY inside Draw (never a separate aggregate).
 *
 * Required by design: the settle-before-credit invariant needs both the Draw
 * state and Settlement state to move atomically. Separating them reopens the
 * PR #278 bug.
 *
 * State machine:
 *   pending → submitted → confirming → confirmed (terminal)
 *   submitted → reverted → retrying_settlement → {confirmed | failed_permanent_settlement}
 *
 * confirm() requires confirmations >= requiredConfirmations (Decision A — read
 * from the funding source config, passed in by the caller).
 *
 * Immutable — every transition returns a new Settlement.
 * External code sees SettlementView; the entity never escapes the Draw root.
 */

import type { Result } from '@satelink/kernel';
import { ok, err } from '@satelink/kernel';
import { SettlementState } from './settlement-state.js';
import { ConfirmationCount } from './confirmation-count.js';
import { AttemptCount } from './attempt-count.js';
import type { RailTransaction } from './rail-transaction.js';
import {
  IllegalSettlementTransitionError,
  InsufficientConfirmationsError,
} from './errors.js';

export interface SettlementProps {
  readonly state: SettlementState;
  readonly railTransaction: RailTransaction | null;
  readonly confirmations: ConfirmationCount;
  readonly requiredConfirmations: ConfirmationCount;
  readonly attemptCount: AttemptCount;
  readonly confirmedAt: number | null; // epoch ms
}

/** Read-only projection for code outside the Draw root. */
export interface SettlementView {
  readonly state: SettlementState;
  readonly railTransaction: RailTransaction | null;
  readonly confirmations: ConfirmationCount;
  readonly requiredConfirmations: ConfirmationCount;
  readonly attemptCount: AttemptCount;
  readonly confirmedAt: number | null;
}

type SettlementError = IllegalSettlementTransitionError | InsufficientConfirmationsError;

export class Settlement {
  private constructor(private readonly props: SettlementProps) {
    Object.freeze(this.props);
    Object.freeze(this);
  }

  static create(requiredConfirmations: ConfirmationCount): Settlement {
    return new Settlement({
      state: SettlementState.PENDING,
      railTransaction: null,
      confirmations: ConfirmationCount.zero(),
      requiredConfirmations,
      attemptCount: AttemptCount.zero(),
      confirmedAt: null,
    });
  }

  static reconstitute(props: SettlementProps): Settlement {
    return new Settlement(props);
  }

  get state(): SettlementState {
    return this.props.state;
  }
  get railTransaction(): RailTransaction | null {
    return this.props.railTransaction;
  }
  get confirmations(): ConfirmationCount {
    return this.props.confirmations;
  }
  get requiredConfirmations(): ConfirmationCount {
    return this.props.requiredConfirmations;
  }
  get attemptCount(): AttemptCount {
    return this.props.attemptCount;
  }
  get confirmedAt(): number | null {
    return this.props.confirmedAt;
  }

  toView(): SettlementView {
    return { ...this.props };
  }

  /** pending → submitted. Records the rail transaction. */
  submit(railTx: RailTransaction): Result<Settlement, SettlementError> {
    if (this.props.state.value !== 'pending') {
      return err(new IllegalSettlementTransitionError(this.props.state.value, 'submit'));
    }
    return ok(new Settlement({
      ...this.props,
      state: SettlementState.SUBMITTED,
      railTransaction: railTx,
      attemptCount: this.props.attemptCount.increment(),
    }));
  }

  /** submitted → confirming. Updates the confirmation count. */
  addConfirmations(count: ConfirmationCount): Result<Settlement, SettlementError> {
    if (this.props.state.value !== 'submitted') {
      return err(new IllegalSettlementTransitionError(this.props.state.value, 'addConfirmations'));
    }
    return ok(new Settlement({
      ...this.props,
      state: SettlementState.CONFIRMING,
      confirmations: count,
      railTransaction: this.props.railTransaction
        ? this.props.railTransaction.withConfirmations(count.value)
        : this.props.railTransaction,
    }));
  }

  /**
   * confirming → confirmed (terminal). Requires confirmations >= requiredConfirmations.
   * Decision A: requiredConfirmations comes from the funding source config.
   */
  confirm(count: ConfirmationCount, clockMs: number): Result<Settlement, SettlementError> {
    if (this.props.state.value !== 'confirming' && this.props.state.value !== 'retrying_settlement') {
      return err(new IllegalSettlementTransitionError(this.props.state.value, 'confirm'));
    }
    if (!count.gte(this.props.requiredConfirmations)) {
      return err(new InsufficientConfirmationsError(count.value, this.props.requiredConfirmations.value));
    }
    return ok(new Settlement({
      ...this.props,
      state: SettlementState.CONFIRMED,
      confirmations: count,
      confirmedAt: clockMs,
      railTransaction: this.props.railTransaction
        ? this.props.railTransaction.withConfirmations(count.value)
        : this.props.railTransaction,
    }));
  }

  /** submitted → reverted. The on-chain tx was reverted. */
  revert(): Result<Settlement, SettlementError> {
    if (this.props.state.value !== 'submitted') {
      return err(new IllegalSettlementTransitionError(this.props.state.value, 'revert'));
    }
    return ok(new Settlement({
      ...this.props,
      state: SettlementState.REVERTED,
    }));
  }

  /** reverted → retrying_settlement. Preparing to retry. */
  retrySettlement(): Result<Settlement, SettlementError> {
    if (this.props.state.value !== 'reverted') {
      return err(new IllegalSettlementTransitionError(this.props.state.value, 'retrySettlement'));
    }
    return ok(new Settlement({
      ...this.props,
      state: SettlementState.RETRYING_SETTLEMENT,
    }));
  }

  /** {reverted, retrying_settlement} → failed_permanent_settlement (terminal). */
  failPermanent(): Result<Settlement, SettlementError> {
    if (this.props.state.value !== 'retrying_settlement' && this.props.state.value !== 'reverted') {
      return err(new IllegalSettlementTransitionError(this.props.state.value, 'failPermanent'));
    }
    return ok(new Settlement({
      ...this.props,
      state: SettlementState.FAILED_PERMANENT_SETTLEMENT,
    }));
  }
}
