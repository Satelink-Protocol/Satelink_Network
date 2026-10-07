// Binance REST client (Stage 21). Injected fetch + clock; ONE request per call — no automatic
// retry of any kind (the OMS dispatcher owns every retry decision, Stage 17).
// Failure classification (Stage 10 semantics):
//   * connection refused / DNS failure before sending → VENUE_UNAVAILABLE (not sent)
//   * our timeout or a dropped connection on a MUTATING request → AMBIGUOUS (may have executed)
//   * venue error JSON {code,msg} → mapVenueError (e.g. -2010 duplicate, -2013 no such order)
import { BrokerError, BrokerErrorCode, mapVenueError } from '../errors.mjs';
import { queryString, signPayload } from './signing.mjs';

const NOT_SENT = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH']);

export class BinanceRestClient {
  #base; #fetch; #clock; #recvWindow; #timeoutMs;
  constructor({ baseUrl, fetch, clock = () => new Date(), recvWindow = 5000, timeoutMs = 10_000 }) {
    if (typeof fetch !== 'function' || typeof baseUrl !== 'string') throw new BrokerError(BrokerErrorCode.INTERNAL, { venue: 'binance', message: 'BinanceRestClient needs baseUrl and fetch' });
    this.#base = baseUrl.replace(/\/$/, ''); this.#fetch = fetch; this.#clock = clock; this.#recvWindow = recvWindow; this.#timeoutMs = timeoutMs;
  }

  /** @param credential required when signed; never logged. */
  async request(method, path, params = {}, { signed = false, credential = null } = {}) {
    let qs = queryString(params);
    const headers = {};
    if (signed) {
      qs = queryString({ ...params, recvWindow: this.#recvWindow, timestamp: this.#clock().getTime() });
      qs = `${qs}&signature=${encodeURIComponent(signPayload(credential, qs))}`;
    }
    if (credential) headers['X-MBX-APIKEY'] = credential.apiKey;
    const url = `${this.#base}${path}${qs ? `?${qs}` : ''}`;
    const mutating = method !== 'GET';
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), this.#timeoutMs);
    let res;
    try {
      res = await this.#fetch(url, { method, headers, signal: ac.signal });
    } catch (e) {
      const code = e?.cause?.code ?? e?.code;
      const sent = !(NOT_SENT.has(code));
      if (!sent || !mutating) throw mapVenueError('binance', { sent: false, message: `${method} ${path}: ${code ?? e?.name ?? 'network error'}` });
      throw mapVenueError('binance', { sent: true, httpStatus: null, message: `${method} ${path}: ${e?.name === 'AbortError' ? 'timeout' : code ?? 'connection lost'} — outcome unknown` });
    } finally {
      clearTimeout(timer);
    }
    let body = null;
    try { body = await res.json(); } catch { body = null; }
    if (res.ok) return body;
    throw mapVenueError('binance', { sent: true, httpStatus: res.status, venueCode: body?.code ?? null, message: body?.msg ?? `HTTP ${res.status}` });
  }
}
