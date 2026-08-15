/**
 * EnvelopeVerifier — application port. Verifies that a signed authorization
 * envelope was really produced by the claimed signer BEFORE anything is
 * persisted. The x402 "exact" scheme is EIP-3009 `TransferWithAuthorization`
 * (EIP-712) on USDC/Base; the recovered address MUST equal both the claimed
 * `signer` and the message `from`, or verification fails and the caller must
 * never persist the authorization.
 *
 * This port is pure application: no viem, no ethers, no I/O types. The EIP-712
 * recovery lives in an infrastructure adapter.
 */

import type { Result } from '@satelink/kernel';

/** The EIP-712 domain a wallet signed under (USDC token contract on Base). */
export interface EnvelopeDomain {
  readonly name: string;
  readonly version: string;
  readonly chainId: number;
  readonly verifyingContract: string;
}

/** The EIP-3009 TransferWithAuthorization message. Amounts/windows are strings
 * on the wire (JSON-safe) and normalized by the verifier. */
export interface EnvelopeMessage {
  readonly from: string;
  readonly to: string;
  readonly value: string; // USDC minor units (6 decimals), decimal string
  readonly validAfter: string; // epoch SECONDS (EIP-3009 convention)
  readonly validBefore: string; // epoch SECONDS
  readonly nonce: string; // 0x-prefixed bytes32
}

/** The bearer instrument a wallet signs. NEVER log `signature`. */
export interface SignedAuthorizationEnvelope {
  readonly scheme: string; // must be 'exact'
  readonly signature: string; // 0x… — bearer secret
  readonly signer: string; // claimed signer address (== message.from)
  readonly domain: EnvelopeDomain;
  readonly message: EnvelopeMessage;
}

/** Normalized, verified view. Addresses lowercased; amounts as bigint; windows
 * converted to epoch MILLISECONDS (the aggregate/DB convention). */
export interface VerifiedEnvelope {
  readonly scheme: string;
  readonly signer: string; // lowercase 0x address, == recovered == from
  readonly to: string; // lowercase 0x address
  readonly value: bigint; // USDC minor units
  readonly validAfterMs: number;
  readonly validBeforeMs: number;
  readonly nonce: string; // 0x bytes32
  readonly verifyingContract: string; // lowercase
  readonly chainId: number;
}

export class EnvelopeVerificationError {
  readonly tag = 'EnvelopeVerificationError' as const;
  constructor(readonly reason: string) {}
  toString(): string {
    return `EnvelopeVerificationError: ${this.reason}`;
  }
}

export interface EnvelopeVerifier {
  /**
   * Verify signature authenticity + structural validity. Resolves to the
   * normalized VerifiedEnvelope on success, or an error the caller must treat
   * as "reject, persist nothing".
   */
  verify(
    envelope: SignedAuthorizationEnvelope,
  ): Promise<Result<VerifiedEnvelope, EnvelopeVerificationError>>;
}
