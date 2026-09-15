// apps/api/src/bootstrap/webcrypto_global.js
//
// T-04 (2026-09-15): revive the x402 402 challenge — layer 2.
//
// #362 pinned @x402/* to 2.18.0 and got production PAST the constructor
// TypeError (version skew). That exposed the NEXT blocker, seen live in prod:
//
//   [x402] facilitator sync unavailable: Failed to fetch supported kinds from
//   facilitator: Error: Failed to generate Ed25519 JWT: crypto is not defined
//   [x402] 402 upgrade failed, serving legacy 402: Facilitator does not support
//   exact on eip155:8453. Make sure to call initialize() ...
//
// Root cause: Railway/Nixpacks runs this service on **Node v18.20.5** (build
// logs; no `engines.node` pins it, and several deps already warn they need
// >=20). On Node 18 the WebCrypto API is NOT exposed as the `globalThis.crypto`
// global by default — it is gated behind `--experimental-global-webcrypto`.
// @coinbase/x402's CDP auth signs an Ed25519 JWT via the bare `crypto` global,
// so on Node 18 it throws `crypto is not defined`; the facilitator `/supported`
// sync then loads no payment kinds, the `exact` scheme on eip155:8453 is never
// registered, and every anonymous 402 falls open to the non-payable legacy 402
// (middleware.js Rail 1 catch). The x402 rail is effectively dead in prod.
//
// It works locally only because dev machines run Node >= 20, where
// `globalThis.crypto` is a default global.
//
// Fix: expose Node's own WebCrypto implementation (`node:crypto`.webcrypto,
// which supports Ed25519 sign/verify on Node >= 18.4) as `globalThis.crypto`
// when the runtime has not already provided it. Idempotent and non-destructive:
// on Node >= 20 (crypto already global) this is a no-op. Import this module
// FIRST — before anything that may reach the CDP facilitator.
//
// The durable fix is upgrading the deployed runtime to Node 20/22 (which also
// clears the EBADENGINE warnings); that is a Railway/Nixpacks build-config
// change (out of apps/api's reach). This polyfill makes the rail correct on
// whatever Node the image ships, so it is safe to keep even after that upgrade.

import { webcrypto } from 'node:crypto';

if (typeof globalThis.crypto === 'undefined' || globalThis.crypto == null) {
  // `crypto` is a non-writable global on newer Node, so guard before assigning
  // to avoid a TypeError; defineProperty keeps it configurable for test resets.
  try {
    Object.defineProperty(globalThis, 'crypto', {
      value: webcrypto,
      writable: false,
      enumerable: false,
      configurable: true,
    });
  } catch {
    // Last resort if defineProperty is refused for any reason.
    globalThis.crypto = webcrypto;
  }
}

// True once this module has ensured a WebCrypto global with a SubtleCrypto —
// exported so a regression test can assert the fix without re-deriving it.
export const webCryptoReady =
  typeof globalThis.crypto?.subtle?.sign === 'function';
