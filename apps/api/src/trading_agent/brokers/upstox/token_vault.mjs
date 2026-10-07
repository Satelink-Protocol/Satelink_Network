// Per-user encrypted token storage (Stage 22). AES-256-GCM envelopes; the additional authenticated
// data binds each ciphertext to ONE principal + broker account + expiry, so a token row copied to
// another user (or with an edited expiry) fails to decrypt. Keys come from an injected keyring
// (KMS-backed in production — B-08; a local test key in dev). The store is a port: the in-memory
// store is for tests; no Postgres table is written in this stage (credential ciphertext writes
// stay blocked by B-08 / B-09).
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { BrokerError, BrokerErrorCode } from '../errors.mjs';

const aad = (principalId, brokerAccountId, expiresAt) => Buffer.from(`satelink.upstox.token/1|${principalId}|${brokerAccountId}|${expiresAt}`, 'utf8');

export function sealToken({ keyring, principalId, brokerAccountId, token, expiresAt }) {
  const { keyId, key } = keyring.current();
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new BrokerError(BrokerErrorCode.INTERNAL, { venue: 'upstox', message: 'token key must be 32 bytes' });
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(aad(principalId, brokerAccountId, expiresAt));
  const ct = Buffer.concat([c.update(String(token), 'utf8'), c.final()]);
  return Object.freeze({ v: 1, alg: 'A256GCM', kid: keyId, iv: iv.toString('base64'), ct: ct.toString('base64'), tag: c.getAuthTag().toString('base64'), principalId, brokerAccountId, expiresAt });
}

export function openToken({ keyring, envelope, principalId, brokerAccountId }) {
  if (envelope?.principalId !== principalId || envelope?.brokerAccountId !== brokerAccountId) throw new BrokerError(BrokerErrorCode.AUTH_FAILED, { venue: 'upstox', message: 'token envelope belongs to another user or account' });
  const key = keyring.byId(envelope.kid);
  if (!key) throw new BrokerError(BrokerErrorCode.AUTH_FAILED, { venue: 'upstox', message: 'token key not available' });
  try {
    const d = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
    d.setAAD(aad(principalId, brokerAccountId, envelope.expiresAt));
    d.setAuthTag(Buffer.from(envelope.tag, 'base64'));
    return Buffer.concat([d.update(Buffer.from(envelope.ct, 'base64')), d.final()]).toString('utf8');
  } catch {
    throw new BrokerError(BrokerErrorCode.AUTH_FAILED, { venue: 'upstox', message: 'token envelope failed authentication' });
  }
}

export class InMemoryTokenStore {
  #rows = new Map();
  async put(env) { this.#rows.set(`${env.principalId}\u0000${env.brokerAccountId}`, structuredClone(env)); }
  async get(principalId, brokerAccountId) { const r = this.#rows.get(`${principalId}\u0000${brokerAccountId}`); return r ? structuredClone(r) : null; }
  async delete(principalId, brokerAccountId) { this.#rows.delete(`${principalId}\u0000${brokerAccountId}`); }
  /** test helper: raw rows (ciphertext only) */
  dump() { return [...this.#rows.values()].map((r) => structuredClone(r)); }
}

export class TokenVault {
  #store; #keyring; #clock;
  constructor({ store, keyring, clock = () => new Date() }) {
    if (!store || typeof keyring?.current !== 'function' || typeof keyring?.byId !== 'function') throw new BrokerError(BrokerErrorCode.INTERNAL, { venue: 'upstox', message: 'TokenVault needs a store and a keyring' });
    this.#store = store; this.#keyring = keyring; this.#clock = clock;
  }
  async put({ principalId, brokerAccountId, token, expiresAt }) {
    await this.#store.put(sealToken({ keyring: this.#keyring, principalId, brokerAccountId, token, expiresAt }));
  }
  /** The live token for this user/account, or null (missing, expired, or invalidated) — re-run OAuth. */
  async get({ principalId, brokerAccountId }) {
    const env = await this.#store.get(principalId, brokerAccountId);
    if (!env || env.expiresAt <= this.#clock().getTime()) return null;
    return openToken({ keyring: this.#keyring, envelope: env, principalId, brokerAccountId });
  }
  /** Upstox invalidates tokens after a kill-switch or static-IP change: drop ours too. */
  async invalidate({ principalId, brokerAccountId }) { await this.#store.delete(principalId, brokerAccountId); }
}

/** Stage 10 CredentialLoader over the vault: broker account → its owner's token. Never shared across users. */
export function vaultCredentialLoader({ vault, ownerOf }) {
  return {
    async load(brokerAccountId) {
      const principalId = await ownerOf(brokerAccountId);
      if (!principalId) throw new BrokerError(BrokerErrorCode.AUTH_FAILED, { venue: 'upstox', message: 'broker account has no owner' });
      const accessToken = await vault.get({ principalId, brokerAccountId });
      if (!accessToken) throw new BrokerError(BrokerErrorCode.AUTH_FAILED, { venue: 'upstox', message: 'no live Upstox token for this account: the user must reconnect (OAuth)' });
      return { accessToken, principalId };
    },
  };
}
