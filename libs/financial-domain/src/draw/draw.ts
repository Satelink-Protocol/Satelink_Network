/**
 * Draw — aggregate root. THE MONEY PATH.
 *
 * A Draw requests, authorizes, settles, and confirms a withdrawal of capacity
 * against a user-held standing authorization. Settlement is an ENTITY inside
 * this root (never a separate aggregate) because the settle-before-credit
 * invariant requires both states to move atomically. Separating them reopens
 * the PR #278 bug.
 *
 * INVARIANTS enforced HERE:
 *   #1 NEVER partially apply. Insufficient capacity → clean reject.
 *       No partial draw exists in any state, ever.
 *   #2 Ledger credits ONLY on settled. While settling, entries are PENDING and
 *       contribute NOTHING to available balance.
 *   #3 Idempotency key uniqueness — same key returns the EXISTING Draw, never
 *       creates a second (enforced by repo UNIQUE constraint + findByIdempotencyKey).
 *   #4 settled is terminal and irreversible. Corrections are new compensating Draws.
 *   #5 confirm() requires confirmations >= requiredConfirmations, read from the
 *       funding source config (Decision A).
 *
 * State machine:
 *   requested → authorized → settling → settled (terminal)
 *   requested → rejected (terminal)
 *   settling  → failed → retrying → settling
 *   retrying  → failed_permanent (terminal)
 *
 * Immutable — every operation returns a new Draw; `version` is bumped by the
 * repository. References other aggregates by Id only (#7).
 */

import type { Currency, Money, Result } from '@satelink/kernel';
import { ok, err } from '@satelink/kernel';
import { DrawId } from './draw-id.js';
import { DrawState } from './draw-state.js';
import type { RejectReason } from './reject-reason.js';
import type { RailTransaction } from './rail-transaction.js';
import { ConfirmationCount } from './confirmation-count.js';
import { Settlement } from './settlement.js';
import type { SettlementView } from './settlement.js';
import { PrincipalId } from '../shared/principal-id.js';
import { AuthorizationId } from '../shared/authorization-id.js';
import { FundingSourceId } from '../shared/funding-source-id.js';
import { AccountId } from '../shared/account-id.js';
import {
  IllegalDrawTransitionError,
  DrawAlreadySettledError,
} from './errors.js';
import type { DrawError } from './errors.js';

export interface DrawProps {
  readonly id: DrawId;
  readonly principalId: PrincipalId;
  readonly authorizationId: AuthorizationId;
  readonly fundingSourceId: FundingSourceId;
  readonly accountId: AccountId;
  readonly amount: Money;
  readonly currency: Currency;
  readonly idempotencyKey: string;
  readonly state: DrawState;
  readonly rejectReason: RejectReason | null;
  readonly settlement: Settlement | null;
  readonly version: number;
  readonly createdAt: number; // epoch ms
}

/** For reconstitution from the repository. */
export interface DrawReconProps extends DrawProps {}

export class Draw {
  private constructor(private readonly props: DrawProps) {
    Object.freeze(this.props);
    Object.freeze(this);
  }

  static create(params: {
    id: DrawId;
    principalId: PrincipalId;
    authorizationId: AuthorizationId;
    fundingSourceId: FundingSourceId;
    accountId: AccountId;
    amount: Money;
    idempotencyKey: string;
    createdAt: number;
  }): Result<Draw, never> {
    return ok(
      new Draw({
        id: params.id,
        principalId: params.principalId,
        authorizationId: params.authorizationId,
        fundingSourceId: params.fundingSourceId,
        accountId: params.accountId,
        amount: params.amount,
        currency: params.amount.currency,
        idempotencyKey: params.idempotencyKey,
        state: DrawState.REQUESTED,
        rejectReason: null,
        settlement: null,
        version: 0,
        createdAt: params.createdAt,
      }),
    );
  }

  static reconstitute(props: DrawReconProps): Draw {
    return new Draw(props);
  }

  // --- Getters ---
  get id(): DrawId { return this.props.id; }
  get principalId(): PrincipalId { return this.props.principalId; }
  get authorizationId(): AuthorizationId { return this.props.authorizationId; }
  get fundingSourceId(): FundingSourceId { return this.props.fundingSourceId; }
  get accountId(): AccountId { return this.props.accountId; }
  get amount(): Money { return this.props.amount; }
  get currency(): Currency { return this.props.currency; }
  get idempotencyKey(): string { return this.props.idempotencyKey; }
  get state(): DrawState { return this.props.state; }
  get rejectReason(): RejectReason | null { return this.props.rejectReason; }
  get version(): number { return this.props.version; }
  get createdAt(): number { return this.props.createdAt; }

  /** Read-only projection of the settlement entity (never escapes the root). */
  get settlementView(): SettlementView | null {
    return this.props.settlement?.toView() ?? null;
  }

  // For the mapper/repo only — not part of the public API
  get _settlement(): Settlement | null {
    return this.props.settlement;
  }

  // --- State transitions ---

  /** requested → authorized. */
  authorize(): Result<Draw, DrawError> {
    if (this.props.state.value !== 'requested') {
      return err(new IllegalDrawTransitionError(this.props.state.value, 'authorize'));
    }
    return ok(new Draw({ ...this.props, state: DrawState.AUTHORIZED }));
  }

