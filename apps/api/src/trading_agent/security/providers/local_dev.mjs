// Local key provider (Stage 28, option 1). Wraps each DEK with AES-256-GCM under a 32-byte master
// key held by the process. For development and tests — and, only by explicit founder decision, a
// capped beta (see provider_factory.mjs). It is NOT a KMS: the master key lives in process memory.
// The master key is injected; this module never reads env or disk.
import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';
import { SecurityError } from '../errors.mjs';
import { canonicalContext } from '../envelope.mjs';

export class LocalDevKeyProvider {
  #master; #keyRef;
  /** @param {{ masterKey: Buffer, keyId?: string }} opts */
  constructor({ masterKey, keyId = 'local-dev-1' }) {
    if (!Buffer.isBuffer(masterKey) || masterKey.length !== 32) throw new SecurityError('CONFIG', 'local master key must be a 32-byte Buffer');
    this.#master = Buffer.from(masterKey);
    // the key ref names the key, never the key: id + a short fingerprint
    this.#keyRef = `local:${keyId}:${createHash('sha256').update(this.#master).digest('hex').slice(0, 12)}`;
    this.id = 'local-dev';
  }
  get keyRef() { return this.#keyRef; }

  async generateDataKey({ context }) {
    const plaintextKey = randomBytes(32);
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', this.#master, iv);
    c.setAAD(Buffer.from(`satelink.dek/1|${canonicalContext(context)}`));
    const ct = Buffer.concat([c.update(plaintextKey), c.final()]);
    return { plaintextKey, wrappedKey: Buffer.concat([iv, c.getAuthTag(), ct]), keyRef: this.#keyRef };
  }

  async unwrapDataKey({ wrappedKey, keyRef, context }) {
    if (keyRef !== this.#keyRef) throw new SecurityError('DECRYPT_FAILED', 'data key was wrapped by a different key');
    const w = Buffer.from(wrappedKey);
    if (w.length !== 12 + 16 + 32) throw new SecurityError('DECRYPT_FAILED', 'wrapped key has the wrong length');
    try {
      const d = createDecipheriv('aes-256-gcm', this.#master, w.subarray(0, 12));
      d.setAAD(Buffer.from(`satelink.dek/1|${canonicalContext(context)}`));
      d.setAuthTag(w.subarray(12, 28));
      return Buffer.concat([d.update(w.subarray(28)), d.final()]);
    } catch {
      throw new SecurityError('DECRYPT_FAILED', 'data key failed authentication');
    }
  }
}
