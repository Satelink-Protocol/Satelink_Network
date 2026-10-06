// Fills and fees (Stage 10). Exact arithmetic only.
import { parseDecimal, formatDecimal, divRound, isPositive, toMinor, mulDecimal, Rounding } from './decimal.mjs';

/**
 * @param {object} raw { fillId, clientOrderId, brokerOrderId, quantity, price, fee: { amount, currency, decimals }, executedAt }
 * @returns frozen NormalizedFill with feeMinor as bigint
 */
export function normalizeFill(raw) {
  for (const k of ['fillId', 'clientOrderId', 'quantity', 'price', 'executedAt']) {
    if (raw?.[k] == null || raw[k] === '') throw new TypeError(`fill missing ${k}`);
  }
  if (!isPositive(raw.quantity)) throw new RangeError('fill quantity must be > 0');
  if (!isPositive(raw.price)) throw new RangeError('fill price must be > 0');
  const fee = raw.fee ?? { amount: '0', currency: null, decimals: 0 };
  const feeMinor = toMinor(fee.amount, fee.decimals, Rounding.EXACT); // venue fees are exact at their own precision
  if (feeMinor < 0n) throw new RangeError('fee must be >= 0');
  if (feeMinor > 0n && !fee.currency) throw new TypeError('fee currency required when fee > 0');
  const executedAt = new Date(raw.executedAt);
  if (Number.isNaN(executedAt.getTime())) throw new RangeError('invalid executedAt');
  return Object.freeze({
    fillId: String(raw.fillId),
    clientOrderId: raw.clientOrderId,
    brokerOrderId: raw.brokerOrderId ?? null,
    quantity: raw.quantity,
    price: raw.price,
    feeMinor,
    feeCurrency: fee.currency ?? null,
    feeDecimals: fee.decimals,
    executedAt: executedAt.toISOString(),
  });
}

/**
 * Aggregate fills: exact filled quantity and notional, average price rounded
 * HALF_EVEN to `priceDecimals`, fees summed per currency. Duplicate fill ids
 * are counted once (venues can redeliver fills).
 */
export function aggregateFills(fills, { priceDecimals }) {
  const seen = new Set();
  let qty = { units: 0n, scale: 0 };
  let notional = { units: 0n, scale: 0 };
  const fees = {};
  const add = (a, b) => {
    const s = Math.max(a.scale, b.scale);
    return { units: a.units * 10n ** BigInt(s - a.scale) + b.units * 10n ** BigInt(s - b.scale), scale: s };
  };
  for (const f of fills) {
    if (seen.has(f.fillId)) continue;
    seen.add(f.fillId);
    qty = add(qty, parseDecimal(f.quantity));
    notional = add(notional, parseDecimal(mulDecimal(f.quantity, f.price)));
    if (f.feeMinor > 0n) {
      const cur = fees[f.feeCurrency];
      if (cur && cur.decimals !== f.feeDecimals) throw new RangeError(`inconsistent fee decimals for ${f.feeCurrency}`);
      fees[f.feeCurrency] = { minor: (cur?.minor ?? 0n) + f.feeMinor, decimals: f.feeDecimals };
    }
  }
  let averagePrice = null;
  if (qty.units > 0n) {
    // avg = notional / qty, rounded to priceDecimals:  (N/10^sn) / (Q/10^sq) * 10^pd
    const num = notional.units * 10n ** BigInt(qty.scale + priceDecimals);
    const den = qty.units * 10n ** BigInt(notional.scale);
    averagePrice = formatDecimal(divRound(num, den, Rounding.HALF_EVEN), priceDecimals);
  }
  return Object.freeze({
    fillCount: seen.size,
    filledQuantity: formatDecimal(qty.units, qty.scale),
    notional: formatDecimal(notional.units, notional.scale),
    averagePrice,
    fees: Object.freeze(fees),
  });
}
