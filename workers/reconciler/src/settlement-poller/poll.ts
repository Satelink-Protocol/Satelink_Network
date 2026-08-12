/**
 * Settlement poller — advances draws in `settling` whose rail transaction has
 * confirmed, and counts settlements stuck past a configurable age.
 *
 * Today `draws` holds no real advanceable settlement (draws become real in
 * M8/M9), so in production this advances nothing and simply reports stuck
 * fixtures. It is proven against a rollback-only testcontainer fixture.
 *
 * NOTE (filed as an M8 prerequisite, NOT fixed here): shadow_draw_write.js
 * inserts settlements as state='confirmed' with confirmations=0 and
 * required_confirmations=0 — asserting a confirmation it never verified. This
 * poller is what should own the pending→confirming→confirmed transition once
 * draws are real; M7 does not change shadow_draw_write.js.
 */

import type { Queryable } from '../db.js';
import type { ChainReader } from '../ports/chain-reader.js';
import { CHAINS, type ChainKey } from '../chains.js';
import { emitEvent } from '../state.js';

export interface AdvancedSettlement {
  readonly drawId: string;
  readonly txHash: string;
  readonly confirmations: number;
}

export interface PollResult {
  readonly advancedCount: number;
  readonly stuckSettlementCount: number;
  readonly advanced: readonly AdvancedSettlement[];
}

interface SettlingRow {
  readonly draw_id: string;
  readonly rail_tx_hash: string | null;
  readonly rail_network: string | null;
}

const REAL_TX = /^0x[0-9a-fA-F]{64}$/;

function chainKeyFor(network: string | null): ChainKey | null {
  if (network !== null && Object.prototype.hasOwnProperty.call(CHAINS, network)) {
    return network as ChainKey;
  }
  return null;
}

export async function pollOnce(
  exec: Queryable,
  chain: ChainReader,
  cfg: { minConfirmations: number; stuckSettlementAgeMs: number },
  now: Date,
): Promise<PollResult> {
  // Settling draws + their settlement's rail tx.
  const settling = await exec.query<SettlingRow>(
    `SELECT d.id AS draw_id, s.rail_tx_hash, s.rail_network
       FROM draws d
       JOIN settlements s ON s.draw_id = d.id
      WHERE d.state = 'settling'
      ORDER BY d.id`,
  );

  const advanced: AdvancedSettlement[] = [];
  for (const row of settling.rows) {
    const txHash = row.rail_tx_hash;
    const chainKey = chainKeyFor(row.rail_network);
    if (txHash === null || !REAL_TX.test(txHash) || chainKey === null) continue;

    const status = await chain.getTxStatus({ chainKey, txHash });
    if (!status.found || !status.success || status.confirmations < cfg.minConfirmations) continue;

    // Advance atomically; the WHERE state guard makes it a no-op if another
    // cycle already moved it.
    const upd = await exec.query(
      `UPDATE draws SET state = 'settled', version = version + 1
        WHERE id = $1 AND state = 'settling'`,
      [row.draw_id],
    );
    if ((upd.rowCount ?? 0) === 0) continue;
    await exec.query(
      `UPDATE settlements
          SET state = 'confirmed', confirmations = $2, confirmed_at = $3
        WHERE draw_id = $1`,
      [row.draw_id, status.confirmations, now.getTime()],
    );
    await emitEvent(exec, {
      eventId: `settlement.confirmed.${row.draw_id}`,
      eventType: 'settlement.confirmed',
      severity: 'info',
      payload: { drawId: row.draw_id, txHash, confirmations: status.confirmations },
    });
    advanced.push({ drawId: row.draw_id, txHash, confirmations: status.confirmations });
  }

  // Stuck: still settling and older than the configured age.
  const cutoff = new Date(now.getTime() - cfg.stuckSettlementAgeMs);
  const stuck = await exec.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM draws WHERE state = 'settling' AND created_at < $1`,
    [cutoff],
  );
  const stuckSettlementCount = Number(stuck.rows[0]?.n ?? '0');

  return { advancedCount: advanced.length, stuckSettlementCount, advanced };
}
