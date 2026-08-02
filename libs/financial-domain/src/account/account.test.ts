import { describe, it, expect } from 'vitest';
import { USDT } from '@satelink/kernel';
import { Account } from './account.js';
import { AccountId } from './account-id.js';
import { AccountKind } from './account-kind.js';
import { Normality } from './normality.js';
import { BalanceInvariant } from './balance-invariant.js';
import { PrincipalId } from '../shared/principal-id.js';
import type { AccountStateValue } from './account-state.js';

function aid(v: string): AccountId {
  const r = AccountId.of(v);
  if (r.isErr) throw new Error(r.error.toString());
  return r.value;
}
function pid(v: string): PrincipalId {
  const r = PrincipalId.of(v);
  if (r.isErr) throw new Error(r.error.toString());
  return r.value;
}
function fresh(): Account {
  const r = Account.create({
    id: aid('acct_1'),
    principalId: pid('prn_1'),
    kind: AccountKind.CAPACITY,
    normality: Normality.CREDIT,
    currency: USDT,
    balanceInvariant: BalanceInvariant.NON_NEGATIVE,
  });
  if (r.isErr) throw new Error('create failed');
  return r.value;
}
const ZERO_CTX = { hasNonZeroBalance: false };

function inState(state: AccountStateValue): Account {
  const open = fresh();
  if (state === 'open') return open;
  const frozen = open.freeze();
  if (!frozen.isOk) throw new Error('freeze');
  if (state === 'frozen') return frozen.value;
  const closed = frozen.value.close(ZERO_CTX);
  if (!closed.isOk) throw new Error('close');
  return closed.value;
}

describe('Account — never computes its own balance (structural, invariant #1)', () => {
  it('exposes no balance-computing method on the instance or the class', () => {
    const protoNames = Object.getOwnPropertyNames(Account.prototype);
    const staticNames = Object.getOwnPropertyNames(Account);
    const banned = ['balance', 'getBalance', 'computeBalance', 'currentBalance', 'availableBalance', 'postedBalance'];
    for (const name of [...protoNames, ...staticNames]) {
      expect(banned).not.toContain(name);
    }
    // balanceInvariant is a DECLARATION (a VO), not a computed balance — allowed.
    expect(protoNames).toContain('balanceInvariant');
  });

  it('an account instance has no balance data field', () => {
    const a = fresh();
    expect(Object.prototype.hasOwnProperty.call(a, 'balance')).toBe(false);
    expect((a as unknown as Record<string, unknown>)['balance']).toBeUndefined();
  });
});

describe('Account — natural key is (principalId, kind, currency)', () => {
  it('exposes the uniqueness tuple', () => {
    const key = fresh().naturalKey();
    expect(key.principalId.value).toBe('prn_1');
    expect(key.kind.value).toBe('capacity');
    expect(key.currency.code).toBe('USDT');
  });
});

describe('Account — state machine (exhaustive: every state × every action)', () => {
  const ALL: AccountStateValue[] = ['open', 'frozen', 'closed'];
  const expected: Record<AccountStateValue, Record<string, AccountStateValue | null>> = {
    open: { freeze: 'frozen', unfreeze: null, close: null },
    frozen: { freeze: null, unfreeze: 'open', close: 'closed' },
    closed: { freeze: null, unfreeze: null, close: null },
  };
  const apply = (a: Account, action: string) => {
    switch (action) {
      case 'freeze':
        return a.freeze();
      case 'unfreeze':
        return a.unfreeze();
      case 'close':
        return a.close(ZERO_CTX);
      default:
        throw new Error(action);
    }
  };

  for (const state of ALL) {
    for (const action of ['freeze', 'unfreeze', 'close']) {
      const want = expected[state][action];
      it(`${state} --${action}--> ${want ?? 'ILLEGAL'}`, () => {
        const a = inState(state);
        const r = apply(a, action);
        if (want === null) {
          expect(r.isErr).toBe(true);
          if (r.isErr) expect(r.error.tag).toBe('IllegalAccountTransitionError');
          expect(a.state.value).toBe(state);
        } else {
          expect(r.isOk).toBe(true);
          if (r.isOk) expect(r.value.state.value).toBe(want);
          expect(a.state.value).toBe(state); // original untouched
        }
      });
    }
  }
});

describe('Account — close precondition', () => {
  it('rejects close with a non-zero balance', () => {
    const r = inState('frozen').close({ hasNonZeroBalance: true });
    expect(r.isErr).toBe(true);
    if (r.isErr) expect(r.error.tag).toBe('AccountClosePreconditionError');
  });
  it('accepts close from frozen with zero balance', () => {
    const r = inState('frozen').close(ZERO_CTX);
    expect(r.isOk).toBe(true);
    if (r.isOk) expect(r.value.state.value).toBe('closed');
  });
});
