import type { FundingSourceStateValue } from './funding-source-state.js';

export class IllegalFundingSourceTransitionError {
  readonly tag = 'IllegalFundingSourceTransitionError' as const;
  constructor(
    readonly from: FundingSourceStateValue,
    readonly action: string,
  ) {}
  toString(): string {
    return `IllegalFundingSourceTransitionError: cannot ${this.action} from state "${this.from}"`;
  }
}
