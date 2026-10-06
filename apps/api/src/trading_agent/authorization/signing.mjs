// Mandate signatures (Stage 16).
//
// With TOTP step-up the user holds no signing key, so the signature is a server
// ATTESTATION: HMAC-SHA256 over canonical JSON of {mandateId, termsHash, nonce, signer,
// method, signedAt, keyId}, made only after the authenticated owner passed step-up for
// exactly that terms hash and nonce. The key is injected (KMS-held in production, B-08)
// and identified by keyId so it can rotate. A passkey (WebAuthn) would replace this with
// a user-held-key signature over the same challenge (follow-up; audit 06 S-11).
import { createHmac, timingSafeEqual } from 'node:crypto';
import { MandateError } from './errors.mjs';
import { canonicalJson, contentHash } from '../strategies/canonical.mjs';

export const SIGNATURE_PREFIX = 'hmac-sha256:';

export function assertSigner(signer) {
  if (!signer || typeof signer.keyId !== 'string' || !/^[A-Za-z0-9._-]{1,64}$/.test(signer.keyId)) throw new MandateError('CONFIG', 'signer.keyId required');
  if (!Buffer.isBuffer(signer.secret) || signer.secret.length < 32) throw new MandateError('CONFIG', 'signer.secret must be a Buffer of ≥ 32 bytes');
}

/** What the user approves: shown and echoed back by the client. */
export function signingChallenge({ mandateId, termsHash, nonce }) {
  return contentHash(canonicalJson({ v: 1, purpose: 'satelink.mandate.sign', mandateId, termsHash, nonce }));
}

export function signMandate(signer, statement) {
  assertSigner(signer);
  const body = canonicalJson({ v: 1, ...statement, keyId: signer.keyId });
  return SIGNATURE_PREFIX + createHmac('sha256', signer.secret).update(body, 'utf8').digest('hex');
}

/** Constant-time verification; also refuses a key-id mismatch. */
export function verifyMandateSignature(signer, statement, signature, keyId) {
  if (typeof signature !== 'string' || !signature.startsWith(SIGNATURE_PREFIX) || keyId !== signer.keyId) return false;
  const expected = Buffer.from(signMandate(signer, statement));
  const got = Buffer.from(signature);
  return expected.length === got.length && timingSafeEqual(expected, got);
}

/** Keyed fingerprint of a step-up code, to refuse its reuse (never stores the code). */
export function stepUpFingerprint(signer, userId, code) {
  return createHmac('sha256', signer.secret).update(`stepup|${userId}|${code}`, 'utf8').digest('hex');
}
