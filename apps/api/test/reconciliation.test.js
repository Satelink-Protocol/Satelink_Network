/**
 * apps/api/test/reconciliation.test.js
 *
 * Tests for the reconciliation engine — verifies it detects all categories
 * of financial discrepancies.
 */

import { describe, it } from 'mocha';
import assert from 'assert';
import { runReconciliation } from '../src/billing/reconciliation.mjs';

function createQueryPool(queryHandler) {
  return {
    query: queryHandler,
  };
}

describe('Reconciliation Engine', function () {
  this.timeout(5000);

  it('returns ok=true with clean data (no discrepancies)', async () => {
    const pool = createQueryPool(async (sql) => {
      // All queries return empty/balanced results
      if (sql.includes('payment_sources ps')) return { rows: [] };
      if (sql.includes('GROUP BY tx_hash')) return { rows: [] };
      if (sql.includes('FROM subscriptions s')) return { rows: [] };
      if (sql.includes('GROUP BY request_id')) return { rows: [] };
      if (sql.includes('direction')) return { rows: [{ total_debit: '100', total_credit: '100' }] };
      if (sql.includes('SUM(amount_usdt)')) return { rows: [{ total: '1.50' }] };
      if (sql.includes('SUM(amount_usd)')) return { rows: [{ total: '1.50' }] };
      return { rows: [] };
    });
    const report = await runReconciliation(pool);
    assert.strictEqual(report.ok, true, `Expected ok=true, discrepancies: ${JSON.stringify(report.discrepancies)}`);
    assert.strictEqual(report.discrepancies.length, 0);
  });

  it('detects duplicate payments', async () => {
    const pool = createQueryPool(async (sql) => {
      if (sql.includes('GROUP BY tx_hash HAVING')) {
        return { rows: [{ tx_hash: 'dodo:pay_dup', cnt: '2' }] };
      }
      if (sql.includes('direction')) return { rows: [{ total_debit: '0', total_credit: '0' }] };
      return { rows: [] };
    });
    const report = await runReconciliation(pool);
    const dups = report.discrepancies.filter(d => d.type === 'duplicate_payment');
    assert.ok(dups.length > 0, 'should detect duplicate payment');
    assert.strictEqual(dups[0].count, 2);
  });

  it('detects ledger imbalance', async () => {
    const pool = createQueryPool(async (sql) => {
      if (sql.includes('direction')) {
        return { rows: [{ total_debit: '1000000', total_credit: '999000' }] };
      }
      return { rows: [] };
    });
    const report = await runReconciliation(pool);
    const imbalance = report.discrepancies.filter(d => d.type === 'ledger_imbalance');
    assert.ok(imbalance.length > 0, 'should detect ledger imbalance');
  });

  it('returns structured report even with no pool', async () => {
    const report = await runReconciliation(null);
    assert.strictEqual(report.ok, false);
    assert.ok(report.discrepancies.length > 0);
  });
});
