// T-04 (2026-09-15) — layer 2 regression: the x402 rail needs a WebCrypto
// global.
//
// Production ran on Node v18.20.5 (Railway/Nixpacks, no engines pin), where
// `globalThis.crypto` is NOT a default global. @coinbase/x402's CDP auth signs
// an Ed25519 JWT through the bare `crypto` global, so the facilitator
// `/supported` sync threw "Failed to generate Ed25519 JWT: crypto is not
// defined", no payment kinds loaded, the `exact` scheme on eip155:8453 was
// never registered, and every anonymous 402 fell open to the non-payable legacy
// 402. #362 only fixed the version-skew layer above this.
//
// These checks are offline (no CDP creds, no network): they prove the polyfill
// provides exactly the primitive CDP's JWT signer uses — a WebCrypto global
// whose SubtleCrypto can generate and sign with Ed25519.

import { expect } from 'chai';
import { webCryptoReady } from '../src/bootstrap/webcrypto_global.js';

describe('x402 webcrypto global (T-04 layer 2)', () => {
  it('exposes globalThis.crypto with a SubtleCrypto after the polyfill loads', () => {
    expect(globalThis.crypto, 'globalThis.crypto must exist').to.exist;
    expect(globalThis.crypto.subtle, 'globalThis.crypto.subtle must exist').to.exist;
    expect(typeof globalThis.crypto.subtle.sign).to.equal('function');
  });

  it('reports webCryptoReady === true', () => {
    expect(webCryptoReady).to.equal(true);
  });

  it('can generate an Ed25519 key and sign+verify through the global — the exact CDP JWT operation', async () => {
    // This is what @coinbase/x402 does to mint the facilitator auth JWT. If the
    // global is missing (Node 18, no polyfill) this throws "crypto is not
    // defined" — the production failure this fix closes.
    const keyPair = await globalThis.crypto.subtle.generateKey(
      { name: 'Ed25519' },
      true,
      ['sign', 'verify'],
    );
    const message = new TextEncoder().encode('satelink:x402:facilitator-auth');
    const signature = await globalThis.crypto.subtle.sign(
      { name: 'Ed25519' },
      keyPair.privateKey,
      message,
    );
    expect(signature.byteLength).to.be.greaterThan(0);

    const ok = await globalThis.crypto.subtle.verify(
      { name: 'Ed25519' },
      keyPair.publicKey,
      signature,
      message,
    );
    expect(ok, 'Ed25519 signature must verify').to.equal(true);
  });
});
