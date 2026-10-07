// Upstox OAuth (Stage 22): authorization-code flow, per user.
//   authorizationUrl() → dialog URL with an HMAC-signed, expiring `state` bound to the principal and
//   broker account (CSRF + account-swap protection); exchangeCode() → POST /v2/login/authorization/token
//   (form-encoded) and hands the token straight to the TokenVault — the caller never sees it.
// Access tokens expire at 03:30 IST the next morning whatever time they were issued (Upstox docs).
// The app's client secret and the state key are injected (KMS in production, B-08); never env.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { BrokerError, BrokerErrorCode } from '../errors.mjs';
import { UPSTOX_AUTHORIZE_URL, UPSTOX_TOKEN_URL } from './config.mjs';

const STATE_TTL_MS = 10 * 60_000;
const b64u = (b) => Buffer.from(b).toString('base64url');
const fail = (m) => new BrokerError(BrokerErrorCode.AUTH_FAILED, { venue: 'upstox', message: m });

/** Next 03:30 IST (= 22:00 UTC) strictly after `issuedAtMs`. */
export function tokenExpiry(issuedAtMs) {
  const d = new Date(issuedAtMs);
  let t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 22, 0, 0);
  if (t <= issuedAtMs) t += 86_400_000;
  return t;
}

export class UpstoxOAuth {
  #clientId; #secret; #redirectUri; #stateKey; #fetch; #clock; #vault;
  /**
   * @param deps.clientSecret async () → the app secret (never stored here)
   * @param deps.stateKey     Buffer ≥ 32 bytes for signing `state`
   * @param deps.vault        TokenVault (encrypted, per user)
   */
  constructor({ clientId, clientSecret, redirectUri, stateKey, fetch, vault, clock = () => new Date() }) {
    if (!clientId || typeof clientSecret !== 'function' || !redirectUri || !Buffer.isBuffer(stateKey) || stateKey.length < 32 || typeof fetch !== 'function' || !vault) {
      throw new BrokerError(BrokerErrorCode.INTERNAL, { venue: 'upstox', message: 'UpstoxOAuth needs clientId, clientSecret(), redirectUri, a 32-byte stateKey, fetch and a vault' });
    }
    this.#clientId = clientId; this.#secret = clientSecret; this.#redirectUri = redirectUri; this.#stateKey = stateKey; this.#fetch = fetch; this.#clock = clock; this.#vault = vault;
  }

  #mac(payload) { return createHmac('sha256', this.#stateKey).update(payload).digest('base64url'); }

  authorizationUrl({ principalId, brokerAccountId }) {
    const payload = b64u(JSON.stringify({ p: principalId, a: brokerAccountId, n: randomBytes(16).toString('hex'), exp: this.#clock().getTime() + STATE_TTL_MS }));
    const state = `${payload}.${this.#mac(payload)}`;
    const u = new URL(UPSTOX_AUTHORIZE_URL);
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('client_id', this.#clientId);
    u.searchParams.set('redirect_uri', this.#redirectUri);
    u.searchParams.set('state', state);
    return { url: u.toString(), state };
  }

  verifyState(state, { principalId }) {
    const [payload, mac] = String(state ?? '').split('.');
    if (!payload || !mac) throw fail('malformed OAuth state');
    const want = Buffer.from(this.#mac(payload));
    const got = Buffer.from(mac);
    if (want.length !== got.length || !timingSafeEqual(want, got)) throw fail('OAuth state signature invalid');
    const s = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (s.exp < this.#clock().getTime()) throw fail('OAuth state expired');
    if (s.p !== principalId) throw fail('OAuth state belongs to another user');
    return { principalId: s.p, brokerAccountId: s.a };
  }

  /** Callback: verify state, exchange the code, seal the token for THIS user/account. Returns metadata only. */
  async exchangeCode({ code, state, principalId }) {
    const { brokerAccountId } = this.verifyState(state, { principalId });
    if (typeof code !== 'string' || !code) throw fail('authorization code missing');
    const form = new URLSearchParams({ code, client_id: this.#clientId, client_secret: await this.#secret(), redirect_uri: this.#redirectUri, grant_type: 'authorization_code' });
    let res;
    try {
      res = await this.#fetch(UPSTOX_TOKEN_URL, { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString() });
    } catch (e) {
      throw new BrokerError(BrokerErrorCode.VENUE_UNAVAILABLE, { venue: 'upstox', message: `token exchange: ${e?.cause?.code ?? e?.name ?? 'network error'}` });
    }
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.access_token) throw fail(`token exchange refused (${json?.errors?.[0]?.errorCode ?? res.status})`);
    const issuedAt = this.#clock().getTime();
    const expiresAt = tokenExpiry(issuedAt);
    await this.#vault.put({ principalId, brokerAccountId, token: json.access_token, expiresAt });
    return Object.freeze({ brokerAccountId, upstoxUserId: json.user_id ?? null, expiresAt: new Date(expiresAt).toISOString(), exchanges: json.exchanges ?? [], orderTypes: json.order_types ?? [] });
  }
}
