// Fill consumer (Stage 18): turns OMS order events into fills and positions.
//
// Consumes order_events ('broker_status' / 'broker_update', written by the Stage 17 OMS)
// after a durable cursor. For each event it fetches the order's fills from the venue by
// client order id (adapter.listFills), inserts them idempotently (UNIQUE order_id +
// broker_fill_id) and, if anything new arrived, recomputes the position as a fold over ALL
// fills of that (account, instrument, mode). The cursor only advances past events whose
// fills were fetched, so a venue error or a crash re-processes (harmlessly) next run.
import { createHash } from 'node:crypto';
import { PortfolioError } from './errors.mjs';
import { foldPosition } from './pnl.mjs';

export const FILL_CONSUMER = 'portfolio.fills';
const hashId = (prefix, s) => `${prefix}_${createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 24)}`;
export const fillIdFor = (orderId, brokerFillId) => hashId('fil', `${orderId}|${brokerFillId}`);
export const positionIdFor = (brokerAccountId, instrument, mode) => hashId('pos', `${brokerAccountId}|${instrument}|${mode}`);

export class FillConsumer {
  #store; #adapters; #clock;
  constructor({ store, adapters, clock = () => new Date() }) {
    if (!store || typeof adapters?.forVenue !== 'function') throw new PortfolioError('CONFIG', 'FillConsumer needs store and adapters');
    this.#store = store; this.#adapters = adapters; this.#clock = clock;
  }

  async runOnce({ limit = 200 } = {}) {
    const cursor = await this.#store.getCursor(FILL_CONSUMER);
    const events = await this.#store.readOrderEvents(cursor, limit);
    const out = { events: events.length, fillsInserted: 0, positionsUpdated: 0, error: null, cursor };
    const fetched = new Map();
    for (const ev of events) {
      if (!fetched.has(ev.orderId)) {
        const order = await this.#store.getOrder(ev.orderId);
        if (!order?.venue) { fetched.set(ev.orderId, 0); } else {
          let fills;
          try {
            fills = await this.#adapters.forVenue(order.venue).listFills(order.brokerAccountId, { clientOrderId: order.clientOrderId });
          } catch (e) {
            out.error = `${ev.orderId}: ${e.code ?? e.message}`;
            break; // stop before this event; the cursor stays behind it
          }
          fetched.set(ev.orderId, await this.#apply(order, fills));
        }
        const n = fetched.get(ev.orderId);
        out.fillsInserted += n;
        if (n > 0) out.positionsUpdated += 1;
      }
      out.cursor = ev.id;
    }
    if (out.cursor !== cursor) await this.#store.setCursor(FILL_CONSUMER, out.cursor);
    return out;
  }

  async #apply(order, fills) {
    const rows = fills.map((f) => ({
      id: fillIdFor(order.id, f.fillId), orderId: order.id, brokerFillId: String(f.fillId), quantity: f.quantity, price: f.price,
      feeMinor: String(f.feeMinor ?? 0), feeCurrency: f.feeCurrency ?? null, feeDecimals: f.feeDecimals ?? null, executedAt: new Date(f.executedAt).toISOString(),
    }));
    return this.#store.transaction(async (tx) => {
      const inserted = await tx.insertFills(rows);
      if (inserted > 0) await recomputePosition(tx, order, this.#clock());
      return inserted;
    });
  }
}

/** Rebuild one position from all of its fills (order-independent, idempotent). */
export async function recomputePosition(store, order, at) {
  const key = { brokerAccountId: order.brokerAccountId, instrument: order.instrument, mode: order.mode };
  const p = foldPosition(await store.fillsForKey(key), { quoteCurrency: order.currency, quoteDecimals: order.decimals });
  const row = {
    id: positionIdFor(key.brokerAccountId, key.instrument, key.mode), principalId: order.principalId, ...key,
    quantity: p.quantity, avgEntryPrice: p.avgEntryPrice, realizedPnlMinor: p.realizedPnlMinor, currency: order.currency, decimals: order.decimals,
    feesMinor: p.feesMinor, fillCount: p.fillCount, lastFillAt: p.lastFillAt, unconvertedFees: p.unconvertedFees, updatedAt: at.toISOString(),
  };
  await store.upsertPosition(row);
  return row;
}
