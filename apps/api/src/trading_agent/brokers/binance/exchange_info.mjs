// exchangeInfo → Stage 10 instrument specs (Stage 21): PRICE_FILTER.tickSize, LOT_SIZE.stepSize /
// minQty, NOTIONAL.minNotional (or legacy MIN_NOTIONAL). Only TRADING symbols with SPOT allowed.
import { defineInstrument } from '../symbols.mjs';

const canon = (v) => { const s = String(v); if (!s.includes('.')) return s; const t = s.replace(/0+$/, '').replace(/\.$/, ''); return t === '' ? '0' : t; };

export function instrumentsFromExchangeInfo(info, { symbols = null } = {}) {
  const out = [];
  for (const s of info?.symbols ?? []) {
    if (s.status !== 'TRADING' || (s.permissions && s.permissions.length && !s.permissions.includes('SPOT') && !(s.permissionSets ?? []).flat().includes('SPOT'))) continue;
    if (symbols && !symbols.includes(s.symbol)) continue;
    const f = Object.fromEntries((s.filters ?? []).map((x) => [x.filterType, x]));
    if (!f.PRICE_FILTER || !f.LOT_SIZE) continue;
    out.push(defineInstrument({
      canonical: `${s.baseAsset}-${s.quoteAsset}`, venue: 'binance', venueSymbol: s.symbol, quoteCurrency: s.quoteAsset,
      quoteDecimals: Math.min(18, Number(s.quoteAssetPrecision ?? s.quotePrecision ?? 8)),
      tickSize: canon(f.PRICE_FILTER.tickSize), lotSize: canon(f.LOT_SIZE.stepSize), minQuantity: canon(f.LOT_SIZE.minQty),
      minNotional: canon((f.NOTIONAL ?? f.MIN_NOTIONAL)?.minNotional ?? '0'),
    }));
  }
  return out;
}
