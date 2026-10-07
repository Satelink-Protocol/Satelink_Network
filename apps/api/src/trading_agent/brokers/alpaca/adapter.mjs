// AlpacaBrokerAdapter (Stage 23): Alpaca Broker API (correspondent model) behind the Stage 10
// contract.
//   * sandbox only: production is refused while LIVE_TRADING is LOCKED; the ALPACA flag is required;
//   * the correspondent credential (one firm key) comes only from the injected CredentialLoader
//     (KMS in production, B-08); end-user accounts are addressed by Alpaca account id via an
//     injected directory — no per-user secret exists in this model;
//   * every order carries Satelink's commission instruction (commission + commission_type), from an
//     injected policy and bounded by hard caps; none → no commission field;
//   * client_order_id ≤ 48; Alpaca rejects a duplicate client_order_id (422) and supports lookup by
//     it, so the Stage 17 OMS can use it: timeout → AMBIGUOUS → UNKNOWN → reconciled, never resent;
//   * ONE request per call, no retries; trade events via SSE (/v2/events/trades) with resume by id.
import { BrokerAdapter } from '../adapter.mjs';
import { defineCapabilities, ExecutionSafety } from '../capabilities.mjs';
import { AssetClass, OrderType, TimeInForce, Venue } from '../types.mjs';
import { BrokerError, BrokerErrorCode } from '../errors.mjs';
import { isTradingFlagEnabled } from '../../flags.mjs';
import { resolveEnvironment, ALPACA_CLIENT_ID_MAX } from './config.mjs';
import { AlpacaRestClient } from './rest_client.mjs';
import { commissionFields } from './commission.mjs';
import { orderBody, orderSnapshot, activitiesToFills, accountSummary, mapTradeEvent } from './mapping.mjs';
import { parseSse } from './sse.mjs';

