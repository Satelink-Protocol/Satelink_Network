import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { Money, USDT } from '@satelink/kernel';
import { CapacitySelector } from './capacity-selector.js';
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
function build(nonceSpecs: Array<{ value: string; after: number; before: number }>, capMinor = 10n ** 18n): Authorization {
  const nonces: AuthorizationNonceInput[] = nonceSpecs.map((s) => ({
    value: must(NonceValue.of(s.value)),
    window: must(ValidityWindow.of(s.after, s.before)),
  }));
  return must(
    Authorization.create({
      id: must(AuthorizationId.of('auth_1')),
      principalId: must(PrincipalId.of('prn_1')),
      fundingSourceId: must(FundingSourceId.of('fs_1')),
      cap: must(Cap.of(Money.fromMinorUnits(capMinor, USDT))),
      window: must(ValidityWindow.of(0, 10 ** 12)),
      signature: must(SignatureEnvelope.of('eip3009', '0xsig', '0xsigner')),
      nonces,
    }),
  );
}

describe('CapacitySelector', () => {
  it('returns null when the authorization is revoked', () => {
    const a = must(build([{ value: 'n0', after: 0, before: 1000 }]).revoke());
    expect(CapacitySelector.select(a, Money.fromMinorUnits(1n, USDT), 500)).toBeNull();
  });

  it('returns null when clock is outside every nonce window', () => {
    const a = build([{ value: 'n0', after: 0, before: 100 }]);
    expect(CapacitySelector.select(a, Money.fromMinorUnits(1n, USDT), 500)).toBeNull();
  });

  it('returns null when amount exceeds available capacity', () => {
    const a = build([{ value: 'n0', after: 0, before: 1000 }], 10n);
    expect(CapacitySelector.select(a, Money.fromMinorUnits(11n, USDT), 500)).toBeNull();
  });

  it('picks the soonest-expiring eligible nonce', () => {
    const a = build([
      { value: 'nA', after: 0, before: 9000 },
      { value: 'nB', after: 0, before: 3000 }, // soonest
      { value: 'nC', after: 0, before: 6000 },
    ]);
    const sel = CapacitySelector.select(a, Money.fromMinorUnits(1n, USDT), 500);
    expect(sel?.value).toBe('nB');
  });

  it('skips already-consumed nonces', () => {
    let a = build([
      { value: 'nB', after: 0, before: 3000 },
      { value: 'nC', after: 0, before: 6000 },
    ]);
    a = must(a.consume({ nonce: must(NonceValue.of('nB')), amount: Money.fromMinorUnits(1n, USDT), clockMs: 500 }));
    const sel = CapacitySelector.select(a, Money.fromMinorUnits(1n, USDT), 500);
    expect(sel?.value).toBe('nC'); // nB consumed, next soonest is nC
  });
});

// ---------------------------------------------------------------------------
// PROPERTY: deterministic, and always the soonest-expiring (tie-break lex).
// ---------------------------------------------------------------------------

describe('CapacitySelector — property: deterministic soonest-expiring [10000 runs]', () => {
  it('same clock + set => same nonce, == min validBefore (tie lex)', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            id: fc.integer({ min: 0, max: 30 }),
            before: fc.integer({ min: 600, max: 100000 }),
          }),
          { minLength: 1, maxLength: 10 },
        ),
        (rows) => {
          // Dedup by id so nonce values are unique.
          const seen = new Set<number>();
          const specs = rows
            .filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)))
            .map((r) => ({ value: `n${r.id}`, after: 0, before: r.before }));
          const a = build(specs);
          const amount = Money.fromMinorUnits(1n, USDT);
          const clock = 500; // within [0, before] for all (before >= 600)

          const s1 = CapacitySelector.select(a, amount, clock);
          const s2 = CapacitySelector.select(a, amount, clock);
          expect(s1?.value ?? null).toBe(s2?.value ?? null); // deterministic

          // Independent expectation: min before, tie-break lex on value.
          const expected = [...specs].sort((x, y) =>
            x.before !== y.before ? x.before - y.before : x.value < y.value ? -1 : x.value > y.value ? 1 : 0,
          )[0]!;
          expect(s1?.value).toBe(expected.value);
        },
      ),
      { numRuns: 10_000 },
    );
  });
});
