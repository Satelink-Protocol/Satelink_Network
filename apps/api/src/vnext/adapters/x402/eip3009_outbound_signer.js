// EIP-3009 outbound signer — the real B2 implementation. Produces a signed
// x402 "exact" payment authorization so Satelink can pay a supplier from its
// dedicated hot wallet. Uses ethers to sign the EIP-712 TransferWithAuthorization
// with the SDK's canonical `authorizationTypes` and the token's real domain
// (from @x402/evm DEFAULT_STABLECOINS), so the signature is protocol-correct and
// the facilitator will accept it.
//
// The ethers.Wallet is the injected boundary (a throwaway wallet in tests; a
// key-from-env wallet in prod). Safe-by-default: no VNEXT_OUTBOUND_PRIVATE_KEY
// -> buildOutboundSignerFromEnv() returns null -> the settlement adapter stays
// fail-safe (outbound_no_signer).
//
// SECURITY:
//  - key never logged/returned; lives only inside the ethers.Wallet.
//  - replay-safe: the on-chain nonce is derived deterministically from the
//    kernel idemKey, so a retry re-signs the SAME authorization; EIP-3009
//    enforces single-use per nonce on-chain (no double-spend). Combined with the
//    OutboundGuard (atomic caps + exactly-once ledger), spend is bounded.
//  - time-bounded: validBefore limits the authorization's lifetime.
//  - exact amount: signs precisely the quoted supplier cost (never more).

import { ethers } from 'ethers';
import { authorizationTypes, DEFAULT_STABLECOINS } from '@x402/evm';

const AUTH_TTL_SECONDS = 300;

function tokenDomainFor(network, override) {
  const t = override || (DEFAULT_STABLECOINS && DEFAULT_STABLECOINS[network]);
  if (!t || !t.address) throw new Error(`no stablecoin domain for network '${network}'`);
  const chainId = Number(String(network).split(':')[1]);
  return { name: t.name, version: t.version, chainId, verifyingContract: t.address, decimals: t.decimals };
}

// Deterministic bytes32 nonce from the idemKey -> retry re-signs identical auth.
function nonceFromIdemKey(idemKey) {
  return ethers.keccak256(ethers.toUtf8Bytes(`vnext-outbound:${idemKey}`));
}

/**
 * @param {object} o
 *  - wallet (required): an ethers.Wallet (or Signer with signTypedData + address)
 *  - now: () => seconds (default real clock) — injectable for deterministic tests
 *  - token: optional { address, name, version, decimals } override
 * @returns { sign({ payTo, amount, network, nonce, payer }) -> { payment, ref, from } }
 */
export function createEip3009OutboundSigner({ wallet, now, token } = {}) {
  if (!wallet || typeof wallet.signTypedData !== 'function' || !wallet.address) {
    throw new Error('createEip3009OutboundSigner requires an ethers Wallet/Signer');
  }
  const clock = now || (() => Math.floor(Date.now() / 1000));
  return {
    walletAddress: wallet.address,
    async sign({ payTo, amount, network, nonce }) {
      if (!payTo) throw new Error('sign requires payTo (supplier address)');
      if (amount == null) throw new Error('sign requires amount');
      const dom = tokenDomainFor(network, token);
      const validAfter = 0;
      const validBefore = clock() + AUTH_TTL_SECONDS;
      const onchainNonce = nonceFromIdemKey(String(nonce));
      const authorization = {
        from: wallet.address,
        to: String(payTo),
        value: BigInt(amount).toString(),
        validAfter: String(validAfter),
        validBefore: String(validBefore),
        nonce: onchainNonce,
      };
      const domain = { name: dom.name, version: dom.version, chainId: dom.chainId, verifyingContract: dom.verifyingContract };
      const signature = await wallet.signTypedData(domain, authorizationTypes, authorization);
      const payment = {
        x402Version: 1,
        scheme: 'exact',
        network,
        payload: { signature, authorization },
      };
      return { payment, ref: onchainNonce, from: wallet.address };
    },
  };
}

/** Real env-driven signer, or null if unconfigured (fail-safe). Key from env only. */
export function buildOutboundSignerFromEnv() {
  const key = process.env.VNEXT_OUTBOUND_PRIVATE_KEY;
  if (!key) return null;
  const wallet = new ethers.Wallet(key); // key never leaves this scope
  return createEip3009OutboundSigner({ wallet });
}

export { nonceFromIdemKey, tokenDomainFor };
