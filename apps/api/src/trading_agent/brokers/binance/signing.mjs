// Binance request signing (Stage 21). HMAC-SHA256 (hex) and Ed25519 (base64) — Ed25519 is
// what the WebSocket API session.logon / userDataStream.subscribe require.
// The credential handle comes ONLY from the adapter's injected CredentialLoader (Stage 10):
//   { apiKey, keyType: 'hmac', secret }  or  { apiKey, keyType: 'ed25519', privateKeyPem }
// Nothing here logs, returns or embeds a secret.
import { createHmac, createPrivateKey, sign } from 'node:crypto';
import { BrokerError, BrokerErrorCode } from '../errors.mjs';

/** REST: the exact query string that is sent (and signed). */
export function queryString(params) {
  return Object.entries(params).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&');
}

/** WebSocket API: params sorted by name, "k=v&…", no percent-encoding (official docs). */
export function wsSignaturePayload(params) {
  return Object.keys(params).filter((k) => k !== 'signature' && params[k] !== undefined).sort().map((k) => `${k}=${params[k]}`).join('&');
}

export function assertCredential(c) {
  const bad = (m) => { throw new BrokerError(BrokerErrorCode.AUTH_FAILED, { venue: 'binance', message: m }); };
  if (!c || typeof c.apiKey !== 'string' || c.apiKey.length < 8) bad('credential handle needs an apiKey');
  if (c.keyType === 'hmac') { if (typeof c.secret !== 'string' || c.secret.length < 8) bad('HMAC credential needs a secret'); return; }
  if (c.keyType === 'ed25519') {
    let key = null;
    try { key = typeof c.privateKeyPem === 'string' ? createPrivateKey(c.privateKeyPem) : null; } catch { key = null; }
    if (!key || key.asymmetricKeyType !== 'ed25519') bad('Ed25519 credential needs a PKCS#8 PEM Ed25519 private key');
    return;
  }
  bad('keyType must be hmac or ed25519');
}

export function signPayload(credential, payload) {
  assertCredential(credential);
  if (credential.keyType === 'hmac') return createHmac('sha256', credential.secret).update(payload, 'utf8').digest('hex');
  return sign(null, Buffer.from(payload, 'utf8'), createPrivateKey(credential.privateKeyPem)).toString('base64');
}
