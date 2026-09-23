import { expect } from 'chai';
import { runEpochCycle } from '../src/economics/epoch_scheduler.js';

function makePool() {
    const calls = [];
    const client = {
        calls,
        async query(sql, params = []) {
            calls.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });

            if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
                return { rows: [], rowCount: 0 };
            }

            if (/pg_try_advisory_xact_lock/.test(sql)) {
                return { rows: [{ locked: true }], rowCount: 1 };
            }

            if (/FROM epochs WHERE status = 'OPEN'/.test(sql) || /FROM epochs\s+WHERE status = 'OPEN'/.test(sql)) {
                return { rows: [{ id: 7 }], rowCount: 1 };
            }

            // Orphan-event assignment (CRITICAL FIX in epoch_scheduler.js): claims
            // any untagged revenue_events_v2 rows for the epoch being closed, before
            // aggregation. This test's fixture has none pending — real code only
            // reads .rowCount, asserted nowhere else in this test — so 0 is a safe,
            // neutral fixture value (test-harness only; see docs/api/TEST_TRIAGE.md
            // root cause D; the real, unmodified epoch_scheduler.js is what defines
            // this query).
            if (/UPDATE revenue_events_v2\s+SET epoch_id = \$1/.test(sql)) {
                return { rows: [], rowCount: 0 };
            }

            if (/COUNT\(\*\)::integer AS event_count/.test(sql)) {
                return { rows: [{ event_count: 2, total_revenue_usdt: '10' }], rowCount: 1 };
            }

            // epochs/epoch_ledger sync (CRITICAL in epoch_scheduler.js: "the epochs
            // table and epoch_ledger table must be kept in sync" — truth.js reads
            // epoch_ledger). Downstream code doesn't read this INSERT's return value
            // (test-harness only; see docs/api/TEST_TRIAGE.md root cause D; the real,
            // unmodified epoch_scheduler.js defines this query).
            if (/INSERT INTO epoch_ledger/.test(sql)) {
                return { rows: [], rowCount: 1 };
            }

            if (/UPDATE epochs/.test(sql)) {
                return {
                    rows: [{
                        id: 7,
                        total_revenue_usdt: '10',
                        node_pool_usdt: '5',
                        platform_share_usdt: '3',
                        distributor_share_usdt: '2'
                    }],
                    rowCount: 1
                };
            }

            if (/SELECT id, total_revenue_usdt FROM epochs WHERE id = \$1 AND status = 'CLOSED' FOR UPDATE/.test(calls.at(-1).sql)) {
                return { rows: [{ id: 7, total_revenue_usdt: '10' }], rowCount: 1 };
            }

            if (/SELECT DISTINCT node_id FROM revenue_events_v2/.test(calls.at(-1).sql)) {
                return { rows: [{ node_id: 'node-a' }, { node_id: 'node-b' }], rowCount: 2 };
            }

            if (/WITH split AS/.test(calls.at(-1).sql)) {
                return {
                    rows: [{
                        platform_rows_inserted: 1,
                        distribution_rows_inserted: 1,
                        node_rows_inserted: 2,
                        total_revenue_usdt: '10',
                        node_pool_usdt: '5',
                        platform_share_usdt: '3',
                        distributor_share_usdt: '2'
                    }],
                    rowCount: 1
                };
            }

            if (/INSERT INTO epochs/.test(sql)) {
                return { rows: [{ id: 8 }], rowCount: 1 };
            }

            throw new Error(`Unexpected SQL: ${sql}`);
        },
        release() {
            calls.push({ sql: 'release', params: [] });
        }
    };

    return {
        client,
        connectCalls: 0,
        async connect() {
            this.connectCalls += 1;
            return client;
        },
        async query() {
            throw new Error('runEpochCycle should use a transaction client');
        }
    };
}

describe('EpochScheduler', () => {
    it('closes one OPEN epoch, aggregates revenue, applies 50/30/20 split, and opens the next epoch', async () => {
        const pool = makePool();

        const result = await runEpochCycle(pool);

        expect(result).to.deep.include({
            ok: true,
            status: 'success',
            closed_epoch_id: 7,
            open_epoch_id: 8,
            event_count: 2,
            total_revenue_usdt: 10,
            node_pool_usdt: 5,
            platform_share_usdt: 3,
            distributor_share_usdt: 2
        });

        const sql = pool.client.calls.map(call => call.sql);
        expect(sql[0]).to.equal('BEGIN');
        expect(sql).to.include('COMMIT');
        expect(sql.at(-1)).to.equal('release');

        const updateCall = pool.client.calls.find(call => /^UPDATE epochs/.test(call.sql));
        expect(updateCall.sql).to.include("status = 'CLOSED'");
        expect(updateCall.sql).to.include('node_pool_usdt = totals.total_revenue_usdt * 0.50');
        expect(updateCall.sql).to.include('platform_share_usdt = totals.total_revenue_usdt * 0.30');
        expect(updateCall.sql).to.include('distributor_share_usdt = totals.total_revenue_usdt * 0.20');
    });
});
