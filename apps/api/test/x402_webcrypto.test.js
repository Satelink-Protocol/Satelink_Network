// Production outage 2026-09-15: Node 18 (Nixpacks default for apps/api) has no
// globalThis.crypto, so CDP facilitator auth headers could not be generated and
// no anonymous 402 carried x402 `accepts`. Offline: removes the global to
// simulate Node 18 and proves the shim restores it before signing.

import { expect } from 'chai';
import { webcrypto } from 'node:crypto';
import { ensureWebCrypto } from '../src/payments/x402/webcrypto.js';

describe('x402 WebCrypto shim (Node 18 CDP JWT outage)', () => {
  let saved;
  beforeEach(() => {
    saved = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  });
  afterEach(() => {
    if (saved) Object.defineProperty(globalThis, 'crypto', saved);
  });

  it('installs node:crypto webcrypto when globalThis.crypto is missing (Node 18)', () => {
    Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true, writable: true });
    expect(globalThis.crypto).to.equal(undefined);
    ensureWebCrypto();
    expect(globalThis.crypto).to.equal(webcrypto);
    expect(globalThis.crypto.subtle.sign).to.be.a('function');
  });

  it('leaves an existing globalThis.crypto untouched (Node >= 19)', () => {
    const existing = globalThis.crypto;
    ensureWebCrypto();
    expect(globalThis.crypto).to.equal(existing);
  });

  it('createCdpAuthHeaders can sign an Ed25519 JWT once the shim has run', async function () {
    // Ed25519 test key (throwaway, generated for this test; not a CDP credential).
    const { generateKeyPairSync } = await import('node:crypto');
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const seed = privateKey.export({ format: 'der', type: 'pkcs8' }).subarray(-32);
    const pub = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
    const prevId = process.env.CDP_API_KEY_ID;
    const prevSecret = process.env.CDP_API_KEY_SECRET;
    process.env.CDP_API_KEY_ID = 'test-key-id';
    process.env.CDP_API_KEY_SECRET = Buffer.concat([seed, pub]).toString('base64');
    Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true, writable: true });
    try {
      ensureWebCrypto();
      const { createCdpAuthHeaders } = await import('@coinbase/x402');
      const headers = await createCdpAuthHeaders()();
      expect(headers.supported.Authorization).to.match(/^Bearer ey/);
    } finally {
      if (prevId === undefined) delete process.env.CDP_API_KEY_ID; else process.env.CDP_API_KEY_ID = prevId;
      if (prevSecret === undefined) delete process.env.CDP_API_KEY_SECRET; else process.env.CDP_API_KEY_SECRET = prevSecret;
    }
  });
});
