// A fake Binance Spot REST venue for Stage 21 tests (a fetch function). It verifies every signed
// request with the test HMAC secret, enforces Binance's duplicate rule (a newClientOrderId is
// refused only while an order with it is OPEN), and can be scripted to fail like the real thing.
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FIX = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/binance');
export const fixture = (name) => JSON.parse(readFileSync(path.join(FIX, name), 'utf8'));
const OPEN = new Set(['NEW', 'PARTIALLY_FILLED', 'PENDING_NEW']);
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export class FakeBinance {
  constructor({ secret, apiKey, price = '60000.00', restrictions = fixture('api_restrictions_ok.json') } = {}) {
    this.secret = secret; this.apiKey = apiKey; this.price = price; this.restrictions = restrictions;
    this.orders = []; this.trades = []; this.calls = []; this.script = []; this.seq = 4293150; this.tradeSeq = 1700;
    this.fetch = this.fetch.bind(this);
  }

  async fetch(url, init = {}) {
    const u = new URL(url);
    const method = init.method ?? 'GET';
    const p = Object.fromEntries(u.searchParams);
    this.calls.push({ method, path: u.pathname, params: p, headers: init.headers ?? {} });
    const fault = this.script.length && method !== 'GET' ? this.script.shift() : null;
    if (fault === 'econnrefused') throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
    if (fault === 'http500') return json(500, { code: -1001, msg: 'Internal error; unable to process your request. Please try again.' });
    if (fault?.startsWith?.('error:')) { const [, code, msg] = fault.split(':'); return json(400, { code: Number(code), msg }); }

    if (p.signature !== undefined) {
      const qs = u.search.slice(1).replace(/&signature=[^&]*$/, '');
      const want = createHmac('sha256', this.secret).update(qs).digest('hex');
      if (p.signature !== want || init.headers?.['X-MBX-APIKEY'] !== this.apiKey) return json(401, { code: -1022, msg: 'Signature for this request is not valid.' });
      if (!p.timestamp || !p.recvWindow) return json(400, { code: -1102, msg: 'Mandatory parameter was not sent.' });
    }
    const route = `${method} ${u.pathname}`;
    let res;
    switch (route) {
      case 'GET /api/v3/exchangeInfo': res = json(200, fixture('exchange_info.json')); break;
      case 'GET /api/v3/ticker/price': res = json(200, { symbol: p.symbol, price: this.price }); break;
      case 'GET /sapi/v1/account/apiRestrictions': res = json(200, this.restrictions); break;
      case 'GET /sapi/v1/broker/rebate/recentRecord': res = json(200, fixture('rebate_recent_record.json')); break;
      case 'POST /api/v3/order': res = this.#place(p); break;
      case 'GET /api/v3/order': res = this.#query(p); break;
      case 'DELETE /api/v3/order': res = this.#cancel(p); break;
      case 'GET /api/v3/myTrades': res = json(200, this.trades.filter((t) => t.symbol === p.symbol && String(t.orderId) === p.orderId)); break;
      default: res = json(404, { code: -1, msg: `no route ${route}` });
    }
    if (fault === 'timeout_after') { // the venue executed it; our side never sees the answer
      await new Promise((resolve, reject) => {
        if (init.signal?.aborted) reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('This operation was aborted'), { name: 'AbortError' })));
      });
    }
    return res;
  }

  #find(p) {
    const hit = this.orders.filter((o) => o.symbol === p.symbol && (p.orderId ? String(o.orderId) === p.orderId : o.clientOrderId === p.origClientOrderId));
    return hit.at(-1) ?? null;
  }
  #view(o) {
    const { fills, ...rest } = o; // eslint-disable-line no-unused-vars
    return { ...rest };
  }
  #place(p) {
    if (!/^[.A-Z:/a-z0-9_-]{1,36}$/.test(p.newClientOrderId ?? '')) return json(400, { code: -1100, msg: "Illegal characters found in parameter 'newClientOrderId'." });
    if (this.orders.some((o) => o.clientOrderId === p.newClientOrderId && OPEN.has(o.status))) return json(400, { code: -2010, msg: 'Duplicate order sent.' });
    const orderId = ++this.seq;
    const at = 1759654800000 + orderId;
    const marketable = p.type === 'MARKET' || (p.side === 'BUY' ? Number(p.price) >= Number(this.price) : Number(p.price) <= Number(this.price));
    const o = { symbol: p.symbol, orderId, orderListId: -1, clientOrderId: p.newClientOrderId, transactTime: at, price: p.price ?? '0.00000000', origQty: p.quantity,
      executedQty: '0.00000000', cummulativeQuoteQty: '0.00000000', status: 'NEW', timeInForce: p.timeInForce ?? 'GTC', type: p.type, side: p.side, workingTime: at, selfTradePreventionMode: 'EXPIRE_MAKER', fills: [] };
    if (marketable) { // fill in two trades at the fake market price
      const q = Number(p.quantity); const q1 = (q * 0.4).toFixed(8); const q2 = (q - Number(q1)).toFixed(8);
      for (const qty of [q1, q2]) {
        const t = { symbol: p.symbol, id: ++this.tradeSeq, orderId, orderListId: -1, price: Number(this.price).toFixed(8), qty, quoteQty: (Number(qty) * Number(this.price)).toFixed(8), commission: (Number(qty) * 0.001).toFixed(8), commissionAsset: 'BTC', time: at, isBuyer: p.side === 'BUY', isMaker: false, isBestMatch: true };
        this.trades.push(t);
        o.fills.push({ price: t.price, qty: t.qty, commission: t.commission, commissionAsset: t.commissionAsset, tradeId: t.id });
      }
      Object.assign(o, { status: 'FILLED', executedQty: Number(p.quantity).toFixed(8), cummulativeQuoteQty: (Number(p.quantity) * Number(this.price)).toFixed(8) });
    }
    this.orders.push(o);
    return json(200, { ...this.#view(o), fills: o.fills });
  }
  #query(p) {
    const o = this.#find(p);
    return o ? json(200, { ...this.#view(o), stopPrice: '0.00000000', icebergQty: '0.00000000', time: o.transactTime, updateTime: o.transactTime, isWorking: true, origQuoteOrderQty: '0.00000000' }) : json(400, { code: -2013, msg: 'Order does not exist.' });
  }
  #cancel(p) {
    const o = this.#find(p);
    if (!o || !OPEN.has(o.status)) return json(400, { code: -2011, msg: 'Unknown order sent.' });
    o.status = 'CANCELED';
    return json(200, { symbol: o.symbol, origClientOrderId: o.clientOrderId, orderId: o.orderId, orderListId: -1, clientOrderId: 'cancel_5d8f6c2e', transactTime: o.transactTime + 1, price: o.price, origQty: o.origQty, executedQty: o.executedQty, cummulativeQuoteQty: o.cummulativeQuoteQty, status: 'CANCELED', timeInForce: o.timeInForce, type: o.type, side: o.side, selfTradePreventionMode: 'EXPIRE_MAKER' });
  }
  placeCount(clientOrderId) { return this.calls.filter((c) => c.method === 'POST' && c.params.newClientOrderId === clientOrderId).length; }
}
