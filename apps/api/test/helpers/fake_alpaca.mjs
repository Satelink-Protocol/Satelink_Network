// A fake Alpaca Broker API (a fetch function) for Stage 23 tests: per-account orders with
// commission echo, Alpaca's duplicate client_order_id rule (422), lookup by client id, cancel
// (204), FILL activities, an account with PII, and a scripted SSE trade-event stream.
const json = (status, body) => new Response(body === null ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const OPEN = new Set(['new', 'accepted', 'pending_new', 'partially_filled']);

export class FakeAlpaca {
  constructor({ apiKey, apiSecret }) {
    this.auth = `Basic ${Buffer.from(`${apiKey}:${apiSecret}`).toString('base64')}`;
    this.orders = []; this.activities = []; this.calls = []; this.script = []; this.sse = []; this.seq = 0;
    this.accounts = {};
    this.fetch = this.fetch.bind(this);
  }
  async fetch(url, init = {}) {
    const u = new URL(url);
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(init.body) : null;
    this.calls.push({ method, path: u.pathname, query: Object.fromEntries(u.searchParams), headers: init.headers ?? {}, body });
    const fault = this.script.length && method !== 'GET' ? this.script.shift() : null;
    if (fault === 'econnrefused') throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
    if (fault === 'http500') return json(500, { code: 50010000, message: 'internal server error' });
    if (init.headers?.Authorization !== this.auth) return json(401, { message: 'unauthorized.' });
    let m;
    let res;
    if (method === 'GET' && u.pathname === '/v2/events/trades') return this.#stream(init);
    if ((m = /^\/v1\/accounts\/([0-9a-f-]{36})$/.exec(u.pathname)) && method === 'GET') res = this.accounts[m[1]] ? json(200, this.accounts[m[1]]) : json(404, { code: 40410000, message: 'account not found' });
    else if (u.pathname === '/v1/accounts/activities/FILL') res = json(200, this.activities.filter((a) => a.account_id === u.searchParams.get('account_id')));
    else if ((m = /^\/v1\/trading\/accounts\/([0-9a-f-]{36})\/orders$/.exec(u.pathname)) && method === 'POST') res = this.#place(m[1], body);
    else if ((m = /^\/v1\/trading\/accounts\/([0-9a-f-]{36})\/orders:by_client_order_id$/.exec(u.pathname))) res = this.#get(m[1], (o) => o.client_order_id === u.searchParams.get('client_order_id'));
    else if ((m = /^\/v1\/trading\/accounts\/([0-9a-f-]{36})\/orders\/([^/]+)$/.exec(u.pathname)) && method === 'GET') res = this.#get(m[1], (o) => o.id === m[2]);
    else if ((m = /^\/v1\/trading\/accounts\/([0-9a-f-]{36})\/orders\/([^/]+)$/.exec(u.pathname)) && method === 'DELETE') res = this.#cancel(m[1], m[2]);
    else res = json(404, { code: 40410000, message: 'route not found' });
    if (fault === 'timeout_after') {
      await new Promise((resolve, reject) => {
        if (init.signal?.aborted) reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('This operation was aborted'), { name: 'AbortError' })));
      });
    }
    return res;
  }
  #place(accountId, b) {
    if (this.orders.some((o) => o.client_order_id === b.client_order_id)) return json(422, { code: 40010001, message: 'client_order_id must be unique' });
    const o = { id: `904837e3-3b76-47ec-b432-046db621${String(++this.seq).padStart(4, '0')}`, accountId, client_order_id: b.client_order_id, symbol: b.symbol, qty: b.qty, side: b.side, type: b.type,
      time_in_force: b.time_in_force, limit_price: b.limit_price ?? null, status: 'accepted', filled_qty: '0', filled_avg_price: null, commission: b.commission ?? '0', commission_type: b.commission_type ?? null,
      created_at: '2026-10-06T14:00:00Z' };
    this.orders.push(o);
    return json(200, this.#pub(o));
  }
  #pub(o) { const { accountId: _a, ...p } = o; return p; } // eslint-disable-line no-unused-vars
  #get(accountId, pred) { const o = this.orders.filter((x) => x.accountId === accountId && pred(x)).at(-1); return o ? json(200, this.#pub(o)) : json(404, { code: 40410000, message: 'order not found' }); }
  #cancel(accountId, id) {
    const o = this.orders.find((x) => x.accountId === accountId && x.id === id);
    if (!o) return json(404, { code: 40410000, message: 'order not found' });
    if (!OPEN.has(o.status)) return json(422, { code: 42210000, message: 'order is not cancelable' });
    o.status = 'canceled';
    return json(204, null);
  }
  /** test helper: the venue executes part of an order */
  fill(orderId, qty, price, at = '2026-10-06T14:01:00Z') {
    const o = this.orders.find((x) => x.id === orderId);
    const filled = Number(o.filled_qty) + Number(qty);
    o.filled_avg_price = String(price); o.filled_qty = String(filled); o.status = filled >= Number(o.qty) ? 'filled' : 'partially_filled';
    this.activities.push({ id: `20261006140100000::${this.activities.length + 1}`, account_id: o.accountId, activity_type: 'FILL', transaction_time: at, type: o.status === 'filled' ? 'fill' : 'partial_fill', price: String(price), qty: String(qty), side: o.side, symbol: o.symbol, leaves_qty: String(Number(o.qty) - filled), order_id: o.id, cum_qty: String(filled), order_status: o.status });
  }
  #stream(init) {
    const chunks = this.sse.map((c) => new TextEncoder().encode(c));
    const stream = new ReadableStream({ start(ctrl) { for (const c of chunks) ctrl.enqueue(c); ctrl.close(); init.signal?.addEventListener('abort', () => {}); } });
    return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  }
}
