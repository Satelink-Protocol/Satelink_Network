// Position and P&L maths (Stage 18). Pure, exact (18-dp fixed-point bigint, half-even).
//
// foldPosition(fills) — AVERAGE-COST method over ALL fills of one (account, instrument, mode),
// sorted by (executedAt, fillId), so the result never depends on arrival order:
//   * a fill in the direction of the position (or from flat) re-averages the entry price;
//   * a fill against it realises (exit − avg) × closed qty (sign-adjusted for shorts);
//   * a fill larger than the position closes it and opens the remainder at the fill price;
//   * fees in the quote currency reduce realised P&L and are totalled; fees in any other
//     currency (e.g. BNB) are kept per currency, never silently converted.
// valuePosition(position, mark) — unrealised P&L and exposure at a mark price.
import { fx, toDecimal, mul, div, abs, divHalfEven, ONE } from '../strategies/fixed.mjs';
import { PortfolioError } from './errors.mjs';

const sortFills = (fills) => [...fills].sort((a, b) => (a.executedAt < b.executedAt ? -1 : a.executedAt > b.executedAt ? 1 : a.fillId < b.fillId ? -1 : a.fillId > b.fillId ? 1 : 0));
const sign = (x) => (x > 0n ? 1n : x < 0n ? -1n : 0n);

/** Fixed-point quote amount → integer minor units (half-even). */
export function toMinorUnits(fixedAmount, decimals) {
  return divHalfEven(fixedAmount * 10n ** BigInt(decimals), ONE);
}

/**
 * @param fills [{ fillId, side: 'buy'|'sell', quantity, price, feeMinor (bigint|string), feeCurrency, feeDecimals, executedAt }]
 * @param opts  { quoteCurrency, quoteDecimals }
 */
export function foldPosition(fills, { quoteCurrency, quoteDecimals }) {
  if (!Number.isInteger(quoteDecimals) || quoteDecimals < 0 || quoteDecimals > 18) throw new PortfolioError('CONFIG', 'quoteDecimals must be 0..18');
  let qty = 0n;      // signed, fixed-point
  let avg = 0n;      // fixed-point price; 0 when flat
  let realized = 0n; // fixed-point quote, after quote-currency fees
  let gross = 0n;    // realised before fees
  let fees = 0n;     // fixed-point quote
  const otherFees = {};
  const seen = new Set();
  let count = 0;
  let last = null;
  for (const f of sortFills(fills)) {
    if (seen.has(f.fillId)) continue; // venues redeliver fills
    seen.add(f.fillId);
    if (f.side !== 'buy' && f.side !== 'sell') throw new PortfolioError('INVALID', `fill ${f.fillId}: bad side`);
    const q = fx(f.quantity);
    const p = fx(f.price);
    if (q <= 0n || p <= 0n) throw new PortfolioError('INVALID', `fill ${f.fillId}: quantity and price must be > 0`);
    const s = f.side === 'buy' ? 1n : -1n;
    if (qty === 0n || sign(qty) === s) {
      avg = div(mul(abs(qty), avg) + mul(q, p), abs(qty) + q);
      qty += s * q;
    } else {
      const closing = q < abs(qty) ? q : abs(qty);
      const pnl = mul(closing, p - avg) * sign(qty);
      realized += pnl; gross += pnl;
      qty += s * closing;
      const rest = q - closing;
      if (qty === 0n) avg = 0n;
      if (rest > 0n) { qty = s * rest; avg = p; }
    }
    const feeMinor = BigInt(f.feeMinor ?? 0);
    if (feeMinor > 0n) {
      if (f.feeCurrency === quoteCurrency) {
        const fee = divHalfEven(feeMinor * ONE, 10n ** BigInt(f.feeDecimals));
        fees += fee; realized -= fee;
      } else {
        otherFees[f.feeCurrency] = (BigInt(otherFees[f.feeCurrency] ?? 0) + feeMinor).toString();
      }
    }
    count += 1;
    last = f.executedAt;
  }
  return Object.freeze({
    quantity: toDecimal(qty),
    avgEntryPrice: qty === 0n ? null : toDecimal(avg),
    realizedPnl: toDecimal(realized),
    realizedPnlMinor: toMinorUnits(realized, quoteDecimals).toString(),
    grossRealizedPnl: toDecimal(gross),
    fees: toDecimal(fees),
    feesMinor: toMinorUnits(fees, quoteDecimals).toString(),
    unconvertedFees: Object.freeze(otherFees),
    fillCount: count,
    lastFillAt: last,
  });
}

/** Unrealised P&L and exposure of a folded position at `mark` (decimal string). */
export function valuePosition(position, mark, { quoteDecimals }) {
  const q = fx(position.quantity);
  const m = fx(mark);
  if (m <= 0n) throw new PortfolioError('INVALID', 'mark must be > 0');
  const unrealized = q === 0n ? 0n : mul(q, m - fx(position.avgEntryPrice));
  const net = mul(q, m);
  return Object.freeze({
    mark,
    unrealizedPnl: toDecimal(unrealized),
    unrealizedPnlMinor: toMinorUnits(unrealized, quoteDecimals).toString(),
    netExposure: toDecimal(net),
    netExposureMinor: toMinorUnits(net, quoteDecimals).toString(),
    grossExposure: toDecimal(abs(net)),
    grossExposureMinor: toMinorUnits(abs(net), quoteDecimals).toString(),
  });
}
