// Venue capability descriptor (Stage 10).
//
// Tells the OMS what a venue can do so it never sends an unsupported order.
// Venue-specific features are preserved as named `extensions`: an order may
// carry `extensions` only for keys the venue declares here.
import { AssetClass, OrderType, TimeInForce, Venue } from './types.mjs';
import { BrokerError, BrokerErrorCode } from './errors.mjs';

export const ExecutionSafety = Object.freeze({
  // Mirrors the concept in apps/api/src/vnext/kernel/interfaces.js (not imported, to stay decoupled).
  IDEMPOTENT: 'IDEMPOTENT',       // client order id dedupes at the venue → safe to resubmit after NOT_PLACED
  AT_MOST_ONCE: 'AT_MOST_ONCE',   // no venue-side dedupe → never resubmit without reconciliation
});

export function defineCapabilities(c) {
  const errs = [];
  if (!Object.values(Venue).includes(c.venue)) errs.push(`unknown venue ${c.venue}`);
  const inEnum = (arr, e, name) => {
    if (!Array.isArray(arr) || arr.length === 0) errs.push(`${name} must be a non-empty array`);
    else for (const v of arr) if (!Object.values(e).includes(v)) errs.push(`${name}: unknown value ${v}`);
  };
  inEnum(c.assetClasses, AssetClass, 'assetClasses');
  inEnum(c.orderTypes, OrderType, 'orderTypes');
  inEnum(c.timeInForce, TimeInForce, 'timeInForce');
  if (!Object.values(ExecutionSafety).includes(c.executionSafety)) errs.push('executionSafety invalid');
  if (c.executionSafety === ExecutionSafety.IDEMPOTENT && !c.supportsClientOrderId) errs.push('IDEMPOTENT requires supportsClientOrderId');
  if (!Number.isInteger(c.clientOrderIdMaxLength) || c.clientOrderIdMaxLength < 8) errs.push('clientOrderIdMaxLength must be an integer >= 8');
  for (const k of ['supportsClientOrderId', 'supportsQueryByClientOrderId', 'supportsPartialFills', 'supportsCancel', 'supportsPaper', 'requiresStaticIp']) {
    if (typeof c[k] !== 'boolean') errs.push(`${k} must be boolean`);
  }
  if (c.extensions != null && (typeof c.extensions !== 'object' || Array.isArray(c.extensions))) errs.push('extensions must be an object');
  if (errs.length) throw new TypeError(`invalid capabilities: ${errs.join('; ')}`);
  return Object.freeze({ ...c, extensions: Object.freeze({ ...(c.extensions || {}) }) });
}

/** Throw INVALID_REQUEST if a normalized order uses a feature the venue lacks. */
export function assertOrderSupported(caps, order, instrument) {
  const fail = (m) => { throw new BrokerError(BrokerErrorCode.INVALID_REQUEST, { venue: caps.venue, message: m }); };
  if (!caps.assetClasses.includes(instrument.assetClass)) fail(`asset class ${instrument.assetClass} not supported by ${caps.venue}`);
  if (!caps.orderTypes.includes(order.type)) fail(`order type ${order.type} not supported by ${caps.venue}`);
  if (order.timeInForce && !caps.timeInForce.includes(order.timeInForce)) fail(`time in force ${order.timeInForce} not supported by ${caps.venue}`);
  if (order.clientOrderId.length > caps.clientOrderIdMaxLength) fail(`clientOrderId longer than ${caps.clientOrderIdMaxLength}`);
  for (const key of Object.keys(order.extensions || {})) {
    if (!Object.prototype.hasOwnProperty.call(caps.extensions, key)) fail(`extension ${key} not declared by ${caps.venue}`);
  }
}
