import { describe, it, expect } from 'vitest';
import {
  Authorization,
  AuthorizationId,
  PrincipalId,
  FundingSourceId,
  Cap,
  ValidityWindow,
  SignatureEnvelope,
} from '@satelink/financial-domain';
import { Money, USDT } from '@satelink/kernel';
import type { Result } from '@satelink/kernel';

import { authorizeDrawRequest } from './draw-authorizer.js';
import { RejectReason } from '../draw/reject-reason.js';

// Since FundingSource is complex to construct fully, we can use a mock that
// fulfills the interface for the test. We only care about state.value.
const mockFundingSourceActive = { state: { value: 'active' } } as any;
const mockFundingSourceRevoked = { state: { value: 'revoked' } } as any;

function must<T, E extends { toString(): string }>(r: Result<T, E>): T {
  if (r.isErr) throw new Error(r.error.toString());
  return r.value;
}

function newAuth(capMinor: bigint): Authorization {
  return must(
    Authorization.create({
      id: must(AuthorizationId.of('auth_1')),
      principalId: must(PrincipalId.of('prn_1')),
      fundingSourceId: must(FundingSourceId.of('fs_1')),
      cap: must(Cap.of(Money.fromMinorUnits(capMinor, USDT))),
      window: must(ValidityWindow.of(0, 1_000_000)),
      signature: must(SignatureEnvelope.of('eip3009', '0xsig', '0xsigner')),
      nonces: [], // we don't need nonces for capacity check
    }),
  );
}

describe('DrawAuthorizer', () => {
  it('authorizes a valid request within capacity', () => {
    const auth = newAuth(1000n);
    const amount = Money.fromMinorUnits(500n, USDT);
    const result = authorizeDrawRequest(auth, mockFundingSourceActive, amount);
    expect(result.isOk).toBe(true);
  });

  it('rejects if funding source is inactive', () => {
    const auth = newAuth(1000n);
    const amount = Money.fromMinorUnits(500n, USDT);
    const result = authorizeDrawRequest(auth, mockFundingSourceRevoked, amount);
    expect(result.isErr).toBe(true);
    if (result.isErr) {
      expect(result.error.value).toBe('funding_source_inactive');
    }
  });

  it('rejects if authorization is revoked', () => {
    let auth = newAuth(1000n);
    auth = must(auth.revoke());
    const amount = Money.fromMinorUnits(500n, USDT);
    const result = authorizeDrawRequest(auth, mockFundingSourceActive, amount);
    expect(result.isErr).toBe(true);
    if (result.isErr) {
      expect(result.error.value).toBe('authorization_revoked');
    }
  });

  it('rejects if amount exceeds capacity', () => {
    const auth = newAuth(1000n);
    const amount = Money.fromMinorUnits(1500n, USDT);
    const result = authorizeDrawRequest(auth, mockFundingSourceActive, amount);
    expect(result.isErr).toBe(true);
    if (result.isErr) {
      expect(result.error.value).toBe('cap_exceeded');
    }
  });

  it('rejects non-positive amount (insufficient capacity)', () => {
    const auth = newAuth(1000n);
    const amount = Money.fromMinorUnits(0n, USDT);
    const result = authorizeDrawRequest(auth, mockFundingSourceActive, amount);
    expect(result.isErr).toBe(true);
    if (result.isErr) {
      expect(result.error.value).toBe('insufficient_capacity');
    }
  });
});
