// UpstoxCopilotAdapter (Stage 22): Upstox behind the Stage 10 contract, COPILOT mode only.
//
//   * environments: sandbox (default) or production — production is refused while LIVE_TRADING is
//     LOCKED; the UPSTOX_COPILOT flag is required to construct; UPSTOX_AUTOMATED is never consulted
//     except by config.algoHeaders(), which returns {} while it is locked;
//   * every place and modify needs a fresh HUMAN confirmation for exactly these terms (copilot.mjs);
//   * LIMIT only: MARKET (and every other type) is refused before anything is sent;
//   * placement mode (placement.mjs): API only from a dedicated, exclusive, registered per-customer
//     static IP — otherwise PREPARE_ONLY (placeOrder refuses; prepareOrder returns a ticket);
//   * per-user OAuth tokens from the encrypted vault via the injected CredentialLoader; never env;
//   * reconciliation by tag (GET /v2/order/details?tag=); ONE request per call, no retries;
//   * executionSafety AT_MOST_ONCE: Upstox does not dedupe tags, so the Stage 17 OMS (which requires
//     IDEMPOTENT) refuses Upstox for automated dispatch — consistent with COPILOT.
import { BrokerAdapter } from '../adapter.mjs';
import { defineCapabilities, ExecutionSafety } from '../capabilities.mjs';
import { normalizeOrderRequest } from '../order_request.mjs';
import { AssetClass, OrderType, TimeInForce, Venue } from '../types.mjs';
import { BrokerError, BrokerErrorCode } from '../errors.mjs';
import { isTradingFlagEnabled } from '../../flags.mjs';
import { resolveEnvironment, algoHeaders } from './config.mjs';
import { UpstoxRestClient } from './rest_client.mjs';
import { placeBody, orderSnapshot, tradesToFills, exactNumber } from './mapping.mjs';
import { orderDigest, requireConfirmation } from './copilot.mjs';
import { resolvePlacementMode, prepareOrderTicket, PlacementMode } from './placement.mjs';
import { UpstoxUserIpApi } from './static_ip.mjs';
import { UpstoxKillSwitch } from './kill_switch.mjs';
import { openPortfolioStream } from './portfolio_stream.mjs';

export const UPSTOX_ADAPTER_STATE = 'IMPLEMENTED/TESTED';
export const UPSTOX_MODE = 'COPILOT';

export class UpstoxCopilotAdapter extends BrokerAdapter {
  #env; #rest; #clock; #flags; #confirmations; #egress; #userIp; #product;

  /**
   * @param deps.confirmations { lookup({brokerAccountId, clientOrderId, action}) } — human confirmations (approval UI, B-02)
   * @param deps.egress        { assignmentFor(principalId) → { ip, principalId, exclusive, sharedWith } | null } — per-customer egress (B-08)
   * @param deps.env           flag environment (default {} = all off), never process.env; needs TRADING_FLAG_UPSTOX_COPILOT
   */
  constructor({ credentialLoader, instruments, environment = 'sandbox', fetch, clock = () => new Date(), env = {}, confirmations, egress = null, timeoutMs = 10_000, product = 'D' }) {
    super({ credentialLoader, instruments });
    if (!isTradingFlagEnabled('UPSTOX_COPILOT', env)) throw new BrokerError(BrokerErrorCode.PERMISSION_DENIED, { venue: 'upstox', message: 'the UPSTOX_COPILOT trading flag is off' });
    this.#env = resolveEnvironment(environment, env);
    this.#rest = new UpstoxRestClient({ fetch, timeoutMs });
    this.#clock = clock; this.#flags = env; this.#confirmations = confirmations; this.#egress = egress; this.#product = product;
    this.#userIp = new UpstoxUserIpApi({ rest: this.#rest, apiBase: this.#env.apiBase });
  }

