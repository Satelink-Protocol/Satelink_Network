/**
 * Principal — aggregate root for an identity in the financial domain.
 *
 * State machine: created -> active <-> paused -> suspended -> closed(terminal),
 * with the safety override (#9): pause() is available from ANY non-terminal
 * state and is never permission-gated.
 *
 * Immutable: every transition returns a NEW Principal. The `version` field is
 * carried for optimistic locking and is bumped by the repository on save, not
 * by transitions. References other aggregates (parent) by Id only.
 */

import type { Money, Result } from '@satelink/kernel';
import { ok, err } from '@satelink/kernel';
import { PrincipalId } from '../shared/principal-id.js';
import { PrincipalKind } from './principal-kind.js';
import { PrincipalState } from './principal-state.js';
import { Hierarchy } from './hierarchy.js';
import { ExternalRef } from './external-ref.js';
import {
  IllegalPrincipalTransitionError,
  PrincipalClosePreconditionError,
  ChildCapacityExceedsParentError,
} from './errors.js';

/** Context the aggregate needs to decide close() — supplied by the app layer. */
export interface PrincipalCloseContext {
  readonly openReservations: number;
  readonly hasNonZeroBalance: boolean;
}

export interface PrincipalProps {
  readonly id: PrincipalId;
  readonly kind: PrincipalKind;
  readonly hierarchy: Hierarchy;
  readonly externalRef: ExternalRef | undefined;
  readonly displayName: string | undefined;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly state: PrincipalState;
  readonly version: number;
}

export class Principal {
  private constructor(private readonly props: PrincipalProps) {
    Object.freeze(this.props);
    Object.freeze(this);
  }

  static create(params: {
    id: PrincipalId;
    kind: PrincipalKind;
    hierarchy?: Hierarchy;
    externalRef?: ExternalRef | undefined;
    displayName?: string | undefined;
    metadata?: Readonly<Record<string, unknown>>;
  }): Result<Principal, never> {
    return ok(
      new Principal({
        id: params.id,
        kind: params.kind,
        hierarchy: params.hierarchy ?? Hierarchy.root(),
        externalRef: params.externalRef,
        displayName: params.displayName,
        metadata: params.metadata ?? {},
        state: PrincipalState.CREATED,
        version: 0,
      }),
    );
  }

  /** Rebuild from persisted state (repository use). */
  static reconstitute(props: PrincipalProps): Principal {
    return new Principal(props);
  }

  get id(): PrincipalId {
    return this.props.id;
  }
  get kind(): PrincipalKind {
    return this.props.kind;
  }
  get hierarchy(): Hierarchy {
    return this.props.hierarchy;
  }
  get externalRef(): ExternalRef | undefined {
    return this.props.externalRef;
  }
  get displayName(): string | undefined {
    return this.props.displayName;
  }
  get metadata(): Readonly<Record<string, unknown>> {
    return this.props.metadata;
  }
  get state(): PrincipalState {
    return this.props.state;
  }
  get version(): number {
    return this.props.version;
  }

  private withState(state: PrincipalState): Principal {
    return new Principal({ ...this.props, state });
  }

  // -------------------------------------------------------------------------
  // Transitions
  // -------------------------------------------------------------------------

  /** created -> active. */
  activate(): Result<Principal, IllegalPrincipalTransitionError> {
    if (this.props.state.value !== 'created') {
      return err(new IllegalPrincipalTransitionError(this.props.state.value, 'activate'));
    }
    return ok(this.withState(PrincipalState.ACTIVE));
  }

  /**
   * pause — the safety action. Available from ANY non-terminal state and NEVER
   * permission-gated (#9). Idempotent when already paused.
   */
  pause(): Result<Principal, IllegalPrincipalTransitionError> {
    if (this.props.state.isTerminal()) {
      return err(new IllegalPrincipalTransitionError(this.props.state.value, 'pause'));
    }
    return ok(this.withState(PrincipalState.PAUSED));
  }

  /** paused -> active. */
  resume(): Result<Principal, IllegalPrincipalTransitionError> {
    if (this.props.state.value !== 'paused') {
      return err(new IllegalPrincipalTransitionError(this.props.state.value, 'resume'));
    }
    return ok(this.withState(PrincipalState.ACTIVE));
  }

  /** paused -> suspended. */
  suspend(): Result<Principal, IllegalPrincipalTransitionError> {
    if (this.props.state.value !== 'paused') {
      return err(new IllegalPrincipalTransitionError(this.props.state.value, 'suspend'));
    }
    return ok(this.withState(PrincipalState.SUSPENDED));
  }

  /**
   * suspended -> closed. Terminal. Precondition (enforced here, given the state
   * passed in): zero open reservations AND zero non-zero balances.
   */
  close(
    ctx: PrincipalCloseContext,
  ): Result<Principal, IllegalPrincipalTransitionError | PrincipalClosePreconditionError> {
    if (this.props.state.value !== 'suspended') {
      return err(new IllegalPrincipalTransitionError(this.props.state.value, 'close'));
    }
    if (ctx.openReservations > 0) {
      return err(
        new PrincipalClosePreconditionError(
          `cannot close: ${ctx.openReservations} open reservation(s)`,
        ),
      );
    }
    if (ctx.hasNonZeroBalance) {
      return err(new PrincipalClosePreconditionError('cannot close: non-zero balance remains'));
    }
    return ok(this.withState(PrincipalState.CLOSED));
  }

  // -------------------------------------------------------------------------
  // Capacity guard (pure) — a child can never hold more than its parent.
  // Modeled as a guard "given the state passed in" so it needs no capacity
  // storage in M4; M5 supplies the amounts.
  // -------------------------------------------------------------------------

  assertChildCapacityWithinParent(
    parentHeld: Money,
    childRequested: Money,
  ): Result<void, ChildCapacityExceedsParentError> {
    const gt = childRequested.greaterThan(parentHeld);
    if (gt.isErr) {
      // currency mismatch — cannot compare, so cannot be "within".
      return err(
        new ChildCapacityExceedsParentError(
          parentHeld.toString(),
          childRequested.toString(),
        ),
      );
    }
    if (gt.value) {
      return err(
        new ChildCapacityExceedsParentError(
          parentHeld.toDecimalString(),
          childRequested.toDecimalString(),
        ),
      );
    }
    return ok(undefined);
  }
}
