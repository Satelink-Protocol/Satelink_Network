import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { Money, USDT, USDC } from '@satelink/kernel';
import { Authorization } from './authorization.js';
import { AuthorizationId } from './authorization-id.js';
import { Cap } from './cap.js';
import { ValidityWindow } from './validity-window.js';
import { SignatureEnvelope } from './signature-envelope.js';
import { NonceValue } from './nonce-value.js';
import { PrincipalId } from '../shared/principal-id.js';
import { FundingSourceId } from '../shared/funding-source-id.js';
import type { AuthorizationNonceInput } from './authorization-nonce.js';
import type { Result } from '@satelink/kernel';

function must<T, E extends { toString(): string }>(r: Result<T, E>): T {
  if (r.isErr) throw new Error(r.error.toString());
  return r.value;
}
function nv(v: string): NonceValue {
  return must(NonceValue.of(v));
}
function win(after: number, before: number): ValidityWindow {
  return must(ValidityWindow.of(after, before));
}

function buildAuth(params: {
  capMinor: bigint;
  nonces: AuthorizationNonceInput[];
  window?: ValidityWindow;
}): Authorization {
  return must(
    Authorization.create({
      id: must(AuthorizationId.of('auth_1')),
      principalId: must(PrincipalId.of('prn_1')),
      fundingSourceId: must(FundingSourceId.of('fs_1')),
      cap: must(Cap.of(Money.fromMinorUnits(params.capMinor, USDT))),
      window: params.window ?? win(0, 1_000_000_000),
      signature: must(SignatureEnvelope.of('eip3009', '0xsig', '0xsigner')),
      nonces: params.nonces,
    }),
  );
}
function nonces(n: number, window: ValidityWindow): AuthorizationNonceInput[] {
  return Array.from({ length: n }, (_, i) => ({ value: nv(`n${i}`), window }));
}
const USDT_ = (m: bigint) => Money.fromMinorUnits(m, USDT);

// ---------------------------------------------------------------------------
// Core invariants
// ---------------------------------------------------------------------------

describe('Authorization — consume invariants', () => {
  it('double-consuming the same nonce is rejected', () => {
    const a = buildAuth({ capMinor: 1000n, nonces: nonces(2, win(0, 1_000_000)) });
    const first = a.consume({ nonce: nv('n0'), amount: USDT_(100n), clockMs: 500 });
    expect(first.isOk).toBe(true);
    if (!first.isOk) return;
    const second = first.value.consume({ nonce: nv('n0'), amount: USDT_(100n), clockMs: 500 });
    expect(second.isErr).toBe(true);
    if (second.isErr) expect(second.error.tag).toBe('NonceAlreadyConsumedError');
  });

  it('consuming beyond cap is rejected (never partially applied)', () => {
    const a = buildAuth({ capMinor: 150n, nonces: nonces(2, win(0, 1_000_000)) });
    const first = must(a.consume({ nonce: nv('n0'), amount: USDT_(100n), clockMs: 500 }));
    const over = first.consume({ nonce: nv('n1'), amount: USDT_(51n), clockMs: 500 });
    expect(over.isErr).toBe(true);
    if (over.isErr) expect(over.error.tag).toBe('CapExceededError');
    // unchanged: consumed still 100, n1 still unconsumed
    expect(first.consumed.money.amount).toBe(100n);
    expect(first.noncesRemaining()).toBe(1);
  });

  it('unknown nonce is rejected', () => {
    const a = buildAuth({ capMinor: 1000n, nonces: nonces(1, win(0, 1_000_000)) });
    const r = a.consume({ nonce: nv('nX'), amount: USDT_(1n), clockMs: 500 });
    expect(r.isErr).toBe(true);
    if (r.isErr) expect(r.error.tag).toBe('NonceNotFoundError');
  });

  it('currency mismatch is an explicit failure', () => {
    const a = buildAuth({ capMinor: 1000n, nonces: nonces(1, win(0, 1_000_000)) });
    const r = a.consume({ nonce: nv('n0'), amount: Money.fromMinorUnits(1n, USDC), clockMs: 500 });
    expect(r.isErr).toBe(true);
    if (r.isErr) expect(r.error.tag).toBe('ConsumeCurrencyMismatchError');
  });

  it('non-positive consume is rejected', () => {
    const a = buildAuth({ capMinor: 1000n, nonces: nonces(1, win(0, 1_000_000)) });
    const r = a.consume({ nonce: nv('n0'), amount: USDT_(0n), clockMs: 500 });
    expect(r.isErr).toBe(true);
    if (r.isErr) expect(r.error.tag).toBe('NonPositiveConsumeError');
  });

  it('available() = cap - consumed', () => {
    const a = buildAuth({ capMinor: 1000n, nonces: nonces(1, win(0, 1_000_000)) });
    const after = must(a.consume({ nonce: nv('n0'), amount: USDT_(300n), clockMs: 500 }));
    expect(after.available().amount).toBe(700n);
  });
});

