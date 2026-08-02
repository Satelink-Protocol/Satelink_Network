/**
 * Capabilities — what a funding source can do. Immutable value object.
 *
 * settlementLatency is a coarse, closed classification (not a raw duration) so
 * the domain can reason about it without a clock: instant < seconds < minutes <
 * hours < days.
 */

import type { Result } from '@satelink/kernel';
import { ok, err } from '@satelink/kernel';

export type SettlementLatency = 'instant' | 'seconds' | 'minutes' | 'hours' | 'days';

const LATENCIES: readonly SettlementLatency[] = ['instant', 'seconds', 'minutes', 'hours', 'days'];

export interface CapabilitiesProps {
  readonly supportsRecurring: boolean;
  readonly supportsEscrow: boolean;
  readonly supportsRefund: boolean;
  readonly agentCompatible: boolean;
  readonly settlementLatency: SettlementLatency;
  readonly custodial: boolean;
}

export class InvalidCapabilitiesError {
  readonly tag = 'InvalidCapabilitiesError' as const;
  constructor(readonly reason: string) {}
  toString(): string {
    return `InvalidCapabilitiesError: ${this.reason}`;
  }
}

export class Capabilities {
  private constructor(private readonly props: CapabilitiesProps) {
    Object.freeze(this.props);
    Object.freeze(this);
  }

  static of(props: CapabilitiesProps): Result<Capabilities, InvalidCapabilitiesError> {
    if (!(LATENCIES as readonly string[]).includes(props.settlementLatency)) {
      return err(new InvalidCapabilitiesError(`invalid settlementLatency "${props.settlementLatency}"`));
    }
    for (const key of [
      'supportsRecurring',
      'supportsEscrow',
      'supportsRefund',
      'agentCompatible',
      'custodial',
    ] as const) {
      if (typeof props[key] !== 'boolean') {
        return err(new InvalidCapabilitiesError(`${key} must be a boolean`));
      }
    }
    return ok(new Capabilities({ ...props }));
  }

  get supportsRecurring(): boolean {
    return this.props.supportsRecurring;
  }
  get supportsEscrow(): boolean {
    return this.props.supportsEscrow;
  }
  get supportsRefund(): boolean {
    return this.props.supportsRefund;
  }
  get agentCompatible(): boolean {
    return this.props.agentCompatible;
  }
  get settlementLatency(): SettlementLatency {
    return this.props.settlementLatency;
  }
  get custodial(): boolean {
    return this.props.custodial;
  }

  toJSON(): CapabilitiesProps {
    return { ...this.props };
  }
}
