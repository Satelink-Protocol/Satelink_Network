// Order request normalization + secret guard (Stage 10).
import { OrderSide, OrderType, TimeInForce } from './types.mjs';
import { BrokerError, BrokerErrorCode } from './errors.mjs';
import { compareDecimal, isMultipleOf, isPositive, mulDecimal, toMinor, Rounding } from './decimal.mjs';
import { assertOrderSupported } from './capabilities.mjs';

const ALLOWED_KEYS = new Set(['clientOrderId', 'instrument', 'side', 'type', 'timeInForce', 'quantity', 'limitPrice', 'stopPrice', 'extensions']);
const CLIENT_ORDER_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const SECRET_KEY_RE = /(secret|password|passphrase|api[_-]?key|apikey|private|token|signature|credential|bearer|authorization)/i;

/**
 * Reject any object graph carrying secret-looking keys. Callers pass account
 * references (broker_account_id), never secrets; only a CredentialLoader may
 * resolve credentials, inside the adapter.
 */
export function assertNoSecrets(value, path = 'request', depth = 0) {
  if (depth > 6 || value == null || typeof value !== 'object') return;
  for (const [k, v] of Object.entries(value)) {
    if (SECRET_KEY_RE.test(k)) {
      throw new BrokerError(BrokerErrorCode.INVALID_REQUEST, { message: `${path}.${k}: secrets must not be passed to a broker adapter` });
    }
    assertNoSecrets(v, `${path}.${k}`, depth + 1);
  }
}

/**
 * Validate a caller order request against the instrument and venue capabilities.
 * @returns a frozen NormalizedOrder
 */
export function normalizeOrderRequest(input, { instrument, capabilities }) {
  const bad = (m) => { throw new BrokerError(BrokerErrorCode.INVALID_REQUEST, { venue: capabilities.venue, message: m }); };
  if (input == null || typeof input !== 'object' || Array.isArray(input)) bad('order request must be an object');
  assertNoSecrets(input);
  for (const k of Object.keys(input)) if (!ALLOWED_KEYS.has(k)) bad(`unknown field ${k}`);

  const { clientOrderId, side, type, timeInForce = null, quantity, limitPrice = null, stopPrice = null, extensions = {} } = input;
  if (typeof clientOrderId !== 'string' || !CLIENT_ORDER_ID_RE.test(clientOrderId)) bad('clientOrderId must match [A-Za-z0-9_-]{8,64}');
  if (input.instrument !== instrument.canonical) bad(`instrument ${input.instrument} does not match ${instrument.canonical}`);
  if (!Object.values(OrderSide).includes(side)) bad(`invalid side ${side}`);
  if (!Object.values(OrderType).includes(type)) bad(`invalid type ${type}`);
  if (timeInForce !== null && !Object.values(TimeInForce).includes(timeInForce)) bad(`invalid timeInForce ${timeInForce}`);

  const dec = (name, v) => {
    if (typeof v !== 'string') bad(`${name} must be a decimal string`);
    try { if (!isPositive(v)) bad(`${name} must be > 0`); } catch (e) { if (e instanceof BrokerError) throw e; bad(`${name}: ${e.message}`); }
    return v;
  };
  dec('quantity', quantity);
  if (!isMultipleOf(quantity, instrument.lotSize)) bad(`quantity ${quantity} is not a multiple of lot size ${instrument.lotSize}`);
  if (compareDecimal(quantity, instrument.minQuantity) < 0) bad(`quantity below minimum ${instrument.minQuantity}`);

  const needsLimit = type === OrderType.LIMIT || type === OrderType.STOP_LIMIT;
  const needsStop = type === OrderType.STOP || type === OrderType.STOP_LIMIT;
  if (needsLimit) { dec('limitPrice', limitPrice); if (!isMultipleOf(limitPrice, instrument.tickSize)) bad(`limitPrice not a multiple of tick ${instrument.tickSize}`); }
  else if (limitPrice !== null) bad(`limitPrice not allowed for ${type}`);
  if (needsStop) { dec('stopPrice', stopPrice); if (!isMultipleOf(stopPrice, instrument.tickSize)) bad(`stopPrice not a multiple of tick ${instrument.tickSize}`); }
  else if (stopPrice !== null) bad(`stopPrice not allowed for ${type}`);

  let notionalMinor = null;
  if (needsLimit) {
    const notional = mulDecimal(quantity, limitPrice);
    if (compareDecimal(notional, instrument.minNotional) < 0) bad(`notional ${notional} below minimum ${instrument.minNotional}`);
    notionalMinor = toMinor(notional, instrument.quoteDecimals, Rounding.CEIL); // never understate exposure
  }
  if (extensions === null || typeof extensions !== 'object' || Array.isArray(extensions)) bad('extensions must be an object');

  const order = Object.freeze({
    clientOrderId,
    instrument: instrument.canonical,
    venueSymbol: instrument.venueSymbol,
    side,
    type,
    timeInForce,
    quantity,
    limitPrice,
    stopPrice,
    notionalMinor,
    quoteCurrency: instrument.quoteCurrency,
    quoteDecimals: instrument.quoteDecimals,
    extensions: Object.freeze({ ...extensions }),
  });
  assertOrderSupported(capabilities, order, instrument);
  return order;
}
