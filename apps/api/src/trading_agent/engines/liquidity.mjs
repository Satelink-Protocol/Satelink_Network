// Liquidity / spread engine (Phase 6 item 4). Pure: order book (+ intended order) → spread, depth,
// imbalance and estimated slippage by walking the book. Flags feed the scorecard's hard gates.
//   book: { bids: [[price, size], …] best first, asks: [[price, size], …] best first } (decimal strings)
import { LIQUIDITY_CONFIG } from './config.mjs';
import { fx, fxInt, toDecimal, add, sub, mul, div, divInt } from '../strategies/fixed.mjs';

const BPS = fxInt(10_000);

function levels(side, name) {
  if (!Array.isArray(side) || side.length === 0) throw Object.assign(new Error(`${name} side empty`), { code: 'EMPTY_BOOK' });
  return side.map(([p, s]) => ({ price: fx(p), size: fx(s) }));
}

/**
 * @param {{ side: 'buy'|'sell', notional: string }} [order] quote-currency notional to evaluate
 */
export function analyzeLiquidity(book, order = null, cfg = LIQUIDITY_CONFIG) {
  const bids = levels(book.bids, 'bid'); const asks = levels(book.asks, 'ask');
  for (let i = 1; i < bids.length; i += 1) if (bids[i].price > bids[i - 1].price) throw Object.assign(new Error('bids not sorted best-first'), { code: 'INVALID_BOOK' });
  for (let i = 1; i < asks.length; i += 1) if (asks[i].price < asks[i - 1].price) throw Object.assign(new Error('asks not sorted best-first'), { code: 'INVALID_BOOK' });
  const bestBid = bids[0].price; const bestAsk = asks[0].price;
  if (bestBid >= bestAsk) throw Object.assign(new Error('crossed or locked book'), { code: 'INVALID_BOOK' });
  const mid = divInt(add(bestBid, bestAsk), 2);
  const spreadBps = mul(div(sub(bestAsk, bestBid), mid), BPS);
  const band = div(mul(mid, fxInt(cfg.depthBandBps)), BPS);
  const depth = (ls, inBand) => ls.filter((l) => inBand(l.price)).reduce((s, l) => add(s, mul(l.price, l.size)), 0n);
  const bidDepth = depth(bids, (p) => p >= sub(mid, band));
  const askDepth = depth(asks, (p) => p <= add(mid, band));
  const imbalance = add(bidDepth, askDepth) === 0n ? 0n : div(sub(bidDepth, askDepth), add(bidDepth, askDepth));

  const flags = [];
  if (spreadBps > fx(cfg.maxSpreadBps)) flags.push('abnormal_spread');
  let fill = null;
  if (order) {
    const want = fx(order.notional);
    const ls = order.side === 'buy' ? asks : bids;
    let remaining = want; let qty = 0n; let spent = 0n;
    for (const l of ls) {
      if (remaining === 0n) break;
      const levelNotional = mul(l.price, l.size);
      const take = levelNotional < remaining ? levelNotional : remaining;
      qty = add(qty, div(take, l.price)); spent = add(spent, take); remaining = sub(remaining, take);
    }
    const filled = remaining === 0n;
    const avg = qty === 0n ? null : div(spent, qty);
    const slippageBps = avg == null ? null : mul(div(order.side === 'buy' ? sub(avg, mid) : sub(mid, avg), mid), BPS);
    const sideDepth = order.side === 'buy' ? askDepth : bidDepth;
    if (!filled) flags.push('insufficient_liquidity');
    else if (sideDepth < mul(want, fx(cfg.minDepthMultiple))) flags.push('insufficient_liquidity');
    if (slippageBps != null && slippageBps > fx(cfg.maxSlippageBps) && !flags.includes('insufficient_liquidity')) flags.push('insufficient_liquidity');
    fill = Object.freeze({ side: order.side, notional: order.notional, fullyFillable: filled, avgPrice: avg == null ? null : toDecimal(avg), slippageBps: slippageBps == null ? null : toDecimal(slippageBps) });
  }
  return Object.freeze({
    configVersion: cfg.version, bestBid: toDecimal(bestBid), bestAsk: toDecimal(bestAsk), mid: toDecimal(mid), spreadBps: toDecimal(spreadBps),
    bidDepth: toDecimal(bidDepth), askDepth: toDecimal(askDepth), imbalance: toDecimal(imbalance), fill, flags: Object.freeze(flags),
  });
}
