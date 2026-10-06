// Commission (Stage 23): the fee Satelink, as correspondent, asks Alpaca to collect on an order.
// Alpaca semantics (Broker API trading docs):
//   notional (default) — a dollar amount per order;
//   qty                — a dollar amount per share/contract, pro-rated;
//   bps                — basis points of the order's notional (Alpaca converts to notional).
//   On every type the commission is PRO-RATED per execution; on a sell, a commission above the
//   principal is capped at the principal (net of SEC/TAF fees).
// Satelink policy is injected (pricing = Phase 12, B-09) and bounded here; the expected per-fill
// split below is our ESTIMATE for the simulated book (cents, half-even, last fill takes the
// remainder for per-order amounts). Alpaca's own figures are the authority when reconciling.
import { BrokerError, BrokerErrorCode } from '../errors.mjs';
import { parseDecimal, divRound, Rounding, compareDecimal, mulDecimal, addDecimal } from '../decimal.mjs';
import { CommissionType } from './config.mjs';

const bad = (m) => new BrokerError(BrokerErrorCode.INVALID_REQUEST, { venue: 'alpaca', message: m });
const DEC = /^\d+(\.\d+)?$/;

/** Validate a commission instruction against hard bounds. @returns { commission, commission_type } for the order body */
export function commissionFields({ amount, type = CommissionType.NOTIONAL }, { maxNotional = '50', maxPerQty = '0.05', maxBps = '100' } = {}) {
  if (!Object.values(CommissionType).includes(type)) throw bad(`commission_type ${type} not one of notional|qty|bps`);
  if (typeof amount !== 'string' || !DEC.test(amount)) throw bad('commission must be a non-negative decimal string');
  const cap = { notional: maxNotional, qty: maxPerQty, bps: maxBps }[type];
  if (compareDecimal(amount, cap) > 0) throw bad(`commission ${amount} (${type}) exceeds the Satelink cap ${cap}`);
  if (type === CommissionType.NOTIONAL && (amount.split('.')[1] ?? '').length > 2) throw bad('notional commission is in dollars: at most 2 decimals');
  return Object.freeze({ commission: amount, commission_type: type });
}

const cents = (decimal) => { // decimal string → integer cents, half-even
  const d = parseDecimal(decimal);
  return d.scale <= 2 ? d.units * 10n ** BigInt(2 - d.scale) : divRound(d.units, 10n ** BigInt(d.scale - 2), Rounding.HALF_EVEN);
};

/**
 * Expected commission per execution (cents), pro-rated as Alpaca describes.
 * @param order  { qty, side, commission, commissionType }
 * @param fills  [{ fillId, qty, price }] in execution order
 */
export function expectedCommissionByFill(order, fills) {
  const { commission, commissionType = CommissionType.NOTIONAL } = order;
  if (!commission) return fills.map((f) => ({ fillId: f.fillId, cents: 0n }));
  const out = [];
  if (commissionType === CommissionType.NOTIONAL) {
    const total = cents(commission);
    const orderQty = parseDecimal(order.qty);
    let used = 0n; let filled = '0';
    for (const f of fills) {
      filled = addDecimal(filled, f.qty);
      const done = compareDecimal(filled, order.qty) >= 0;
      // cumulative share: total × filled / orderQty, so rounding never drifts; the final fill lands exactly on total
      const fq = parseDecimal(filled);
      const cum = done ? total : divRound(total * fq.units * 10n ** BigInt(orderQty.scale), orderQty.units * 10n ** BigInt(fq.scale), Rounding.HALF_EVEN);
      out.push({ fillId: f.fillId, cents: cum - used });
      used = cum;
    }
  } else if (commissionType === CommissionType.QTY) {
    for (const f of fills) out.push({ fillId: f.fillId, cents: cents(mulDecimal(commission, f.qty)) });
  } else {
    for (const f of fills) {
      const notional = mulDecimal(f.qty, f.price);
      const n = parseDecimal(mulDecimal(notional, commission)); // × bps
      out.push({ fillId: f.fillId, cents: divRound(n.units, 10n ** BigInt(n.scale) * 100n, Rounding.HALF_EVEN) }); // /10000 bps, ×100 cents
    }
  }
  if (order.side === 'sell') { // cap at principal per fill (SEC/TAF ignored in the estimate)
    for (let i = 0; i < out.length; i++) {
      const principal = cents(mulDecimal(fills[i].qty, fills[i].price));
      if (out[i].cents > principal) out[i].cents = principal;
    }
  }
  return out.map((r) => Object.freeze(r));
}
