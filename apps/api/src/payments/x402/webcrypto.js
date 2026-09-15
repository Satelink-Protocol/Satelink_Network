// apps/api/src/payments/x402/webcrypto.js
// Node 18 WebCrypto shim for the CDP facilitator auth headers.
//
// Production outage (found 2026-09-15): Satelink-api builds from apps/api with
// Nixpacks, which defaults to Node 18.20.5 (no engines field). Node 18 has no
// global `crypto`, so @coinbase/x402's createCdpAuthHeaders fails with
// "Failed to generate Ed25519 JWT: crypto is not defined". Every facilitator
// call is then unauthenticated: initialize() loads no payment kinds
// ("Failed to initialize: no supported payment kinds loaded from any
// facilitator"), every anonymous 402 upgrade throws "Facilitator does not
// support exact on eip155:8453" and falls back to the legacy non-payable 402,
// and verify/settle cannot authenticate either.
//
// Node >= 19 defines globalThis.crypto, so this is a no-op there.
import { webcrypto } from 'node:crypto';

export function ensureWebCrypto() {
  if (!globalThis.crypto) globalThis.crypto = webcrypto;
  return globalThis.crypto;
}

ensureWebCrypto();
