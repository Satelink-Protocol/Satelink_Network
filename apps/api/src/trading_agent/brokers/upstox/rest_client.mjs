// Upstox REST client (Stage 22). Injected fetch + clock; bearer token per call (per user); ONE
// request per call, no retry. Failure classification as in Stage 10:
//   refused connection / DNS before sending, or any failed read → VENUE_UNAVAILABLE
//   timeout / dropped connection on a MUTATING request          → AMBIGUOUS (may have executed)
//   Upstox error JSON {status:'error', errors:[{errorCode,message}]} → UPSTOX_ERROR_CODES, else by HTTP status
import { BrokerError, BrokerErrorCode, mapVenueError } from '../errors.mjs';

const NOT_SENT = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH']);

/** Documented UDAPI codes (place/modify/cancel v3, details, kill switch, static IP). */
export const UPSTOX_ERROR_CODES = Object.freeze({
  UDAPI100050: BrokerErrorCode.AUTH_FAILED,            // invalid token
  UDAPI1154: BrokerErrorCode.PERMISSION_DENIED,        // static IP not whitelisted
  UDAPI1156: BrokerErrorCode.PERMISSION_DENIED,        // invalid X-Algo-Name
  UDAPI100049: BrokerErrorCode.PERMISSION_DENIED,      // account restricted (use Uplink Business)
  UDAPI1179: BrokerErrorCode.PERMISSION_DENIED,        // no permission for static IP configuration
  UDAPI1180: BrokerErrorCode.PERMISSION_DENIED,        // OAuth client inactive
  UDAPI1181: BrokerErrorCode.PERMISSION_DENIED,        // static IP unavailable for this app type / bad segment
  UDAPI1158: BrokerErrorCode.INVALID_REQUEST,          // market orders not allowed
  UDAPI1119: BrokerErrorCode.INVALID_REQUEST,          // tag > 40
  UDAPI100039: BrokerErrorCode.INVALID_REQUEST,        // AMO during market hours
  UDAPI1052: BrokerErrorCode.INVALID_REQUEST,          // quantity zero
  UDAPI1043: BrokerErrorCode.INVALID_REQUEST,          // price required
  UDAPI100011: BrokerErrorCode.INSTRUMENT_NOT_TRADABLE, // unknown instrument key
  UDAPI1161: BrokerErrorCode.INSTRUMENT_NOT_TRADABLE,  // MCX disabled via API
  UDAPI100074: BrokerErrorCode.MARKET_CLOSED,          // outside API availability window
  UDAPI100010: BrokerErrorCode.ORDER_NOT_FOUND,        // order not found
  UDAPI100040: BrokerErrorCode.REJECTED,               // cancel of a terminal order
  UDAPI100041: BrokerErrorCode.REJECTED,               // modify of a terminal order
  UDAPI1184: BrokerErrorCode.REJECTED,                 // kill switch: positions still open
  UDAPI1185: BrokerErrorCode.REJECTED,                 // kill switch: 12-hour cooling period active
  UDAPI1186: BrokerErrorCode.INVALID_REQUEST,          // kill switch: invalid segment
  UDAPI1188: BrokerErrorCode.INVALID_REQUEST,          // kill switch: invalid action
});

export class UpstoxRestClient {
  #fetch; #timeoutMs;
  constructor({ fetch, timeoutMs = 10_000 }) {
    if (typeof fetch !== 'function') throw new BrokerError(BrokerErrorCode.INTERNAL, { venue: 'upstox', message: 'UpstoxRestClient needs fetch' });
    this.#fetch = fetch; this.#timeoutMs = timeoutMs;
  }

  /** @param token the user's access token (never logged); body is sent as JSON. */
  async request(method, url, { query = null, body = null, token = null, headers = {} } = {}) {
    const u = new URL(url);
    for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== null) u.searchParams.set(k, String(v));
    const h = { Accept: 'application/json', ...headers };
    if (body !== null) h['Content-Type'] = 'application/json';
    if (token) h.Authorization = `Bearer ${token}`;
    const mutating = method !== 'GET';
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), this.#timeoutMs);
    let res;
    try {
      res = await this.#fetch(u.toString(), { method, headers: h, body: body === null ? undefined : JSON.stringify(body), signal: ac.signal });
    } catch (e) {
      const code = e?.cause?.code ?? e?.code;
      if (NOT_SENT.has(code) || !mutating) throw mapVenueError('upstox', { sent: false, message: `${method} ${u.pathname}: ${code ?? e?.name ?? 'network error'}` });
      throw mapVenueError('upstox', { sent: true, httpStatus: null, message: `${method} ${u.pathname}: ${e?.name === 'AbortError' ? 'timeout' : code ?? 'connection lost'} — outcome unknown` });
    } finally {
      clearTimeout(timer);
    }
    let json = null;
    try { json = await res.json(); } catch { json = null; }
    if (res.ok && json?.status !== 'error') return json;
    const err = json?.errors?.[0] ?? {};
    const venueCode = err.errorCode ?? err.error_code ?? null;
    const info = { venue: 'upstox', venueCode, httpStatus: res.status, message: err.message ?? `HTTP ${res.status}` };
    if (venueCode && UPSTOX_ERROR_CODES[venueCode]) throw new BrokerError(UPSTOX_ERROR_CODES[venueCode], info);
    throw mapVenueError('upstox', { sent: true, ...info });
  }
}