  get environment() { return this.#env.name; }

  capabilities() {
    return defineCapabilities({
      venue: Venue.UPSTOX, assetClasses: [AssetClass.EQUITY], orderTypes: [OrderType.LIMIT], timeInForce: [TimeInForce.DAY, TimeInForce.IOC],
      supportsClientOrderId: true, clientOrderIdMaxLength: 20, supportsQueryByClientOrderId: true, supportsPartialFills: true, supportsCancel: true,
      supportsPaper: this.#env.paper, requiresStaticIp: !this.#env.paper, executionSafety: ExecutionSafety.AT_MOST_ONCE,
    });
  }

  async #account(brokerAccountId) {
    const c = await this._credentials(brokerAccountId);
    if (!c || typeof c.accessToken !== 'string' || !c.accessToken) throw new BrokerError(BrokerErrorCode.AUTH_FAILED, { venue: 'upstox', message: 'no Upstox access token for this account' });
    return c;
  }

  /** Where may this customer's order go? (API vs prepare-only) — reads GET /v2/user/ip in production. */
  async placementFor(brokerAccountId) {
    const c = await this.#account(brokerAccountId);
    if (this.#env.paper) return resolvePlacementMode({ environment: this.#env });
    const egress = this.#egress ? await this.#egress.assignmentFor(c.principalId) : null;
    const registeredIps = egress?.ip ? await this.#userIp.getStaticIps(c.accessToken) : null;
    return resolvePlacementMode({ environment: this.#env, egress, principalId: c.principalId, registeredIps });
  }

  /** Prepare-order fallback: validates and returns a ticket for the human to place. Never calls Upstox. */
  async prepareOrder(brokerAccountId, request) {
    const caps = this.capabilities();
    const instrument = this.instruments.byCanonical(caps.venue, request?.instrument);
    if (!instrument) throw new BrokerError(BrokerErrorCode.INSTRUMENT_NOT_TRADABLE, { venue: 'upstox', message: `unknown instrument ${request?.instrument}` });
    const order = normalizeOrderRequest(request, { instrument, capabilities: caps });
    placeBody(order, instrument, { product: this.#product }); // same validation as API placement
    return prepareOrderTicket(order, instrument, { product: this.#product });
  }

  async #confirm(action, brokerAccountId, order) {
    return requireConfirmation(this.#confirmations, {
      action, brokerAccountId, clientOrderId: order.clientOrderId, now: this.#clock().getTime(),
      digest: orderDigest({ action, brokerAccountId, clientOrderId: order.clientOrderId, instrument: order.instrument, side: order.side, type: order.type, quantity: order.quantity, limitPrice: order.limitPrice, timeInForce: order.timeInForce }),
    });
  }

  async _placeOrder(brokerAccountId, order, instrument) {
    const body = placeBody(order, instrument, { product: this.#product }); // LIMIT only, exact price
    const confirmation = await this.#confirm('place', brokerAccountId, order);
    const placement = await this.placementFor(brokerAccountId);
    if (placement.mode !== PlacementMode.API) throw new BrokerError(BrokerErrorCode.PERMISSION_DENIED, { venue: 'upstox', message: `API placement unavailable (prepare-order only): ${placement.reasons.join('; ')}` });
    const { accessToken } = await this.#account(brokerAccountId);
    const r = await this.#rest.request('POST', `${this.#env.orderBase}/v3/order/place`, { token: accessToken, body, headers: algoHeaders(this.#flags, null) });
    const ids = r?.data?.order_ids ?? [];
    if (ids.length !== 1) throw new BrokerError(BrokerErrorCode.AMBIGUOUS, { venue: 'upstox', message: `expected one order id, got ${ids.length}` });
    return { outcome: 'placed', status: 'pending_new', clientOrderId: order.clientOrderId, brokerOrderId: String(ids[0]), extensions: { confirmedBy: confirmation.confirmedBy, confirmationDigest: confirmation.digest } };
  }

  /**
   * Modify a working LIMIT order (price / quantity / validity). Needs its own human confirmation
   * (action 'modify') for the NEW terms.
   */
  async modifyOrder(brokerAccountId, { clientOrderId, brokerOrderId, instrument, side, quantity, limitPrice, timeInForce = 'day' }) {
    const spec = this.instruments.byCanonical(Venue.UPSTOX, instrument);
    if (!spec) throw new BrokerError(BrokerErrorCode.INSTRUMENT_NOT_TRADABLE, { venue: 'upstox', message: `unknown instrument ${instrument}` });
    if (!brokerOrderId) throw new BrokerError(BrokerErrorCode.INVALID_REQUEST, { venue: 'upstox', message: 'brokerOrderId required to modify' });
    const order = normalizeOrderRequest({ clientOrderId, instrument, side, type: 'limit', quantity, limitPrice, timeInForce }, { instrument: spec, capabilities: this.capabilities() });
    const body0 = placeBody(order, spec, { product: this.#product });
    await this.#confirm('modify', brokerAccountId, order);
    const placement = await this.placementFor(brokerAccountId);
    if (placement.mode !== PlacementMode.API) throw new BrokerError(BrokerErrorCode.PERMISSION_DENIED, { venue: 'upstox', message: `API placement unavailable (prepare-order only): ${placement.reasons.join('; ')}` });
    const { accessToken } = await this.#account(brokerAccountId);
    const body = { order_id: String(brokerOrderId), quantity: body0.quantity, validity: body0.validity, price: exactNumber(order.limitPrice, 'price'), order_type: 'LIMIT', trigger_price: 0 };
    const r = await this.#rest.request('PUT', `${this.#env.orderBase}/v3/order/modify`, { token: accessToken, body, headers: algoHeaders(this.#flags, null) });
    return Object.freeze({ clientOrderId, brokerOrderId: String(r?.data?.order_id ?? brokerOrderId), accepted: true });
  }

  async #details(token, ref) {
    const query = ref.brokerOrderId ? { order_id: ref.brokerOrderId } : { tag: ref.clientOrderId };
    const r = await this.#rest.request('GET', `${this.#env.apiBase}/v2/order/details`, { token, query });
    return orderSnapshot(r?.data ?? {});
  }

  async _getOrder(brokerAccountId, ref) {
    const { accessToken } = await this.#account(brokerAccountId);
    const snap = await this.#details(accessToken, ref);
    if (ref.clientOrderId && snap.clientOrderId && snap.clientOrderId !== ref.clientOrderId) throw new BrokerError(BrokerErrorCode.INTERNAL, { venue: 'upstox', message: 'venue returned a different order than requested' });
    return snap;
  }

  /** Cancelling reduces risk, so it needs no confirmation (also used by kill switches and revocations). */
  async _cancelOrder(brokerAccountId, ref) {
    const { accessToken } = await this.#account(brokerAccountId);
    const orderId = ref.brokerOrderId ?? (await this.#details(accessToken, ref)).brokerOrderId;
    if (!orderId) throw new BrokerError(BrokerErrorCode.ORDER_NOT_FOUND, { venue: 'upstox', message: 'no Upstox order id for this client order id' });
    await this.#rest.request('DELETE', `${this.#env.orderBase}/v3/order/cancel`, { token: accessToken, query: { order_id: orderId } });
    return this.#details(accessToken, { brokerOrderId: orderId });
  }

  async _listFills(brokerAccountId, ref) {
    const { accessToken } = await this.#account(brokerAccountId);
    const snap = ref.brokerOrderId ? { brokerOrderId: ref.brokerOrderId, clientOrderId: ref.clientOrderId ?? null } : await this.#details(accessToken, ref);
    if (!snap.brokerOrderId) return [];
    const r = await this.#rest.request('GET', `${this.#env.apiBase}/v2/order/trades`, { token: accessToken, query: { order_id: snap.brokerOrderId } });
    return tradesToFills(ref.clientOrderId ?? snap.clientOrderId, r?.data ?? []);
  }

  /** Static IP read API for this user (production only; the sandbox has no /v2/user/ip). */
  async staticIps(brokerAccountId) {
    const { accessToken } = await this.#account(brokerAccountId);
    return this.#userIp.getStaticIps(accessToken);
  }

  /** The user's venue kill switch (status / engage / release with the 12-hour cooling period). */
  killSwitch() { return new UpstoxKillSwitch({ rest: this.#rest, apiBase: this.#env.apiBase, clock: this.#clock }); }

  async openPortfolioStream(brokerAccountId, opts) {
    const { accessToken } = await this.#account(brokerAccountId);
    return openPortfolioStream({ rest: this.#rest, apiBase: this.#env.apiBase, token: accessToken, ...opts });
  }
}
