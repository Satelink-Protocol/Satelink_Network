// Portfolio snapshots (Stage 18): positions valued at marks, hashed and append-only.
// A missing or stale mark never becomes a number: that position's unrealised P&L is null,
// marksComplete is false and the snapshot's unrealised total is null.
import { randomBytes } from 'node:crypto';
import { PortfolioError } from './errors.mjs';
import { valuePosition } from './pnl.mjs';
import { canonicalJson, contentHash } from '../strategies/canonical.mjs';

export class PortfolioSnapshotter {
  #store; #marks; #clock; #ids;
  /** @param deps.marks { mark(instrument) → { price, stale } | null } — e.g. Stage 11 quote mid, purpose internal_use */
  constructor({ store, marks, clock = () => new Date(), idFactory = () => `pfs_${randomBytes(12).toString('hex')}` }) {
    if (!store || typeof marks?.mark !== 'function') throw new PortfolioError('CONFIG', 'PortfolioSnapshotter needs store and marks');
    this.#store = store; this.#marks = marks; this.#clock = clock; this.#ids = idFactory;
  }

  async take({ principalId, brokerAccountId, mode }) {
    const positions = await this.#store.positions(principalId, { brokerAccountId, mode });
    if (!positions.length) throw new PortfolioError('NOT_FOUND', 'no positions for this account');
    const { currency, decimals } = positions[0];
    if (positions.some((p) => p.currency !== currency || p.decimals !== decimals)) throw new PortfolioError('INVALID', 'mixed currencies in one account snapshot');
    let unreal = 0n; let gross = 0n; let net = 0n; let realized = 0n; let fees = 0n; let complete = true;
    const lines = [];
    for (const p of positions) {
      realized += BigInt(p.realizedPnlMinor); fees += BigInt(p.feesMinor ?? 0);
      const line = { instrument: p.instrument, quantity: p.quantity, avgEntryPrice: p.avgEntryPrice, realizedPnlMinor: p.realizedPnlMinor };
      if (p.quantity !== '0') {
        let m = null;
        try { m = await this.#marks.mark(p.instrument); } catch { m = null; }
        if (!m || m.stale !== false || !m.price) { complete = false; Object.assign(line, { mark: null, unrealizedPnlMinor: null }); } else {
          const v = valuePosition(p, m.price, { quoteDecimals: decimals });
          unreal += BigInt(v.unrealizedPnlMinor); gross += BigInt(v.grossExposureMinor); net += BigInt(v.netExposureMinor);
          Object.assign(line, { mark: v.mark, unrealizedPnlMinor: v.unrealizedPnlMinor, grossExposureMinor: v.grossExposureMinor, netExposureMinor: v.netExposureMinor });
        }
      }
      lines.push(line);
    }
    const body = {
      principalId, brokerAccountId, mode, takenAt: this.#clock().toISOString(), currency, decimals, positions: lines,
      realizedPnlMinor: realized.toString(), unrealizedPnlMinor: complete ? unreal.toString() : null,
      grossExposureMinor: complete ? gross.toString() : null, netExposureMinor: complete ? net.toString() : null, feesMinor: fees.toString(), marksComplete: complete,
    };
    const snap = { id: this.#ids(), ...body, snapshotHash: contentHash(canonicalJson(body)) };
    await this.#store.insertSnapshot(snap);
    return Object.freeze(snap);
  }
}
