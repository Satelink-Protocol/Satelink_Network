// Alpaca Broker API REST client (Stage 23). HTTP Basic with the CORRESPONDENT key:secret (one firm
// credential, KMS-held in production — B-08), injected per call; never logged. ONE request per
// call, no retry. Classification as in Stage 10: refused connection or any failed read →
// VENUE_UNAVAILABLE; mutating timeout / dropped connection → AMBIGUOUS; otherwise mapVenueError
// (422 "client_order_id must be unique" → DUPLICATE_CLIENT_ORDER_ID, 404 → ORDER_NOT_FOUND, …).
import { BrokerError, BrokerErrorCode, mapVenueError } from '../errors.mjs';

const NOT_SENT = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH']);

export function basicAuth(credential) {
  if (!credential || typeof credential.apiKey !== 'string' || credential.apiKey.length < 8 || typeof credential.apiSecret !== 'string' || credential.apiSecret.length < 8) {
    throw new BrokerError(BrokerErrorCode.AUTH_FAILED, { venue: 'alpaca', message: 'correspondent credential needs apiKey and apiSecret' });
  }
  return `Basic ${Buffer.from(`${credential.apiKey}:${credential.apiSecret}`, 'utf8').toString('base64')}`;
}

export class AlpacaRestClient {
  #base; #fetch; #timeoutMs;
  constructor({ baseUrl, fetch, timeoutMs = 10_000 }) {
    if (typeof fetch !== 'function' || typeof baseUrl !== 'string') throw new BrokerError(BrokerErrorCode.INTERNAL, { venue: 'alpaca', message: 'AlpacaRestClient needs baseUrl and fetch' });
    this.#base = baseUrl.replace(/\/$/, ''); this.#fetch = fetch; this.#timeoutMs = timeoutMs;
  }
  get base() { return this.#base; }

  async request(method, path, { query = null, body = null, credential, stream = false } = {}) {
    const u = new URL(`${this.#base}${path}`);
    for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== null) u.searchParams.set(k, String(v));
    const headers = { Accept: stream ? 'text/event-stream' : 'application/json', Authorization: basicAuth(credential) };
    if (body !== null) headers['Content-Type'] = 'application/json';
    const mutating = method !== 'GET';
    const ac = new AbortController();
    const timer = stream ? null : setTimeout(() => ac.abort(), this.#timeoutMs);
    let res;
    try {
      res = await this.#fetch(u.toString(), { method, headers, body: body === null ? undefined : JSON.stringify(body), signal: ac.signal });
    } catch (e) {
      const code = e?.cause?.code ?? e?.code;
      if (NOT_SENT.has(code) || !mutating) throw mapVenueError('alpaca', { sent: false, message: `${method} ${u.pathname}: ${code ?? e?.name ?? 'network error'}` });
      throw mapVenueError('alpaca', { sent: true, httpStatus: null, message: `${method} ${u.pathname}: ${e?.name === 'AbortError' ? 'timeout' : code ?? 'connection lost'} — outcome unknown` });
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (stream && res.ok) return { response: res, abort: () => ac.abort() };
    if (res.status === 204) return null;
    let json = null;
    try { json = await res.json(); } catch { json = null; }
    if (res.ok) return json;
    throw mapVenueError('alpaca', { sent: true, httpStatus: res.status, venueCode: json?.code ?? null, message: json?.message ?? `HTTP ${res.status}` });
  }
}
