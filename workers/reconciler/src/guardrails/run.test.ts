import { describe, it, expect } from 'vitest';
import { runGuardrails } from './run.js';
import type { Alert } from './evaluate.js';

/**
 * Fake pg.Pool: dispatches on SQL text so the full pipeline (metrics → evaluate →
 * dedup → deliver) can be exercised without Docker. It holds an in-memory
 * guardrail_alert_state so fire-once across successive runs is real, not stubbed.
 */
function fakePool(revPerHour: number, ledgerPerHour: number) {
  const alertState = new Map<string, number>(); // key -> last_sent_ms
  const query = async (sql: string, params?: unknown[]): Promise<{ rows: unknown[] }> => {
    if (sql.includes('FROM revenue_events_v2')) return { rows: [{ n: String(revPerHour) }] };
    if (sql.includes('FROM ledger_entries')) return { rows: [{ n: String(ledgerPerHour) }] };
    if (sql.includes('pg_database_size')) return { rows: [{ db: String(0.6 * 1_073_741_824) }] };
    if (sql.includes('pg_ls_waldir')) return { rows: [{ wal: '0' }] };
    if (sql.includes('FROM driver_heartbeats')) return { rows: [] };
    if (sql.includes('FROM platform_flags')) return { rows: [] }; // defaults
    if (sql.includes('SELECT alert_key')) {
      return { rows: [...alertState.entries()].map(([alert_key, ms]) => ({ alert_key, ms: String(ms) })) };
    }
    if (sql.includes('INSERT INTO guardrail_alert_state')) {
      const key = params![0] as string;
      alertState.set(key, new Date(params![1] as string).getTime());
      return { rows: [] };
    }
    return { rows: [] };
  };
  return { query } as unknown as import('pg').Pool;
}

describe('runGuardrails — end-to-end fire-once with persisted state', () => {
  it('fires the row_growth alert exactly once per window across runs', async () => {
    const pool = fakePool(60_000, 111_581); // Aug-22 shape → row_growth trips
    const sent: Alert[] = [];
    const send = async (a: Alert): Promise<void> => { sent.push(a); };
    const t0 = 1_000_000;

    const r1 = await runGuardrails(pool, { send, volumeCapacityBytes: 5 * 1_073_741_824, windowMs: 3_600_000, nowMs: t0 });
    expect(r1.evaluated).to.be.greaterThan(0);
    expect(r1.sent).to.equal(1);
    expect(sent.map((a) => a.condition)).to.deep.equal(['row_growth']);

    // 30 min later, still firing → NO second email (dedup via persisted state)
    const r2 = await runGuardrails(pool, { send, volumeCapacityBytes: 5 * 1_073_741_824, windowMs: 3_600_000, nowMs: t0 + 1_800_000 });
    expect(r2.evaluated).to.be.greaterThan(0);
    expect(r2.sent).to.equal(0);
    expect(sent).to.have.length(1);

    // 61 min after first → window elapsed → sends again
    const r3 = await runGuardrails(pool, { send, volumeCapacityBytes: 5 * 1_073_741_824, windowMs: 3_600_000, nowMs: t0 + 3_660_000 });
    expect(r3.sent).to.equal(1);
    expect(sent).to.have.length(2);
  });

  it('quiet system (100 rev : 200 ledger, healthy volume) → nothing sent', async () => {
    const pool = fakePool(100, 200); // healthy 2:1, well under 5000/h
    const sent: Alert[] = [];
    const send = async (a: Alert): Promise<void> => { sent.push(a); };
    const r = await runGuardrails(pool, { send, volumeCapacityBytes: 5 * 1_073_741_824, windowMs: 3_600_000, nowMs: 1 });
    expect(r.evaluated).to.equal(0);
    expect(sent).to.have.length(0);
  });
});
