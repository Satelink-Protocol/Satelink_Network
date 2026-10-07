// Rebate sources (Stage 21). Read-only: they report rebates; nothing here posts to a ledger
// (Stage 20 is stopped on U2 = PARTIAL — no revenue booking until it is resolved).
//
// RebateSource contract: { source, available, fetchRecent({ startTime, endTime, page, size, subAccountId }) → [record] }
//   record = { source, subAccountId, tradeId, symbol, asset, amount (decimal string), status: pending|settled|failed|unknown, time }
//
// ExchangeLinkRebateSource: GET /sapi/v1/broker/rebate/recentRecord (Binance Link / Exchange Link
//   broker master account; window < 7 days; page size ≤ 500). /sapi is production-only, and the
//   production environment is refused while LIVE_TRADING is locked, so it is fixture-tested only.
// LinkAndTradeRebateSource: placeholder for the Link-and-Trade programme (not integrated).
import { BrokerError, BrokerErrorCode } from '../errors.mjs';
import { assertCredential } from './signing.mjs';

const WEEK = 7 * 86_400_000;
const STATUS = Object.freeze({ 0: 'pending', 1: 'settled', 2: 'failed' });
const canon = (v) => { const s = String(v); if (!s.includes('.')) return s; const t = s.replace(/0+$/, '').replace(/\.$/, ''); return t === '' || t === '-0' ? '0' : t; };

export class ExchangeLinkRebateSource {
  #rest; #credential;
  /** @param deps.rest a BinanceRestClient for an environment with /sapi; deps.credential async () → broker master key handle */
  constructor({ rest, credential }) {
    if (!rest || typeof credential !== 'function') throw new BrokerError(BrokerErrorCode.INTERNAL, { venue: 'binance', message: 'ExchangeLinkRebateSource needs rest and credential' });
    this.#rest = rest; this.#credential = credential;
  }
  get source() { return 'binance.exchange_link'; }
  get available() { return true; }

  async fetchRecent({ startTime, endTime, page = 1, size = 500, subAccountId } = {}) {
    if (!Number.isSafeInteger(startTime) || !Number.isSafeInteger(endTime) || endTime <= startTime) throw new BrokerError(BrokerErrorCode.INVALID_REQUEST, { venue: 'binance', message: 'startTime < endTime required' });
    if (endTime - startTime >= WEEK) throw new BrokerError(BrokerErrorCode.INVALID_REQUEST, { venue: 'binance', message: 'rebate window must be shorter than 7 days' });
    if (!Number.isInteger(size) || size < 1 || size > 500 || !Number.isInteger(page) || page < 1) throw new BrokerError(BrokerErrorCode.INVALID_REQUEST, { venue: 'binance', message: 'page ≥ 1 and 1 ≤ size ≤ 500' });
    const credential = await this.#credential();
    assertCredential(credential);
    const rows = await this.#rest.request('GET', '/sapi/v1/broker/rebate/recentRecord', { subAccountId, startTime, endTime, page, size }, { signed: true, credential });
    return (rows ?? []).map((r) => Object.freeze({
      source: this.source, subAccountId: r.subaccountId == null ? null : String(r.subaccountId), tradeId: r.tradeId == null ? null : String(r.tradeId),
      symbol: r.symbol ?? null, asset: r.asset, amount: canon(r.income), status: STATUS[r.status] ?? 'unknown', time: new Date(r.time).toISOString(),
    }));
  }
}

export class LinkAndTradeRebateSource {
  get source() { return 'binance.link_and_trade'; }
  get available() { return false; }
  async fetchRecent() {
    throw new BrokerError(BrokerErrorCode.INTERNAL, { venue: 'binance', message: 'Link-and-Trade rebate source is a placeholder: not integrated yet' });
  }
}
