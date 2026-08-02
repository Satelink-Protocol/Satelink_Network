import { describe, it, expect } from 'vitest';
import { PrincipalId } from '../shared/principal-id.js';
import { PrincipalKind } from './principal-kind.js';
import { PrincipalState } from './principal-state.js';
import { ExternalRef } from './external-ref.js';
import { AccountId } from '../account/account-id.js';
import { AccountKind } from '../account/account-kind.js';
import { Normality } from '../account/normality.js';
import { BalanceInvariant } from '../account/balance-invariant.js';
import { AccountState } from '../account/account-state.js';

describe('M4 value objects — of() success & failure', () => {
  it('PrincipalId', () => {
    expect(PrincipalId.of('prn_1').isOk).toBe(true);
    expect(PrincipalId.of('').isErr).toBe(true);
    expect(PrincipalId.of('x'.repeat(201)).isErr).toBe(true);
    const a = PrincipalId.of('p'), b = PrincipalId.of('p'), c = PrincipalId.of('q');
    if (a.isOk && b.isOk && c.isOk) {
      expect(a.value.equals(b.value)).toBe(true);
      expect(a.value.equals(c.value)).toBe(false);
      expect(a.value.toString()).toBe('p');
    }
  });

  it('PrincipalKind — all six valid, others rejected', () => {
    for (const k of ['human', 'agent', 'machine', 'org', 'project', 'platform']) {
      expect(PrincipalKind.of(k).isOk).toBe(true);
    }
    expect(PrincipalKind.of('robot').isErr).toBe(true);
    expect(PrincipalKind.MACHINE.equals(PrincipalKind.MACHINE)).toBe(true);
    expect(PrincipalKind.MACHINE.toString()).toBe('machine');
  });

  it('PrincipalState — all five valid, others rejected; terminal', () => {
    for (const s of ['created', 'active', 'paused', 'suspended', 'closed']) {
      expect(PrincipalState.of(s).isOk).toBe(true);
    }
    expect(PrincipalState.of('zombie').isErr).toBe(true);
    expect(PrincipalState.CLOSED.isTerminal()).toBe(true);
    expect(PrincipalState.ACTIVE.isTerminal()).toBe(false);
    expect(PrincipalState.ACTIVE.toString()).toBe('active');
  });

  it('ExternalRef', () => {
    expect(ExternalRef.of('0xabc').isOk).toBe(true);
    expect(ExternalRef.of('').isErr).toBe(true);
    expect(ExternalRef.of('x'.repeat(257)).isErr).toBe(true);
    const a = ExternalRef.of('r'), b = ExternalRef.of('r');
    if (a.isOk && b.isOk) {
      expect(a.value.equals(b.value)).toBe(true);
      expect(a.value.toString()).toBe('r');
    }
  });

  it('AccountId', () => {
    expect(AccountId.of('acct_1').isOk).toBe(true);
    expect(AccountId.of('').isErr).toBe(true);
    expect(AccountId.of('x'.repeat(201)).isErr).toBe(true);
  });

  it('AccountKind — snake_case only; CAPACITY constant', () => {
    expect(AccountKind.of('capacity').isOk).toBe(true);
    expect(AccountKind.of('revenue_x').isOk).toBe(true);
    expect(AccountKind.of('Capacity').isErr).toBe(true);
    expect(AccountKind.of('1bad').isErr).toBe(true);
    expect(AccountKind.of('').isErr).toBe(true);
    expect(AccountKind.CAPACITY.value).toBe('capacity');
    expect(AccountKind.CAPACITY.equals(AccountKind.CAPACITY)).toBe(true);
  });

  it('Normality', () => {
    expect(Normality.of('debit').isOk).toBe(true);
    expect(Normality.of('credit').isOk).toBe(true);
    expect(Normality.of('sideways').isErr).toBe(true);
    expect(Normality.DEBIT.equals(Normality.CREDIT)).toBe(false);
    expect(Normality.CREDIT.toString()).toBe('credit');
  });

  it('BalanceInvariant', () => {
    for (const v of ['non_negative', 'non_positive', 'unrestricted']) {
      expect(BalanceInvariant.of(v).isOk).toBe(true);
    }
    expect(BalanceInvariant.of('positive').isErr).toBe(true);
    expect(BalanceInvariant.NON_NEGATIVE.toString()).toBe('non_negative');
  });

  it('AccountState — valid set, terminal', () => {
    for (const s of ['open', 'frozen', 'closed']) {
      expect(AccountState.of(s).isOk).toBe(true);
    }
    expect(AccountState.of('melted').isErr).toBe(true);
    expect(AccountState.CLOSED.isTerminal()).toBe(true);
    expect(AccountState.OPEN.isTerminal()).toBe(false);
    expect(AccountState.OPEN.toString()).toBe('open');
  });
});
