/**
 * SignatureEnvelope — the OPAQUE signature material that backs an authorization
 * (e.g. an EIP-3009/EIP-712 signature: scheme + signature + signer). The domain
 * stores and compares it but never verifies it (verification is an adapter's job).
 */

import type { Result } from '@satelink/kernel';
import { ok, err } from '@satelink/kernel';

export class InvalidSignatureEnvelopeError {
  readonly tag = 'InvalidSignatureEnvelopeError' as const;
  constructor(readonly reason: string) {}
  toString(): string {
    return `InvalidSignatureEnvelopeError: ${this.reason}`;
  }
}

export class SignatureEnvelope {
  private constructor(
    readonly scheme: string,
    readonly signature: string,
    readonly signer: string,
  ) {
    Object.freeze(this);
  }

  static of(
    scheme: string,
    signature: string,
    signer: string,
  ): Result<SignatureEnvelope, InvalidSignatureEnvelopeError> {
    if (typeof scheme !== 'string' || scheme.trim().length === 0) {
      return err(new InvalidSignatureEnvelopeError('scheme must be a non-empty string'));
    }
    if (typeof signature !== 'string' || signature.trim().length === 0) {
      return err(new InvalidSignatureEnvelopeError('signature must be a non-empty string'));
    }
    if (typeof signer !== 'string' || signer.trim().length === 0) {
      return err(new InvalidSignatureEnvelopeError('signer must be a non-empty string'));
    }
    return ok(new SignatureEnvelope(scheme, signature, signer));
  }

  equals(other: SignatureEnvelope): boolean {
    return (
      this.scheme === other.scheme &&
      this.signature === other.signature &&
      this.signer === other.signer
    );
  }

  toJSON(): { scheme: string; signature: string; signer: string } {
    return { scheme: this.scheme, signature: this.signature, signer: this.signer };
  }
}