// ---------------------------------------------------------------------------
// Window boundaries (nonce window [1000, 2000])
// ---------------------------------------------------------------------------

describe('Authorization — validity window boundaries', () => {
  const window = win(1000, 2000);
  const mk = () => buildAuth({ capMinor: 1000n, nonces: nonces(1, window) });

  it('rejects at validAfter - 1ms', () => {
    const r = mk().consume({ nonce: nv('n0'), amount: USDT_(1n), clockMs: 999 });
    expect(r.isErr).toBe(true);
    if (r.isErr) expect(r.error.tag).toBe('OutsideValidityWindowError');
  });
  it('accepts at validAfter (inclusive)', () => {
    expect(mk().consume({ nonce: nv('n0'), amount: USDT_(1n), clockMs: 1000 }).isOk).toBe(true);
  });
  it('accepts at validBefore (inclusive)', () => {
    expect(mk().consume({ nonce: nv('n0'), amount: USDT_(1n), clockMs: 2000 }).isOk).toBe(true);
  });
  it('rejects at validBefore + 1ms', () => {
    const r = mk().consume({ nonce: nv('n0'), amount: USDT_(1n), clockMs: 2001 });
    expect(r.isErr).toBe(true);
    if (r.isErr) expect(r.error.tag).toBe('OutsideValidityWindowError');
  });
});

// ---------------------------------------------------------------------------
// State machine (exhaustive): active, revoked × consume, revoke
// ---------------------------------------------------------------------------

describe('Authorization — state machine (exhaustive)', () => {
  it('active --consume--> active (state unchanged)', () => {
    const a = buildAuth({ capMinor: 1000n, nonces: nonces(1, win(0, 1_000_000)) });
    const r = a.consume({ nonce: nv('n0'), amount: USDT_(1n), clockMs: 500 });
    expect(r.isOk).toBe(true);
    if (r.isOk) expect(r.value.state.value).toBe('active');
  });
  it('active --revoke--> revoked (#9)', () => {
    const a = buildAuth({ capMinor: 1000n, nonces: nonces(1, win(0, 1_000_000)) });
    const r = a.revoke();
    expect(r.isOk).toBe(true);
    if (r.isOk) expect(r.value.state.value).toBe('revoked');
  });
  it('revoked --consume--> ILLEGAL (AuthorizationRevokedError)', () => {
    const a = must(buildAuth({ capMinor: 1000n, nonces: nonces(1, win(0, 1_000_000)) }).revoke());
    const r = a.consume({ nonce: nv('n0'), amount: USDT_(1n), clockMs: 500 });
    expect(r.isErr).toBe(true);
    if (r.isErr) expect(r.error.tag).toBe('AuthorizationRevokedError');
  });
  it('revoked --revoke--> ILLEGAL (terminal)', () => {
    const a = must(buildAuth({ capMinor: 1000n, nonces: nonces(1, win(0, 1_000_000)) }).revoke());
    const r = a.revoke();
    expect(r.isErr).toBe(true);
    if (r.isErr) expect(r.error.tag).toBe('IllegalAuthorizationTransitionError');
  });
});

// ---------------------------------------------------------------------------
// PROPERTY: for ANY sequence of consumes, consumed <= cap and consumed never
// decreases.
// ---------------------------------------------------------------------------

describe('Authorization — property: consumed <= cap and monotonic non-decreasing', () => {
  it('[10000 runs]', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 1n, max: 10n ** 9n }),
        fc.array(
          fc.record({ idx: fc.integer({ min: 0, max: 9 }), amt: fc.bigInt({ min: 1n, max: 10n ** 9n }) }),
          { maxLength: 25 },
        ),
        (capMinor, ops) => {
          let a = buildAuth({ capMinor, nonces: nonces(10, win(0, 1_000_000)) });
          let prev = 0n;
          for (const op of ops) {
            const r = a.consume({ nonce: nv(`n${op.idx}`), amount: USDT_(op.amt), clockMs: 500 });
            if (r.isOk) {
              a = r.value;
              const consumed = a.consumed.money.amount;
              expect(consumed <= capMinor).toBe(true);
              expect(consumed >= prev).toBe(true);
              prev = consumed;
            } else {
              expect(a.consumed.money.amount).toBe(prev);
            }
          }
        },
      ),
      { numRuns: 10_000 },
    );
  });
});
