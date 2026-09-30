// BrokerAdapter — the venue-agnostic contract every broker connector implements (Stage 10).
//
// Public methods validate and normalize, then call protected `_`-prefixed
// hooks that a concrete adapter overrides. Callers identify accounts by
// broker_account_id ('bka_…', migration 021) and NEVER pass secrets. The only
// way an adapter obtains credentials is its injected CredentialLoader, and it
// must never return, log or embed them in results.
import { BrokerError, BrokerErrorCode } from './errors.mjs';
import { normalizeOrderRequest, assertNoSecrets } from './order_request.mjs';
import { BrokerOrderStatus, SubmitOutcome } from './types.mjs';

const BROKER_ACCOUNT_ID_RE = /^bka_[A-Za-z0-9_-]{4,64}$/;

/**
 * @typedef {object} CredentialLoader
 * @property {(brokerAccountId: string) => Promise<object>} load  returns an opaque handle for the adapter's own use
 */

/**
 * @typedef {object} SubmitResult
 * @property {string} outcome       SubmitOutcome
 * @property {string} status        BrokerOrderStatus
 * @property {string} clientOrderId
 * @property {string|null} brokerOrderId
 * @property {object} [extensions]  venue-specific data, preserved verbatim (never secrets)
 */

export class BrokerAdapter {
  #credentialLoader;

  /**
   * @param {object} deps
   * @param {CredentialLoader} deps.credentialLoader
   * @param {import('./symbols.mjs').InstrumentRegistry} deps.instruments
   */
  constructor({ credentialLoader, instruments } = {}) {
    if (!credentialLoader || typeof credentialLoader.load !== 'function') {
      throw new TypeError('BrokerAdapter requires a credentialLoader with load(brokerAccountId)');
    }
    if (!instruments || typeof instruments.byCanonical !== 'function') throw new TypeError('BrokerAdapter requires an InstrumentRegistry');
    this.#credentialLoader = credentialLoader;
    this.instruments = instruments;
  }

  /** @returns a frozen descriptor from defineCapabilities() */
  capabilities() { throw new Error(`${this.constructor.name}.capabilities() not implemented`); }

  /** Resolve credentials for the adapter's own use only (protected). */
  async _credentials(brokerAccountId) {
    return this.#credentialLoader.load(brokerAccountId);
  }

  /** Normalize + validate, then submit. @returns {Promise<SubmitResult>} */
  async placeOrder(brokerAccountId, request) {
    assertAccountRef(brokerAccountId);
    const caps = this.capabilities();
    const instrument = this.instruments.byCanonical(caps.venue, request?.instrument);
    if (!instrument) throw new BrokerError(BrokerErrorCode.INSTRUMENT_NOT_TRADABLE, { venue: caps.venue, message: `unknown instrument ${request?.instrument}` });
    const order = normalizeOrderRequest(request, { instrument, capabilities: caps });
    const result = await this._placeOrder(brokerAccountId, order, instrument);
    return assertSubmitResult(result, order);
  }

  /** @param {{clientOrderId?:string, brokerOrderId?:string}} ref */
  async cancelOrder(brokerAccountId, ref) {
    assertAccountRef(brokerAccountId);
    assertOrderRef(ref);
    return this._cancelOrder(brokerAccountId, ref);
  }

  /** Query by client order id (the reconciliation path after AMBIGUOUS) or broker order id. */
  async getOrder(brokerAccountId, ref) {
    assertAccountRef(brokerAccountId);
    assertOrderRef(ref);
    return this._getOrder(brokerAccountId, ref);
  }

  async listFills(brokerAccountId, ref) {
    assertAccountRef(brokerAccountId);
    assertOrderRef(ref);
    return this._listFills(brokerAccountId, ref);
  }

  // Protected hooks — concrete adapters implement these.
  async _placeOrder() { throw new Error(`${this.constructor.name}._placeOrder() not implemented`); }
  async _cancelOrder() { throw new Error(`${this.constructor.name}._cancelOrder() not implemented`); }
  async _getOrder() { throw new Error(`${this.constructor.name}._getOrder() not implemented`); }
  async _listFills() { throw new Error(`${this.constructor.name}._listFills() not implemented`); }
}

function assertAccountRef(id) {
  if (typeof id !== 'string' || !BROKER_ACCOUNT_ID_RE.test(id)) {
    throw new BrokerError(BrokerErrorCode.INVALID_REQUEST, { message: 'brokerAccountId must be a broker account reference (bka_…), never a credential' });
  }
}

function assertOrderRef(ref) {
  if (ref == null || typeof ref !== 'object') throw new BrokerError(BrokerErrorCode.INVALID_REQUEST, { message: 'order ref required' });
  assertNoSecrets(ref, 'ref');
  const keys = Object.keys(ref);
  if (keys.some((k) => k !== 'clientOrderId' && k !== 'brokerOrderId') || keys.length === 0) {
    throw new BrokerError(BrokerErrorCode.INVALID_REQUEST, { message: 'order ref must contain only clientOrderId and/or brokerOrderId' });
  }
}

function assertSubmitResult(r, order) {
  if (!r || !Object.values(SubmitOutcome).includes(r.outcome) || !Object.values(BrokerOrderStatus).includes(r.status)) {
    throw new BrokerError(BrokerErrorCode.INTERNAL, { message: 'adapter returned a malformed SubmitResult' });
  }
  if (r.clientOrderId !== order.clientOrderId) throw new BrokerError(BrokerErrorCode.INTERNAL, { message: 'adapter changed clientOrderId' });
  if (r.extensions) assertNoSecrets(r.extensions, 'result.extensions');
  return Object.freeze({ ...r });
}
