import { describe, it, expect } from 'vitest';
import { FundingSource } from './funding-source.js';
import { FundingSourceId } from '../shared/funding-source-id.js';
import { PrincipalId } from '../shared/principal-id.js';
import { RailId } from './rail-id.js';
import { RailReference } from './rail-reference.js';
import { FundingMode } from './funding-mode.js';
import { Capabilities } from './capabilities.js';
import type { FundingSourceStateValue } from './funding-source-state.js';
import type { Result } from '@satelink/kernel';

function must<T, E extends { toString(): string }>(r: Result<T, E>): T {
  if (r.isErr) throw new Error(r.error.toString());
  return r.value;
}
function fresh(): FundingSource {
  return must(
    FundingSource.create({
      id: must(FundingSourceId.of('fs_1')),
      principalId: must(PrincipalId.of('prn_1')),
      railId: must(RailId.of('x402-base-usdc')),
      railReference: must(RailReference.of('facilitator', '0xabc')),
      mode: FundingMode.AUTHORIZATION,
      capabilities: must(
        Capabilities.of({
          supportsRecurring: true,
          supportsEscrow: false,
          supportsRefund: false,
          agentCompatible: true,
          settlementLatency: 'instant',
          custodial: false,
        }),
      ),
    }),
  );
}

function inState(state: FundingSourceStateValue): FundingSource {
  const registered = fresh();
  if (state === 'registered') return registered;
  const verified = must(registered.verify());
  if (state === 'verified') return verified;
  const active = must(verified.activate());
  if (state === 'active') return active;
  const degraded = must(active.degrade());
  if (state === 'degraded') return degraded;
  return must(degraded.revoke());
}

describe('FundingSource — state machine (exhaustive)', () => {
  const ALL: FundingSourceStateValue[] = ['registered', 'verified', 'active', 'degraded', 'revoked'];
  const expected: Record<FundingSourceStateValue, Record<string, FundingSourceStateValue | null>> = {
    registered: { verify: 'verified', activate: null, degrade: null, recover: null, revoke: 'revoked' },
    verified: { verify: null, activate: 'active', degrade: null, recover: null, revoke: 'revoked' },
    active: { verify: null, activate: null, degrade: 'degraded', recover: null, revoke: 'revoked' },
    degraded: { verify: null, activate: null, degrade: null, recover: 'active', revoke: 'revoked' },
    revoked: { verify: null, activate: null, degrade: null, recover: null, revoke: null },
  };
  const apply = (fs: FundingSource, action: string) => {
    switch (action) {
      case 'verify': return fs.verify();
      case 'activate': return fs.activate();
      case 'degrade': return fs.degrade();
      case 'recover': return fs.recover();
      case 'revoke': return fs.revoke();
      default: throw new Error(action);
    }
  };
  for (const state of ALL) {
    for (const action of ['verify', 'activate', 'degrade', 'recover', 'revoke']) {
      const want = expected[state][action];
      it(`${state} --${action}--> ${want ?? 'ILLEGAL'}`, () => {
        const fs = inState(state);
        const r = apply(fs, action);
        if (want === null) {
          expect(r.isErr).toBe(true);
          expect(fs.state.value).toBe(state);
        } else {
          expect(r.isOk).toBe(true);
          if (r.isOk) expect(r.value.state.value).toBe(want);
          expect(fs.state.value).toBe(state);
        }
      });
    }
  }
});

describe('FundingSource — degraded is expressible; revoke from every non-terminal (#9)', () => {
  it('degraded is a real state distinct from revoked', () => {
    const d = inState('degraded');
    expect(d.state.value).toBe('degraded');
    expect(d.state.isTerminal()).toBe(false);
  });
  it('revoke succeeds from every non-terminal state', () => {
    for (const s of ['registered', 'verified', 'active', 'degraded'] as FundingSourceStateValue[]) {
      const r = inState(s).revoke();
      expect(r.isOk, `revoke from ${s}`).toBe(true);
      if (r.isOk) expect(r.value.state.value).toBe('revoked');
    }
    expect(inState('revoked').revoke().isErr).toBe(true);
  });
});
