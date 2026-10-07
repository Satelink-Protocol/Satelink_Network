// BinanceSpotAdapter (Stage 21): native Binance Spot connector behind the Stage 10 contract.
//
//   * environments: Spot Testnet (default) or production — production is refused while
//     LIVE_TRADING is LOCKED (config.mjs), so this code cannot touch a real Binance account;
//   * credentials only via the injected CredentialLoader (HMAC or Ed25519 handle); never env;
//   * key validation (GET /sapi/v1/account/apiRestrictions) before the first order on an
//     environment that has /sapi: transfer/withdraw permissions or a missing IP restriction refuse;
//   * newClientOrderId = "x-<LinkID>" + the OMS client id (≤ 36): capabilities advertise the
//     remaining length so the Stage 17 generator fits exactly; ids are translated back on read;
//   * orders: POST /api/v3/order (newOrderRespType FULL → status + executed qty), query and cancel
//     by client id (GET / DELETE /api/v3/order, venue history — not open orders only), fills via
//     /api/v3/myTrades; ONE request per call, no retries (the OMS dispatcher decides);
//   * user data: WebSocket API userDataStream.subscribe (Ed25519 after session.logon) or
//     userDataStream.subscribe.signature (HMAC) — no listenKey.
import { BrokerAdapter } from '../adapter.mjs';
import { defineCapabilities, ExecutionSafety } from '../capabilities.mjs';
import { AssetClass, OrderType, TimeInForce, Venue } from '../types.mjs';
import { BrokerError, BrokerErrorCode } from '../errors.mjs';
import { isTradingFlagEnabled } from '../../flags.mjs';
import { resolveEnvironment, BINANCE_CLIENT_ID_MAX } from './config.mjs';
import { BinanceRestClient } from './rest_client.mjs';
import { assertCredential, signPayload, wsSignaturePayload } from './signing.mjs';
import { evaluateApiRestrictions } from './key_validation.mjs';
import { linkPrefix, toVenueClientId, orderSnapshot, tradesToFills, mapExecutionReport } from './mapping.mjs';

/** Recorded connector state (brief §12): implemented and tested; the BINANCE flag stays OFF. */
export const BINANCE_ADAPTER_STATE = 'IMPLEMENTED/TESTED';

export class BinanceSpotAdapter extends BrokerAdapter {
  #env; #prefix; #rest; #clock; #symbols = new Map(); #directory; #checked = new Map(); #ttl; #enforceKeys;

  /**
   * @param deps.environment   'testnet' (default) | 'production' (refused while LIVE_TRADING is locked)
   * @param deps.linkId        Binance Link ID → "x-<LinkID>" newClientOrderId prefix
   * @param deps.fetch         injected fetch (tests use fixtures)
   * @param deps.orderDirectory optional { instrumentFor(brokerAccountId, clientOrderId) → canonical } for lookups after a restart
   * @param deps.env           flag environment (default {} = all off), never process.env; needs TRADING_FLAG_BINANCE
   * @param deps.enforceKeyRestrictions check apiRestrictions before trading (default: environments with /sapi;
   *                           the Spot Testnet has no /sapi, so it is off there and fixture-tested instead)
   */
  constructor({ credentialLoader, instruments, environment = 'testnet', linkId, fetch, clock = () => new Date(), orderDirectory = null, env = {}, timeoutMs = 10_000, restrictionsTtlMs = 3_600_000, enforceKeyRestrictions }) {
    super({ credentialLoader, instruments });
    if (!isTradingFlagEnabled('BINANCE', env)) throw new BrokerError(BrokerErrorCode.PERMISSION_DENIED, { venue: 'binance', message: 'the BINANCE trading flag is off' });
    this.#env = resolveEnvironment(environment, env);
    this.#enforceKeys = enforceKeyRestrictions ?? this.#env.sapi;
    this.#prefix = linkPrefix(linkId);
    this.#rest = new BinanceRestClient({ baseUrl: this.#env.rest, fetch, clock, timeoutMs });
    this.#clock = clock; this.#directory = orderDirectory; this.#ttl = restrictionsTtlMs;
  }

