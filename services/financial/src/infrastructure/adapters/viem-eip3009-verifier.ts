/**
 * ViemEip3009Verifier — infrastructure adapter implementing EnvelopeVerifier for
 * the x402 "exact" scheme (EIP-3009 TransferWithAuthorization, EIP-712) using
 * viem. Recovers the signer from the typed data + signature and requires it to
 * equal both the claimed `signer` and the message `from`. Any structural defect
 * or mismatch → EnvelopeVerificationError, so the caller persists nothing.
 *
 * Deliberately self-contained: imports viem only, never apps/api/src/payments/.
 */

import {
  recoverTypedDataAddress,
  isAddress,
  getAddress,
  type Address,
  type Hex,
} from 'viem';
import type { Result } from '@satelink/kernel';
import { ok, err } from '@satelink/kernel';
import type {
  EnvelopeVerifier,
  SignedAuthorizationEnvelope,
  VerifiedEnvelope,
} from '../../application/ports/envelope-verifier.js';
import { EnvelopeVerificationError } from '../../application/ports/envelope-verifier.js';

// EIP-3009 TransferWithAuthorization primary type (as used by USDC / the x402
// "exact" scheme). Field order is significant for the EIP-712 hash.
const TRANSFER_WITH_AUTHORIZATION_TYPES = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
} as const;

const BYTES32_RE = /^0x[0-9a-fA-F]{64}$/;

function parseBigInt(raw: string, field: string): bigint | Error {
  try {
    const v = BigInt(raw);
    if (v < 0n) return new Error(`${field} must be non-negative`);
    return v;
  } catch {
    return new Error(`${field} is not a valid integer: ${raw}`);
  }
}

export class ViemEip3009Verifier implements EnvelopeVerifier {
  async verify(
    envelope: SignedAuthorizationEnvelope,
  ): Promise<Result<VerifiedEnvelope, EnvelopeVerificationError>> {
    const e = envelope;

    if (e.scheme !== 'exact') {
      return err(new EnvelopeVerificationError(`unsupported scheme '${e.scheme}' (expected 'exact')`));
    }
    if (typeof e.signature !== 'string' || !/^0x[0-9a-fA-F]+$/.test(e.signature)) {
      return err(new EnvelopeVerificationError('signature must be a 0x-prefixed hex string'));
    }
    if (!e.message || !e.domain) {
      return err(new EnvelopeVerificationError('envelope missing message or domain'));
    }

    const { from, to, value, validAfter, validBefore, nonce } = e.message;
    for (const [label, addr] of [
      ['signer', e.signer],
      ['message.from', from],
      ['message.to', to],
      ['domain.verifyingContract', e.domain.verifyingContract],
    ] as const) {
      if (typeof addr !== 'string' || !isAddress(addr)) {
        return err(new EnvelopeVerificationError(`${label} is not a valid address`));
      }
    }
    if (typeof nonce !== 'string' || !BYTES32_RE.test(nonce)) {
      return err(new EnvelopeVerificationError('message.nonce must be a 0x bytes32'));
    }

    // Claimed signer must equal from — an EIP-3009 authorization can only move
    // the signer's own funds.
    if (getAddress(e.signer) !== getAddress(from)) {
      return err(new EnvelopeVerificationError('claimed signer does not equal message.from'));
    }

    const valueBig = parseBigInt(value, 'value');
    if (valueBig instanceof Error) return err(new EnvelopeVerificationError(valueBig.message));
    if (valueBig <= 0n) return err(new EnvelopeVerificationError('value must be positive'));
    const vaBig = parseBigInt(validAfter, 'validAfter');
    if (vaBig instanceof Error) return err(new EnvelopeVerificationError(vaBig.message));
    const vbBig = parseBigInt(validBefore, 'validBefore');
    if (vbBig instanceof Error) return err(new EnvelopeVerificationError(vbBig.message));
    if (vaBig > vbBig) {
      return err(new EnvelopeVerificationError('validAfter must be <= validBefore'));
    }
    if (!Number.isInteger(e.domain.chainId) || e.domain.chainId <= 0) {
      return err(new EnvelopeVerificationError('domain.chainId must be a positive integer'));
    }

    let recovered: Address;
    try {
      recovered = await recoverTypedDataAddress({
        domain: {
          name: e.domain.name,
          version: e.domain.version,
          chainId: e.domain.chainId,
          verifyingContract: getAddress(e.domain.verifyingContract),
        },
        types: TRANSFER_WITH_AUTHORIZATION_TYPES,
        primaryType: 'TransferWithAuthorization',
        message: {
          from: getAddress(from),
          to: getAddress(to),
          value: valueBig,
          validAfter: vaBig,
          validBefore: vbBig,
          nonce: nonce as Hex,
        },
        signature: e.signature as Hex,
      });
    } catch (cause) {
      return err(new EnvelopeVerificationError(`signature recovery failed: ${String(cause)}`));
    }

    if (getAddress(recovered) !== getAddress(from)) {
      return err(
        new EnvelopeVerificationError('recovered signer does not match claimed signer/from'),
      );
    }

    // EIP-3009 windows are epoch SECONDS; the aggregate/DB use epoch MS.
    return ok({
      scheme: e.scheme,
      signer: getAddress(from).toLowerCase(),
      to: getAddress(to).toLowerCase(),
      value: valueBig,
      validAfterMs: Number(vaBig) * 1000,
      validBeforeMs: Number(vbBig) * 1000,
      nonce: nonce.toLowerCase(),
      verifyingContract: getAddress(e.domain.verifyingContract).toLowerCase(),
      chainId: e.domain.chainId,
    });
  }
}