  /** requested → rejected (terminal). */
  reject(reason: RejectReason): Result<Draw, DrawError> {
    if (this.props.state.value !== 'requested') {
      return err(new IllegalDrawTransitionError(this.props.state.value, 'reject'));
    }
    return ok(new Draw({
      ...this.props,
      state: DrawState.REJECTED,
      rejectReason: reason,
    }));
  }

  /**
   * authorized → settling. Creates a Settlement(pending) with the required
   * confirmation count from the funding source config (Decision A).
   */
  beginSettlement(requiredConfirmations: ConfirmationCount): Result<Draw, DrawError> {
    if (this.props.state.value !== 'authorized') {
      return err(new IllegalDrawTransitionError(this.props.state.value, 'beginSettlement'));
    }
    return ok(new Draw({
      ...this.props,
      state: DrawState.SETTLING,
      settlement: Settlement.create(requiredConfirmations),
    }));
  }

  /** settling: Settlement pending → submitted. Records the rail transaction. */
  submitSettlement(railTx: RailTransaction): Result<Draw, DrawError> {
    if (this.props.state.value !== 'settling' && this.props.state.value !== 'retrying') {
      return err(new IllegalDrawTransitionError(this.props.state.value, 'submitSettlement'));
    }
    if (!this.props.settlement) {
      return err(new IllegalDrawTransitionError(this.props.state.value, 'submitSettlement (no settlement)'));
    }
    const result = this.props.settlement.submit(railTx);
    if (result.isErr) return result;
    return ok(new Draw({
      ...this.props,
      state: DrawState.SETTLING,
      settlement: result.value,
    }));
  }

  /** settling: Settlement submitted → confirming. Updates confirmation count. */
  addConfirmations(count: ConfirmationCount): Result<Draw, DrawError> {
    if (this.props.state.value !== 'settling') {
      return err(new IllegalDrawTransitionError(this.props.state.value, 'addConfirmations'));
    }
    if (!this.props.settlement) {
      return err(new IllegalDrawTransitionError(this.props.state.value, 'addConfirmations (no settlement)'));
    }
    const result = this.props.settlement.addConfirmations(count);
    if (result.isErr) return result;
    return ok(new Draw({ ...this.props, settlement: result.value }));
  }

  /**
   * settling → settled (terminal). Settlement confirming → confirmed.
   * INVARIANT #4: settled is terminal and irreversible.
   * INVARIANT #5: confirm() requires confirmations >= requiredConfirmations.
   */
  confirmSettlement(count: ConfirmationCount, clockMs: number): Result<Draw, DrawError> {
    if (this.props.state.value !== 'settling') {
      return err(new IllegalDrawTransitionError(this.props.state.value, 'confirmSettlement'));
    }
    if (!this.props.settlement) {
      return err(new IllegalDrawTransitionError(this.props.state.value, 'confirmSettlement (no settlement)'));
    }
    const result = this.props.settlement.confirm(count, clockMs);
    if (result.isErr) return result;
    return ok(new Draw({
      ...this.props,
      state: DrawState.SETTLED,
      settlement: result.value,
    }));
  }

  /** settling → failed. Settlement submitted → reverted. */
  revertSettlement(): Result<Draw, DrawError> {
    if (this.props.state.value !== 'settling') {
      return err(new IllegalDrawTransitionError(this.props.state.value, 'revertSettlement'));
    }
    if (!this.props.settlement) {
      return err(new IllegalDrawTransitionError(this.props.state.value, 'revertSettlement (no settlement)'));
    }
    const result = this.props.settlement.revert();
    if (result.isErr) return result;
    return ok(new Draw({
      ...this.props,
      state: DrawState.FAILED,
      settlement: result.value,
    }));
  }

  /** failed → retrying. Preparing for another attempt. */
  retryDraw(): Result<Draw, DrawError> {
    if (this.props.state.value !== 'failed') {
      return err(new IllegalDrawTransitionError(this.props.state.value, 'retryDraw'));
    }
    return ok(new Draw({ ...this.props, state: DrawState.RETRYING }));
  }

  /** retrying: Settlement reverted → retrying_settlement. */
  retrySettlementStep(): Result<Draw, DrawError> {
    if (this.props.state.value !== 'retrying') {
      return err(new IllegalDrawTransitionError(this.props.state.value, 'retrySettlementStep'));
    }
    if (!this.props.settlement) {
      return err(new IllegalDrawTransitionError(this.props.state.value, 'retrySettlementStep (no settlement)'));
    }
    const result = this.props.settlement.retrySettlement();
    if (result.isErr) return result;
    return ok(new Draw({
      ...this.props,
      state: DrawState.SETTLING,
      settlement: result.value,
    }));
  }

  /** {failed, retrying} → failed_permanent (terminal). */
  failPermanent(): Result<Draw, DrawError> {
    if (this.props.state.value !== 'failed' && this.props.state.value !== 'retrying') {
      return err(new IllegalDrawTransitionError(this.props.state.value, 'failPermanent'));
    }
    let newSettlement = this.props.settlement;
    if (this.props.settlement) {
      const result = this.props.settlement.failPermanent();
      if (result.isErr) return result;
      newSettlement = result.value;
    }
    return ok(new Draw({
      ...this.props,
      state: DrawState.FAILED_PERMANENT,
      settlement: newSettlement,
    }));
  }
}
