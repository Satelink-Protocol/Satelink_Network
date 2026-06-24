import assert from 'node:assert';
import {
  FINANCIAL_TABLES,
  isFinancialTable,
  blockIfFinancial,
} from '../src/utils/financial_tables_guard.js';
import { DataRetentionJob } from '../src/jobs/data_retention_job.mjs';

describe('retention financial-table guard', () => {
  it('classifies revenue_events_v2 and other financial tables as protected', () => {
    assert.ok(isFinancialTable('revenue_events_v2'));
    assert.ok(FINANCIAL_TABLES.includes('revenue_events_v2'));
    for (const t of ['api_credits', 'credit_balances', 'credit_deposits', 'epoch_ledger', 'settlement_batches', 'api_deposits']) {
      assert.ok(isFinancialTable(t), `${t} should be protected`);
    }
  });

  it('does not protect ordinary log/metric tables', () => {
    for (const t of ['rpc_requests', 'audit_logs', 'request_traces', 'rpc_usage_hourly']) {
      assert.strictEqual(isFinancialTable(t), false, `${t} should NOT be protected`);
    }
  });

  it('blockIfFinancial returns true for financial tables, false otherwise', () => {
    assert.strictEqual(blockIfFinancial('revenue_events_v2', 'test'), true);
    assert.strictEqual(blockIfFinancial('audit_logs', 'test'), false);
  });

  it('DataRetention.cleanRevenueEventsByEpoch is a guarded no-op and issues NO DELETE', async () => {
    // Pool that throws if any query runs — proves the wipe never reaches SQL.
    const pool = { query: async () => { throw new Error('DELETE WAS ATTEMPTED on revenue_events_v2'); } };
    const job = new DataRetentionJob(pool);
    const errors = [];
    const deleted = await job.cleanRevenueEventsByEpoch(errors);
    assert.strictEqual(deleted, 0, 'must delete 0 rows');
    assert.strictEqual(errors.length, 0, 'must not run any DELETE query');
  });

  it('DataRetention.deleteOldRecords refuses a financial table without querying', async () => {
    const pool = { query: async () => { throw new Error('query should not run for financial table'); } };
    const job = new DataRetentionJob(pool);
    const errors = [];
    const deleted = await job.deleteOldRecords('revenue_events_v2', 'created_at', 0, errors);
    assert.strictEqual(deleted, 0);
    assert.strictEqual(errors.length, 0);
  });
});
