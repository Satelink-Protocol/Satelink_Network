// A fake Upstox venue for Stage 22 tests (a fetch function): v3 place/modify/cancel, v2 details/
// trades, static IP read, kill switch, portfolio-stream authorize and the OAuth token endpoint.
// Tokens map to users; the fake refuses unknown tokens with UDAPI100050 like the real API.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FIX = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/upstox');
export const upstoxFixture = (name) => JSON.parse(readFileSync(path.join(FIX, name), 'utf8'));
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const err = (status, code, message) => json(status, { status: 'error', errors: [{ errorCode: code, error_code: code, message, propertyPath: null, invalidValue: null }] });
const TERMINAL = new Set(['complete', 'cancelled', 'rejected']);

export class FakeUpstox {
  constructor({ tokens = {} } = {}) {
    this.tokens = { ...tokens }; // token → userId
    this.orders = []; this.trades = []; this.calls = []; this.script = []; this.seq = 240221025997000;
    this.ips = {}; this.killSwitch = {}; this.tokenGrants = {}; // code → { token, userId }
    this.fetch = this.fetch.bind(this);
  }
  async fetch(url, init = {}) {
    const u = new URL(url);
    const method = init.method ?? 'GET';
    const headers = init.headers ?? {};
    const body = init.body == null ? null : (headers['Content-Type'] ?? '').includes('json') ? JSON.parse(init.body) : Object.fromEntries(new URLSearchParams(init.body));
    this.calls.push({ method, host: u.host, path: u.pathname, query: Object.fromEntries(u.searchParams), headers, body });
    const fault = this.script.length && method !== 'GET' ? this.script.shift() : null;
    if (fault === 'econnrefused') throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
    if (fault?.startsWith?.('error:')) { const [, code, ...m] = fault.split(':'); return err(400, code, m.join(':')); }
    if (fault === 'http503') return json(503, { status: 'error', errors: [] });

    if (u.pathname === '/v2/login/authorization/token') {
      const g = this.tokenGrants[body?.code];
      if (!g || body.grant_type !== 'authorization_code' || !body.client_secret) return err(400, 'UDAPI100069', 'Check your client_id / redirect_uri / code');
      this.tokens[g.token] = g.userId;
      return json(200, { email: 'x@example.invalid', exchanges: ['NSE', 'BSE'], products: ['D', 'I'], user_id: g.userId, order_types: ['LIMIT', 'MARKET'], access_token: g.token, extended_token: null, is_active: true });
    }
    const auth = String(headers.Authorization ?? '');
    const userId = this.tokens[auth.replace(/^Bearer /, '')];
    if (!userId) return err(401, 'UDAPI100050', 'Invalid token used to access API');

    const route = `${method} ${u.pathname}`;
    let res;
    switch (route) {
      case 'POST /v3/order/place': res = this.#place(userId, body); break;
      case 'PUT /v3/order/modify': res = this.#modify(userId, body); break;
      case 'DELETE /v3/order/cancel': res = this.#cancel(userId, u.searchParams.get('order_id')); break;
      case 'GET /v2/order/details': res = this.#details(userId, u.searchParams); break;
      case 'GET /v2/order/trades': res = json(200, { status: 'success', data: this.trades.filter((t) => t.order_id === u.searchParams.get('order_id')) }); break;
      case 'GET /v2/user/ip': res = json(200, { status: 'success', data: this.ips[userId] ?? { primary_ip: null, secondary_ip: null } }); break;
      case 'GET /v2/user/kill-switch': res = json(200, { status: 'success', data: Object.entries(this.killSwitch[userId] ?? {}).map(([segment, s]) => ({ segment, segment_status: s.on ? 'INACTIVE' : 'ACTIVE', kill_switch_enabled: s.on })) }); break;
      case 'POST /v2/user/kill-switch': res = this.#kill(userId, body); break;
      case 'GET /v2/feed/portfolio-stream-feed/authorize': res = json(200, { status: 'success', data: { authorized_redirect_uri: `wss://fake.upstox.invalid/upstox-developer-api/order-updates/feed?requestId=r1&code=one-time-${this.calls.length}` } }); break;
      default: res = err(404, 'UDAPI100060', 'Resource not Found.');
    }
    if (fault === 'timeout_after') {
      await new Promise((resolve, reject) => {
        if (init.signal?.aborted) reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('This operation was aborted'), { name: 'AbortError' })));
      });
    }
    return res;
  }
  #place(userId, b) {
    if (b.order_type === 'MARKET') return err(400, 'UDAPI1158', 'Market orders are not allowed. Try placing a limit order.');
    if (b.tag && b.tag.length > 40) return err(400, 'UDAPI1119', 'Tag length cannot exceed 40 characters');
    const o = { userId, order_id: String(++this.seq), tag: b.tag ?? null, status: 'open', quantity: b.quantity, filled_quantity: 0, average_price: 0, price: b.price,
      instrument_token: b.instrument_token, transaction_type: b.transaction_type, order_type: b.order_type, validity: b.validity, product: b.product, order_timestamp: '2026-10-06 10:15:00', status_message: '' };
    this.orders.push(o);
    return json(200, { status: 'success', data: { order_ids: [o.order_id] }, metadata: { latency: 12 } });
  }
  #find(userId, q) { return this.orders.filter((o) => o.userId === userId && (q.order_id ? o.order_id === q.order_id : o.tag === q.tag)).at(-1) ?? null; }
  #details(userId, sp) {
    const q = Object.fromEntries(sp);
    if (!q.order_id && !q.tag) return err(400, 'UDAPI100059', "Must provide either 'order_id' or 'tag'");
    const o = this.#find(userId, q);
    if (!o) return err(400, 'UDAPI100010', 'Order not found');
    const { userId: _u, ...pub } = o; // eslint-disable-line no-unused-vars
    return json(200, { status: 'success', data: pub });
  }
  #modify(userId, b) {
    const o = this.#find(userId, { order_id: b.order_id });
    if (!o) return err(400, 'UDAPI100010', 'Order not found');
    if (TERMINAL.has(o.status)) return err(400, 'UDAPI100041', 'Modify of cancelled/rejected/completed order is not allowed');
    if (b.order_type === 'MARKET') return err(400, 'UDAPI1158', 'Market orders are not allowed. Try placing a limit order.');
    Object.assign(o, { price: b.price, quantity: b.quantity ?? o.quantity, validity: b.validity });
    return json(200, { status: 'success', data: { order_id: o.order_id }, metadata: { latency: 9 } });
  }
  #cancel(userId, orderId) {
    const o = this.#find(userId, { order_id: orderId });
    if (!o) return err(400, 'UDAPI100010', 'Order not found');
    if (TERMINAL.has(o.status)) return err(400, 'UDAPI100040', 'Cancel of already cancelled/rejected/completed order is not allowed');
    o.status = 'cancelled';
    return json(200, { status: 'success', data: { order_id: o.order_id }, metadata: { latency: 8 } });
  }
  #kill(userId, rows) {
    const ks = (this.killSwitch[userId] ??= {});
    for (const r of rows) if ((r.action === 'ENABLE') && ks[r.segment]?.coolingUntil > Date.now()) return err(400, 'UDAPI1185', 'Cooling period active');
    for (const r of rows) ks[r.segment] = { on: r.action === 'DISABLE', coolingUntil: r.action === 'DISABLE' ? Date.now() + 12 * 3_600_000 : 0 };
    return json(200, { status: 'success', data: rows.map((r) => ({ segment: r.segment, segment_status: ks[r.segment].on ? 'INACTIVE' : 'ACTIVE', kill_switch_enabled: ks[r.segment].on })) });
  }
  /** test helper: the venue fills part of an order */
  fill(orderId, qty, price, tradeId) {
    const o = this.orders.find((x) => x.order_id === orderId);
    o.filled_quantity += qty; o.average_price = price; if (o.filled_quantity >= o.quantity) o.status = 'complete';
    this.trades.push({ trade_id: tradeId, order_id: orderId, exchange_order_id: `X${orderId}`, quantity: qty, average_price: price, exchange_timestamp: '06-Oct-2026 10:16:30', transaction_type: o.transaction_type, product: o.product, exchange: 'NSE' });
  }
}
