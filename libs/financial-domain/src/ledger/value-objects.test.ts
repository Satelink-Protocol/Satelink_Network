import { describe, it, expect } from 'vitest';
import { TxnId } from './txn-id.js';
import { AccountRef } from './account-ref.js';
import { Direction } from './direction.js';
import { EntryState } from './entry-state.js';
import { SourceReference } from './source-reference.js';

describe('TxnId', () => {
  it('accepts a valid id and round-trips', () => {
    const r = TxnId.of('txn_1');
    const same = TxnId.of('txn_1');
    const other = TxnId.of('txn_2');
    expect(r.isOk && same.isOk && other.isOk).toBe(true);
    if (r.isOk && same.isOk && other.isOk) {
      expect(r.value.value).toBe('txn_1');
      expect(r.value.toString()).toBe('txn_1');
      expect(r.value.equals(same.value)).toBe(true);
      expect(r.value.equals(other.value)).toBe(false);
    }
  });
  it('rejects empty', () => {
    expect(TxnId.of('').isErr).toBe(true);
    expect(TxnId.of('   ').isErr).toBe(true);
  });
  it('rejects over-long', () => {
    expect(TxnId.of('x'.repeat(201)).isErr).toBe(true);
  });
});

describe('AccountRef', () => {
  it('accepts and compares', () => {
    const a = AccountRef.of('acct_a');
    const b = AccountRef.of('acct_a');
    const c = AccountRef.of('acct_b');
    expect(a.isOk && b.isOk && c.isOk).toBe(true);
    if (a.isOk && b.isOk && c.isOk) {
      expect(a.value.equals(b.value)).toBe(true);
      expect(a.value.equals(c.value)).toBe(false);
      expect(a.value.toString()).toBe('acct_a');
    }
  });
  it('rejects empty and over-long', () => {
    expect(AccountRef.of('').isErr).toBe(true);
    expect(AccountRef.of('a'.repeat(201)).isErr).toBe(true);
  });
});

describe('Direction', () => {
  it('parses known values and rejects unknown', () => {
    expect(Direction.of('debit').isOk).toBe(true);
    expect(Direction.of('credit').isOk).toBe(true);
    expect(Direction.of('sideways').isErr).toBe(true);
  });
  it('opposite flips, isDebit/isCredit, equals', () => {
    expect(Direction.DEBIT.opposite().equals(Direction.CREDIT)).toBe(true);
    expect(Direction.CREDIT.opposite().equals(Direction.DEBIT)).toBe(true);
    expect(Direction.DEBIT.isDebit()).toBe(true);
    expect(Direction.DEBIT.isCredit()).toBe(false);
    expect(Direction.CREDIT.isCredit()).toBe(true);
    expect(Direction.DEBIT.toString()).toBe('debit');
  });
});

describe('EntryState', () => {
  it('parses all three and rejects unknown', () => {
    expect(EntryState.of('pending').isOk).toBe(true);
    expect(EntryState.of('posted').isOk).toBe(true);
    expect(EntryState.of('voided').isOk).toBe(true);
    expect(EntryState.of('nope').isErr).toBe(true);
  });
  it('predicates and equals', () => {
    expect(EntryState.PENDING.isPending()).toBe(true);
    expect(EntryState.POSTED.isPosted()).toBe(true);
    expect(EntryState.VOIDED.isVoided()).toBe(true);
    expect(EntryState.POSTED.isPending()).toBe(false);
    expect(EntryState.POSTED.equals(EntryState.POSTED)).toBe(true);
    expect(EntryState.POSTED.toString()).toBe('posted');
  });
});

describe('SourceReference', () => {
  it('holds opaque strings and compares', () => {
    const a = SourceReference.of('revenue_event', 'ev_1');
    const b = SourceReference.of('revenue_event', 'ev_1');
    const c = SourceReference.of('revenue_event', 'ev_2');
    expect(a.isOk && b.isOk && c.isOk).toBe(true);
    if (a.isOk && b.isOk && c.isOk) {
      expect(a.value.equals(b.value)).toBe(true);
      expect(a.value.equals(c.value)).toBe(false);
      expect(a.value.refType).toBe('revenue_event');
      expect(a.value.refId).toBe('ev_1');
      expect(a.value.toString()).toBe('revenue_event:ev_1');
    }
  });
  it('rejects empty refType or refId', () => {
    expect(SourceReference.of('', 'x').isErr).toBe(true);
    expect(SourceReference.of('x', '').isErr).toBe(true);
  });
});