  get environment() { return this.#env.name; }
  get clientIdPrefix() { return this.#prefix; }

  capabilities() {
    return defineCapabilities({
      venue: Venue.BINANCE, assetClasses: [AssetClass.CRYPTO_SPOT], orderTypes: [OrderType.MARKET, OrderType.LIMIT],
      timeInForce: [TimeInForce.GTC, TimeInForce.IOC, TimeInForce.FOK],
      supportsClientOrderId: true, clientOrderIdMaxLength: BINANCE_CLIENT_ID_MAX - this.#prefix.length,
      supportsQueryByClientOrderId: true, supportsPartialFills: true, supportsCancel: true,
      supportsPaper: this.#env.paper, requiresStaticIp: !this.#env.paper,
      // Binance rejects a duplicate client id only among OPEN orders; the OMS therefore
      // reconciles from history before any resend (Stage 17), which is what makes this safe.
      executionSafety: ExecutionSafety.IDEMPOTENT,
    });
  }

  /** Always queries /sapi/v1/account/apiRestrictions and evaluates it (no cache). */
  async validateKey(brokerAccountId) {
    const credential = await this._credentials(brokerAccountId);
    assertCredential(credential);
    const r = await this.#rest.request('GET', '/sapi/v1/account/apiRestrictions', {}, { signed: true, credential });
    return evaluateApiRestrictions(r);
  }

  async #credential(brokerAccountId) {
    const credential = await this._credentials(brokerAccountId);
    assertCredential(credential);
    if (this.#enforceKeys) {
      const hit = this.#checked.get(brokerAccountId);
      if (!hit || this.#clock().getTime() - hit > this.#ttl) {
        const r = await this.#rest.request('GET', '/sapi/v1/account/apiRestrictions', {}, { signed: true, credential });
        const v = evaluateApiRestrictions(r);
        if (!v.ok) throw new BrokerError(BrokerErrorCode.PERMISSION_DENIED, { venue: 'binance', message: `API key refused: ${v.violations.join('; ')}` });
        this.#checked.set(brokerAccountId, this.#clock().getTime());
      }
    }
    return credential;
  }

  async _placeOrder(brokerAccountId, order, instrument) {
    const credential = await this.#credential(brokerAccountId);
    const params = {
      symbol: instrument.venueSymbol, side: order.side.toUpperCase(), type: order.type.toUpperCase(), quantity: order.quantity,
      newClientOrderId: toVenueClientId(this.#prefix, order.clientOrderId), newOrderRespType: 'FULL',
    };
    if (order.type === 'limit') Object.assign(params, { price: order.limitPrice, timeInForce: (order.timeInForce ?? 'gtc').toUpperCase() });
    else if (order.timeInForce) throw new BrokerError(BrokerErrorCode.INVALID_REQUEST, { venue: 'binance', message: 'timeInForce applies to LIMIT orders only' });
    this.#symbols.set(order.clientOrderId, instrument.venueSymbol);
    const res = await this.#rest.request('POST', '/api/v3/order', params, { signed: true, credential });
    const s = orderSnapshot(this.#prefix, res, order.clientOrderId);
    return { outcome: 'placed', status: s.status, clientOrderId: order.clientOrderId, brokerOrderId: s.brokerOrderId, filledQuantity: s.filledQuantity, averagePrice: s.averagePrice };
  }

  async #symbolFor(brokerAccountId, ref) {
    const known = this.#symbols.get(ref.clientOrderId);
    if (known) return known;
    const canonical = this.#directory ? await this.#directory.instrumentFor(brokerAccountId, ref.clientOrderId) : null;
    const sym = canonical ? this.instruments.byCanonical(Venue.BINANCE, canonical)?.venueSymbol : null;
    if (!sym) throw new BrokerError(BrokerErrorCode.INVALID_REQUEST, { venue: 'binance', message: 'symbol unknown for this client order id (Binance queries need a symbol; inject an orderDirectory)' });
    this.#symbols.set(ref.clientOrderId, sym);
    return sym;
  }

  #refParams(ref) {
    return ref.brokerOrderId ? { orderId: ref.brokerOrderId } : { origClientOrderId: toVenueClientId(this.#prefix, ref.clientOrderId) };
  }

  async _getOrder(brokerAccountId, ref) {
    const credential = await this.#credential(brokerAccountId);
    const symbol = await this.#symbolFor(brokerAccountId, ref);
    const res = await this.#rest.request('GET', '/api/v3/order', { symbol, ...this.#refParams(ref) }, { signed: true, credential });
    return orderSnapshot(this.#prefix, res, ref.clientOrderId ?? null);
  }

  async _cancelOrder(brokerAccountId, ref) {
    const credential = await this.#credential(brokerAccountId);
    const symbol = await this.#symbolFor(brokerAccountId, ref);
    const res = await this.#rest.request('DELETE', '/api/v3/order', { symbol, ...this.#refParams(ref) }, { signed: true, credential });
    return orderSnapshot(this.#prefix, res, ref.clientOrderId ?? null);
  }

  async _listFills(brokerAccountId, ref) {
    const snap = await this._getOrder(brokerAccountId, ref);
    if (!snap.brokerOrderId || snap.filledQuantity === '0') return [];
    const credential = await this.#credential(brokerAccountId);
    const rows = await this.#rest.request('GET', '/api/v3/myTrades', { symbol: snap.venueSymbol ?? await this.#symbolFor(brokerAccountId, ref), orderId: snap.brokerOrderId }, { signed: true, credential });
    return tradesToFills(ref.clientOrderId, rows);
  }

  /**
   * User data over the WebSocket API (no listenKey). Ed25519 keys: session.logon then
   * userDataStream.subscribe; HMAC keys: userDataStream.subscribe.signature.
   * @returns { subscriptionId, close() }
   */
  async openUserStream(brokerAccountId, { onUpdate, onError = () => {}, webSocketFactory = (url) => new globalThis.WebSocket(url), requestId = () => crypto.randomUUID() } = {}) {
    const credential = await this.#credential(brokerAccountId);
    const ws = webSocketFactory(this.#env.wsApi);
    const pending = new Map();
    const call = (method, params) => new Promise((resolve, reject) => {
      const id = requestId();
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify(params ? { id, method, params } : { id, method }));
    });
    ws.addEventListener('message', (ev) => {
      let msg;
      try { msg = JSON.parse(typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString('utf8')); } catch (e) { onError(e); return; }
      if (msg.id !== undefined && pending.has(msg.id)) {
        const p = pending.get(msg.id); pending.delete(msg.id);
        if (msg.status === 200) p.resolve(msg.result); else p.reject(new BrokerError(msg.status === 401 ? BrokerErrorCode.AUTH_FAILED : BrokerErrorCode.REJECTED, { venue: 'binance', message: `${msg.error?.code ?? msg.status}: ${msg.error?.msg ?? 'websocket request failed'}` }));
        return;
      }
      if (msg.event) {
        try { const u = mapExecutionReport(this.#prefix, msg); if (u) onUpdate(u); } catch (e) { onError(e); }
      }
    });
    ws.addEventListener('error', (e) => onError(e));
    await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('close', () => reject(new BrokerError(BrokerErrorCode.VENUE_UNAVAILABLE, { venue: 'binance', message: 'websocket closed before open' })), { once: true }); });
    const signed = () => {
      const params = { apiKey: credential.apiKey, timestamp: this.#clock().getTime() };
      return { ...params, signature: signPayload(credential, wsSignaturePayload(params)) };
    };
    let result;
    if (credential.keyType === 'ed25519') {
      await call('session.logon', signed());
      result = await call('userDataStream.subscribe');
    } else {
      result = await call('userDataStream.subscribe.signature', signed());
    }
    return Object.freeze({
      subscriptionId: result?.subscriptionId ?? null,
      close: async () => { try { await call('userDataStream.unsubscribe'); } finally { ws.close(); } },
    });
  }
}
