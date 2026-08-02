/**
 * FundingSource — aggregate root for a payment rail a Principal can draw against.
 *
 * State machine: registered -> verified -> active <-> degraded -> revoked(terminal).
 * revoke() is a safety action accepted from ANY non-terminal state (#9).
 * Immutable — transitions return a NEW FundingSource; `version` is bumped by the
 * repository. References the owning principal by Id only.
 */

import type { Result } from '@satelink/kernel';
import { ok, err } from '@satelink/kernel';
import { PrincipalId } from '../shared/principal-id.js';
import { FundingSourceId } from '../shared/funding-source-id.js';
import { RailId } from './rail-id.js';
import { RailReference } from './rail-reference.js';
import { FundingMode } from './funding-mode.js';
import { Capabilities } from './capabilities.js';
import { FundingSourceState } from './funding-source-state.js';
import { IllegalFundingSourceTransitionError } from './errors.js';

export interface FundingSourceProps {
  readonly id: FundingSourceId;
  readonly principalId: PrincipalId;
  readonly railId: RailId;
  readonly railReference: RailReference;
  readonly mode: FundingMode;
  readonly capabilities: Capabilities;
  readonly state: FundingSourceState;
  readonly version: number;
}

export class FundingSource {
  private constructor(private readonly props: FundingSourceProps) {
    Object.freeze(this.props);
    Object.freeze(this);
  }

  static create(params: {
    id: FundingSourceId;
    principalId: PrincipalId;
    railId: RailId;
    railReference: RailReference;
    mode: FundingMode;
    capabilities: Capabilities;
  }): Result<FundingSource, never> {
    return ok(
      new FundingSource({
        ...params,
        state: FundingSourceState.REGISTERED,
        version: 0,
      }),
    );
  }

  static reconstitute(props: FundingSourceProps): FundingSource {
    return new FundingSource(props);
  }

  get id(): FundingSourceId {
    return this.props.id;
  }
  get principalId(): PrincipalId {
    return this.props.principalId;
  }
  get railId(): RailId {
    return this.props.railId;
  }
  get railReference(): RailReference {
    return this.props.railReference;
  }
  get mode(): FundingMode {
    return this.props.mode;
  }
  get capabilities(): Capabilities {
    return this.props.capabilities;
  }
  get state(): FundingSourceState {
    return this.props.state;
  }
  get version(): number {
    return this.props.version;
  }

  private withState(state: FundingSourceState): FundingSource {
    return new FundingSource({ ...this.props, state });
  }

  /** registered -> verified. */
  verify(): Result<FundingSource, IllegalFundingSourceTransitionError> {
    if (this.props.state.value !== 'registered') {
      return err(new IllegalFundingSourceTransitionError(this.props.state.value, 'verify'));
    }
    return ok(this.withState(FundingSourceState.VERIFIED));
  }

  /** verified -> active. */
  activate(): Result<FundingSource, IllegalFundingSourceTransitionError> {
    if (this.props.state.value !== 'verified') {
      return err(new IllegalFundingSourceTransitionError(this.props.state.value, 'activate'));
    }
    return ok(this.withState(FundingSourceState.ACTIVE));
  }

  /** active -> degraded (facilitator unreachable; not active, but not deleted). */
  degrade(): Result<FundingSource, IllegalFundingSourceTransitionError> {
    if (this.props.state.value !== 'active') {
      return err(new IllegalFundingSourceTransitionError(this.props.state.value, 'degrade'));
    }
    return ok(this.withState(FundingSourceState.DEGRADED));
  }

  /** degraded -> active. */
  recover(): Result<FundingSource, IllegalFundingSourceTransitionError> {
    if (this.props.state.value !== 'degraded') {
      return err(new IllegalFundingSourceTransitionError(this.props.state.value, 'recover'));
    }
    return ok(this.withState(FundingSourceState.ACTIVE));
  }

  /** Safety action (#9): revoke from ANY non-terminal state. Terminal. */
  revoke(): Result<FundingSource, IllegalFundingSourceTransitionError> {
    if (this.props.state.isTerminal()) {
      return err(new IllegalFundingSourceTransitionError(this.props.state.value, 'revoke'));
    }
    return ok(this.withState(FundingSourceState.REVOKED));
  }
}
