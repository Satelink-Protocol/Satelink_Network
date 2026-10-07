// Envelope encryption for broker credentials (Stage 28, option 1).
//
// A fresh 256-bit data key (DEK) per secret encrypts the secret with AES-256-GCM; a KeyProvider
// wraps the DEK. The output maps 1:1 onto broker_credential_ciphertexts (migration 021):
//   { encryption_alg, wrapped_dek, iv, auth_tag, ciphertext } + broker_credentials_metadata.kms_key_ref
// The encryption context (credential id, broker account, principal) is bound twice: as the
// provider's wrap context (KMS EncryptionContext / local AAD) and as the secret's GCM AAD, so a row
// copied to another credential or account fails to decrypt.
//
// KeyProvider contract (see providers/):
//   id: string
//   generateDataKey({ context }) → { plaintextKey: Buffer(32), wrappedKey: Buffer, keyRef: string }
//   unwrapDataKey({ wrappedKey, keyRef, context }) → Buffer(32)
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { SecurityError } from './errors.mjs';

export const ENCRYPTION_ALG = 'AES-256-GCM';

export function assertKeyProvider(p) {
  if (!p || typeof p.id !== 'string' || typeof p.generateDataKey !== 'function' || typeof p.unwrapDataKey !== 'function') {
    throw new SecurityError('CONFIG', 'not a KeyProvider (needs id, generateDataKey, unwrapDataKey)');
  }
  return p;
}

/** Canonical, order-independent context string. Values must be non-empty strings. */
export function canonicalContext(context) {
  const keys = Object.keys(context ?? {}).sort();
  if (keys.length === 0) throw new SecurityError('INVALID', 'encryption context required');
  for (const k of keys) if (typeof context[k] !== 'string' || !context[k]) throw new SecurityError('INVALID', `context.${k} must be a non-empty string`);
  return keys.map((k) => `${k}=${context[k]}`).join('|');
}

const aad = (context) => Buffer.from(`satelink.credential/1|${canonicalContext(context)}`, 'utf8');

/** Encrypt a secret. Returns a row for broker_credential_ciphertexts plus the kms_key_ref. */
export async function sealSecret({ provider, plaintext, context }) {
  assertKeyProvider(provider);
  if (typeof plaintext !== 'string' || plaintext.length === 0) throw new SecurityError('INVALID', 'plaintext must be a non-empty string');
  const { plaintextKey, wrappedKey, keyRef } = await provider.generateDataKey({ context });
  if (!Buffer.isBuffer(plaintextKey) || plaintextKey.length !== 32) throw new SecurityError('PROVIDER', 'provider returned a data key that is not 32 bytes');
  try {
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', plaintextKey, iv);
    c.setAAD(aad(context));
    const ciphertext = Buffer.concat([c.update(plaintext, 'utf8'), c.final()]);
    return Object.freeze({ encryption_alg: ENCRYPTION_ALG, wrapped_dek: Buffer.from(wrappedKey), iv, auth_tag: c.getAuthTag(), ciphertext, kms_key_ref: keyRef, provider: provider.id });
  } finally {
    plaintextKey.fill(0);
  }
}

/** Decrypt a broker_credential_ciphertexts row (+ kms_key_ref). Any tamper → DECRYPT_FAILED. */
export async function openSecret({ provider, row, context }) {
  assertKeyProvider(provider);
  if (row?.encryption_alg !== ENCRYPTION_ALG) throw new SecurityError('INVALID', 'unsupported encryption_alg');
  let dek;
  try {
    dek = await provider.unwrapDataKey({ wrappedKey: Buffer.from(row.wrapped_dek), keyRef: row.kms_key_ref, context });
  } catch (e) {
    if (e instanceof SecurityError && e.code !== 'DECRYPT_FAILED') throw e;
    throw new SecurityError('DECRYPT_FAILED', 'data key could not be unwrapped');
  }
  try {
    const d = createDecipheriv('aes-256-gcm', dek, Buffer.from(row.iv));
    d.setAAD(aad(context));
    d.setAuthTag(Buffer.from(row.auth_tag));
    return Buffer.concat([d.update(Buffer.from(row.ciphertext)), d.final()]).toString('utf8');
  } catch {
    throw new SecurityError('DECRYPT_FAILED', 'credential envelope failed authentication');
  } finally {
    dek.fill(0);
  }
}
