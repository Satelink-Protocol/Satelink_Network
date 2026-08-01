import { describe, it, expect } from 'vitest';
import { Money, USDT, USDC } from '@satelink/kernel';
import { Principal } from './principal.js';
import { PrincipalId } from '../shared/principal-id.js';
import { PrincipalKind } from './principal-kind.js';
import type { PrincipalStateValue } from './principal-state.js';

function pid(v: string): PrincipalId {
  const r = PrincipalId.of(v);
  if (r.isErr) throw new Error(r.error.toString());
  return r.value;
}
function fresh(): Principal {
  const r = Principal.create({ id: pid('prn_1'), kind: PrincipalKind.MACHINE });
  if (r.isErr) throw new Error('create failed');
  return r.value;
}
const ZERO_CTX = { openReservations: 0, hasNonZeroBalance: false };

/** Build a principal in each state via the legal happy path. */
function inState(state: PrincipalStateValue): Principal {
  const created = fresh();
  if (state === 'created') return created;
  const active = created.activate();
  if (!active.isOk) throw new Error('activate');
  if (state === 'active') return active.value;
  const paused = active.value.pause();
  if (!paused.isOk) throw new Error('pause');
  if (state === 'paused') return paused.value;
  const suspended = paused.value.suspend();
  if (!suspended.isOk) throw new Error('suspend');
  if (state === 'suspended') return suspended.value;
  const closed = suspended.value.close(ZERO_CTX);
  if (!closed.isOk) throw new Error('close');
  return closed.value;
}

describe('Principal — state machine (exhaustive: every state × every action)', () => {
  const ALL: PrincipalStateValue[] = ['created', 'active', 'paused', 'suspended', 'closed'];

  // expected[state][action] = resulting state, or null if the action is illegal.
  const expected: Record<PrincipalStateValue, Record<string, PrincipalStateValue | null>> = {
    created: { activate: 'active', pause: 'paused', resume: null, suspend: null, close: null },
    active: { activate: null, pause: 'paused', resume: null, suspend: null, close: null },
    paused: { activate: null, pause: 'paused', resume: 'active', suspend: 'suspended', close: null },
    suspended: { activate: null, pause: 'paused', resume: null, suspend: null, close: 'closed' },
    closed: { activate: null, pause: null, resume: null, suspend: null, close: null },
  };

  const apply = (p: Principal, action: string) => {
    switch (action) {
      case 'activate':
        return p.activate();
      case 'pause':
        return p.pause();
      case 'resume':
        return p.resume();
      case 'suspend':
        return p.suspend();
      case 'close':
        return p.close(ZERO_CTX);
      default:
        throw new Error(`unknown action ${action}`);
    }
  };

  for (const state of ALL) {
    for (const action of ['activate', 'pause', 'resume', 'suspend', 'close']) {
      const want = expected[state][action];
      it(`${state} --${action}--> ${want ?? 'ILLEGAL'}`, () => {
        const p = inState(state);
        const r = apply(p, action);
        if (want === null) {
          expect(r.isErr).toBe(true);
          if (r.isErr) expect(r.error.tag).toBe('IllegalPrincipalTransitionError');
          // original unchanged (immutability)
          expect(p.state.value).toBe(state);
        } else {
          expect(r.isOk).toBe(true);
          if (r.isOk) expect(r.value.state.value).toBe(want);
          expect(p.state.value).toBe(state); // original untouched
        }
      });
    }
  }
});

describe('Principal — pause is always available (#9), never permission-gated', () => {
  it('pause() takes no permission argument and succeeds from every non-terminal state', () => {
    expect(Principal.prototype.pause.length).toBe(0); // no permission param
    for (const s of ['created', 'active', 'paused', 'suspended'] as PrincipalStateValue[]) {
      const r = inState(s).pause();
      expect(r.isOk, `pause from ${s}`).toBe(true);
      if (r.isOk) expect(r.value.state.value).toBe('paused');
    }
  });
  it('pause() fails only from the terminal (closed) state', () => {
    expect(inState('closed').pause().isErr).toBe(true);
  });
});

describe('Principal — close precondition (given state passed in)', () => {
  it('rejects close with open reservations', () => {
    const r = inState('suspended').close({ openReservations: 2, hasNonZeroBalance: false });
    expect(r.isErr).toBe(true);
    if (r.isErr) expect(r.error.tag).toBe('PrincipalClosePreconditionError');
  });
  it('rejects close with a non-zero balance', () => {
    const r = inState('suspended').close({ openReservations: 0, hasNonZeroBalance: true });
    expect(r.isErr).toBe(true);
    if (r.isErr) expect(r.error.tag).toBe('PrincipalClosePreconditionError');
  });
  it('accepts close with zero reservations and zero balance', () => {
    const r = inState('suspended').close(ZERO_CTX);
    expect(r.isOk).toBe(true);
    if (r.isOk) expect(r.value.state.value).toBe('closed');
  });
});

describe('Principal — child capacity never exceeds parent', () => {
  const p = fresh();
  it('allows child <= parent', () => {
    const r = p.assertChildCapacityWithinParent(
      Money.fromMinorUnits(1000n, USDT),
      Money.fromMinorUnits(1000n, USDT),
    );
    expect(r.isOk).toBe(true);
  });
  it('rejects child > parent', () => {
    const r = p.assertChildCapacityWithinParent(
      Money.fromMinorUnits(1000n, USDT),
      Money.fromMinorUnits(1001n, USDT),
    );
    expect(r.isErr).toBe(true);
    if (r.isErr) expect(r.error.tag).toBe('ChildCapacityExceedsParentError');
  });
  it('rejects a currency mismatch rather than silently comparing', () => {
    const r = p.assertChildCapacityWithinParent(
      Money.fromMinorUnits(1000n, USDT),
      Money.fromMinorUnits(1n, USDC),
    );
    expect(r.isErr).toBe(true);
  });
});