export const ALPACA_ADAPTER_STATE = 'IMPLEMENTED/TESTED';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class AlpacaBrokerAdapter extends BrokerAdapter {
  #env; #rest; #accounts; #policy; #caps;

  /**
   * @param deps.accounts          { alpacaAccountIdFor(brokerAccountId) → UUID }
   * @param deps.commissionPolicy  { forOrder({ brokerAccountId, order, instrument }) → { amount, type } | null }
   * @param deps.commissionCaps    { maxNotional, maxPerQty, maxBps } hard bounds
   * @param deps.env               flag environment (default {} = all off), never process.env; needs TRADING_FLAG_ALPACA
   */
  constructor({ credentialLoader, instruments, environment = 'sandbox', fetch, env = {}, accounts, commissionPolicy = null, commissionCaps = {}, timeoutMs = 10_000 }) {
    super({ credentialLoader, instruments });
    if (!isTradingFlagEnabled('ALPACA', env)) throw new BrokerError(BrokerErrorCode.PERMISSION_DENIED, { venue: 'alpaca', message: 'the ALPACA trading flag is off' });
    if (typeof accounts?.alpacaAccountIdFor !== 'function') throw new BrokerError(BrokerErrorCode.INTERNAL, { venue: 'alpaca', message: 'AlpacaBrokerAdapter needs an account directory' });
    this.#env = resolveEnvironment(environment, env);
    this.#rest = new AlpacaRestClient({ baseUrl: this.#env.base, fetch, timeoutMs });
    this.#accounts = accounts; this.#policy = commissionPolicy; this.#caps = commissionCaps;
  }

  get environment() { return this.#env.name; }

  capabilities() {
    return defineCapabilities({
      venue: Venue.ALPACA, assetClasses: [AssetClass.EQUITY], orderTypes: [OrderType.MARKET, OrderType.LIMIT],
      timeInForce: [TimeInForce.DAY, TimeInForce.GTC, TimeInForce.IOC, TimeInForce.FOK],
      supportsClientOrderId: true, clientOrderIdMaxLength: ALPACA_CLIENT_ID_MAX, supportsQueryByClientOrderId: true, supportsPartialFills: true, supportsCancel: true,
      supportsPaper: this.#env.paper, requiresStaticIp: false, executionSafety: ExecutionSafety.IDEMPOTENT,
    });
  }

  async #ctx(brokerAccountId) {
    const credential = await this._credentials(brokerAccountId);
    const accountId = await this.#accounts.alpacaAccountIdFor(brokerAccountId);
    if (!UUID.test(String(accountId ?? ''))) throw new BrokerError(BrokerErrorCode.INVALID_REQUEST, { venue: 'alpaca', message: 'no Alpaca account id for this broker account' });
    return { credential, accountId };
  }

  async _placeOrder(brokerAccountId, order, instrument) {
    const { credential, accountId } = await this.#ctx(brokerAccountId);
    const instruction = this.#policy ? await this.#policy.forOrder({ brokerAccountId, order, instrument }) : null;
    const commission = instruction ? commissionFields(instruction, this.#caps) : null;
    const res = await this.#rest.request('POST', `/v1/trading/accounts/${accountId}/orders`, { credential, body: orderBody(order, instrument, commission) });
    const s = orderSnapshot(res);
    if (s.clientOrderId !== order.clientOrderId) throw new BrokerError(BrokerErrorCode.INTERNAL, { venue: 'alpaca', message: 'venue echoed a different client_order_id' });
    return {
      outcome: 'placed', status: s.status, clientOrderId: order.clientOrderId, brokerOrderId: s.brokerOrderId, filledQuantity: s.filledQuantity, averagePrice: s.averagePrice,
      extensions: { commission: commission?.commission ?? null, commissionType: commission?.commission_type ?? null },
    };
  }

  async #find(credential, accountId, ref) {
    if (ref.brokerOrderId) return this.#rest.request('GET', `/v1/trading/accounts/${accountId}/orders/${encodeURIComponent(ref.brokerOrderId)}`, { credential });
    return this.#rest.request('GET', `/v1/trading/accounts/${accountId}/orders:by_client_order_id`, { credential, query: { client_order_id: ref.clientOrderId } });
  }

  async _getOrder(brokerAccountId, ref) {
    const { credential, accountId } = await this.#ctx(brokerAccountId);
    return orderSnapshot(await this.#find(credential, accountId, ref));
  }

  async _cancelOrder(brokerAccountId, ref) {
    const { credential, accountId } = await this.#ctx(brokerAccountId);
    const id = ref.brokerOrderId ?? (await this.#find(credential, accountId, ref)).id;
    await this.#rest.request('DELETE', `/v1/trading/accounts/${accountId}/orders/${encodeURIComponent(id)}`, { credential });
    return orderSnapshot(await this.#find(credential, accountId, { brokerOrderId: id }));
  }

  async _listFills(brokerAccountId, ref) {
    const { credential, accountId } = await this.#ctx(brokerAccountId);
    const o = await this.#find(credential, accountId, ref);
    if (!o?.id || !(Number(o.filled_qty) > 0)) return [];
    const rows = await this.#rest.request('GET', '/v1/accounts/activities/FILL', { credential, query: { account_id: accountId, direction: 'asc' } });
    return activitiesToFills(o.client_order_id, o.id, rows ?? []);
  }

  /** Read-only account summary; identity and contact PII never leave this method. */
  async readAccount(brokerAccountId) {
    const { credential, accountId } = await this.#ctx(brokerAccountId);
    return accountSummary(await this.#rest.request('GET', `/v1/accounts/${accountId}`, { credential }));
  }

  /**
   * Firm-wide trade events (SSE). Resume from the last durably processed event id (since_id) or a
   * date (since). Yields mapped events; `close()` aborts the stream.
   * @param brokerAccountId any account of the correspondent (selects the credential)
   */
  async streamTradeEvents(brokerAccountId, { sinceId = null, untilId = null, since = null, until = null, onComment } = {}) {
    if (sinceId && since) throw new BrokerError(BrokerErrorCode.INVALID_REQUEST, { venue: 'alpaca', message: 'since and since_id cannot be combined' });
    const credential = await this._credentials(brokerAccountId);
    const { response, abort } = await this.#rest.request('GET', '/v2/events/trades', { credential, stream: true, query: { since_id: sinceId, until_id: untilId, since, until } });
    async function* events() {
      for await (const msg of parseSse(response.body, { onComment })) yield mapTradeEvent(JSON.parse(msg.data));
    }
    return { events: events(), close: abort };
  }
}
