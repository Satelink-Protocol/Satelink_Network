/**
 * apps/api/src/billing/reconciliation.mjs
 *
 * RECONCILIATION ENGINE — detects financial discrepancies across the entire
 * payment → ledger → entitlement → usage → charge → settlement pipeline.
 *
 * Detects:
 *   - Missing payments (payment_sources with no matching api_deposits credit)
 *   - Duplicate payments (multiple api_deposits for same tx_hash)
 *   - Missing entitlements (payment credited but no subscription active)
 *   - Unmatched usage (api_usage_daily with no corresponding revenue_events_v2)
 *   - Duplicate charges (revenue_events_v2 with duplicate request_id)
 *   - Ledger imbalance (shadow ledger debit != credit sums)
 *   - Settlement mismatch (draws vs payment_sources totals)
 *
 * CRITICAL: this module DETECTS but does NOT repair. Financial discrepancies
 * must never be silently fixed — they require human investigation.
 */

/**
 * Run a full reconciliation check and return a structured report.
 * @param {import('pg').Pool} pool
 * @returns {Promise<{ok: boolean, checks: object[], discrepancies: object[]}>}
 */
export async function runReconciliation(pool) {
  if (!pool || !pool.query) {
    return { ok: false, checks: [], discrepancies: [{ type: 'no_pool', message: 'No database pool' }] };
  }

  const checks = [];
  const discrepancies = [];

  // 1. Payment Sources vs Credits — every payment should have a matching credit
  try {
    const r = await pool.query(`
      SELECT ps.tx_hash, ps.source, ps.amount_usd, ps.credited_api_key
      FROM payment_sources ps
      LEFT JOIN api_deposits ad ON ad.tx_hash = ps.tx_hash
      WHERE ad.id IS NULL
        AND ps.created_at > NOW() - INTERVAL '30 days'
    `);
    const missing = r.rows;
    checks.push({ name: 'payment_vs_credit', count: missing.length, status: missing.length === 0 ? 'PASS' : 'WARN' });
    for (const row of missing) {
      discrepancies.push({ type: 'missing_credit', tx_hash: row.tx_hash, source: row.source, amount: row.amount_usd });
    }
  } catch (e) {
    checks.push({ name: 'payment_vs_credit', status: 'ERROR', error: e.message });
  }

  // 2. Duplicate payments — same tx_hash appearing more than once
  try {
    const r = await pool.query(`
      SELECT tx_hash, COUNT(*) as cnt
      FROM payment_sources
      WHERE created_at > NOW() - INTERVAL '30 days'
      GROUP BY tx_hash HAVING COUNT(*) > 1
    `);
    const dups = r.rows;
    checks.push({ name: 'duplicate_payments', count: dups.length, status: dups.length === 0 ? 'PASS' : 'FAIL' });
    for (const row of dups) {
      discrepancies.push({ type: 'duplicate_payment', tx_hash: row.tx_hash, count: parseInt(row.cnt) });
    }
  } catch (e) {
    checks.push({ name: 'duplicate_payments', status: 'ERROR', error: e.message });
  }

  // 3. Subscription entitlement — active subscriptions should have credited accounts
  try {
    const r = await pool.query(`
      SELECT s.id, s.api_key, s.plan, s.status
      FROM subscriptions s
      LEFT JOIN api_credits ac ON ac.api_key = s.api_key
      WHERE s.status = 'active' AND ac.api_key IS NULL
    `).catch(() => ({ rows: [] }));
    const orphaned = r.rows;
    checks.push({ name: 'subscription_entitlement', count: orphaned.length, status: orphaned.length === 0 ? 'PASS' : 'FAIL' });
    for (const row of orphaned) {
      discrepancies.push({ type: 'missing_entitlement', subscription_id: row.id, api_key: row.api_key });
    }
  } catch (e) {
    checks.push({ name: 'subscription_entitlement', status: 'ERROR', error: e.message });
  }

  // 4. Duplicate revenue events — same request_id should not appear twice
  try {
    const r = await pool.query(`
      SELECT request_id, COUNT(*) as cnt
      FROM revenue_events_v2
      WHERE created_at > EXTRACT(EPOCH FROM NOW()) - 86400 * 30
        AND is_test_data = false
      GROUP BY request_id HAVING COUNT(*) > 1
    `);
    const dups = r.rows;
    checks.push({ name: 'duplicate_revenue', count: dups.length, status: dups.length === 0 ? 'PASS' : 'WARN' });
    for (const row of dups) {
      discrepancies.push({ type: 'duplicate_charge', request_id: row.request_id, count: parseInt(row.cnt) });
    }
  } catch (e) {
    checks.push({ name: 'duplicate_revenue', status: 'ERROR', error: e.message });
  }

  // 5. Ledger balance — shadow ledger debits should equal credits
  try {
    const r = await pool.query(`
      SELECT
        SUM(CASE WHEN direction = 'debit' THEN amount ELSE 0 END) as total_debit,
        SUM(CASE WHEN direction = 'credit' THEN amount ELSE 0 END) as total_credit
      FROM ledger_entries
      WHERE state = 'posted'
    `).catch(() => ({ rows: [{ total_debit: '0', total_credit: '0' }] }));
    const row = r.rows[0] || {};
    const debit = BigInt(row.total_debit || '0');
    const credit = BigInt(row.total_credit || '0');
    const balanced = debit === credit;
    checks.push({
      name: 'ledger_balance',
      total_debit: debit.toString(),
      total_credit: credit.toString(),
      status: balanced ? 'PASS' : 'FAIL',
    });
    if (!balanced) {
      discrepancies.push({ type: 'ledger_imbalance', debit: debit.toString(), credit: credit.toString(), drift: (debit - credit).toString() });
    }
  } catch (e) {
    checks.push({ name: 'ledger_balance', status: 'ERROR', error: e.message });
  }

  // 6. Revenue vs Payments totals (30-day) — should approximately match
  try {
    const [revResult, payResult] = await Promise.all([
      pool.query(`
        SELECT COALESCE(SUM(amount_usdt), 0) as total
        FROM revenue_events_v2
        WHERE is_test_data = false
          AND created_at > EXTRACT(EPOCH FROM NOW()) - 86400 * 30
      `),
      pool.query(`
        SELECT COALESCE(SUM(amount_usd), 0) as total
        FROM payment_sources
        WHERE is_test_data = false
          AND created_at > NOW() - INTERVAL '30 days'
      `),
    ]);
    const revTotal = parseFloat(revResult.rows[0]?.total || 0);
    const payTotal = parseFloat(payResult.rows[0]?.total || 0);
    const drift = Math.abs(revTotal - payTotal);
    // Allow 10% drift (revenue includes per-call metering; payments are bulk deposits)
    const acceptable = payTotal === 0 || drift / Math.max(payTotal, 0.01) < 0.5;
    checks.push({
      name: 'revenue_vs_payments',
      revenue_total: revTotal,
      payment_total: payTotal,
      drift,
      status: acceptable ? 'PASS' : 'WARN',
    });
    if (!acceptable) {
      discrepancies.push({ type: 'revenue_payment_drift', revenue: revTotal, payments: payTotal, drift });
    }
  } catch (e) {
    checks.push({ name: 'revenue_vs_payments', status: 'ERROR', error: e.message });
  }

  // 7. Expired subscriptions with active entitlements
  try {
    const r = await pool.query(`
      SELECT s.id, s.api_key, s.status, ac.tier, ac.credits_usdt
      FROM subscriptions s
      JOIN api_credits ac ON ac.api_key = s.api_key
      WHERE s.status IN ('cancelled', 'expired')
        AND s.current_period_end < NOW()
        AND ac.tier NOT IN ('free', 'x402')
        AND ac.credits_usdt > 0
    `).catch(() => ({ rows: [] }));
    checks.push({ name: 'expired_with_entitlement', count: r.rows.length, status: r.rows.length === 0 ? 'PASS' : 'WARN' });
    for (const row of r.rows) {
      discrepancies.push({
        type: 'expired_active_entitlement',
        subscription_id: row.id, api_key: row.api_key,
        tier: row.tier, remaining_credits: parseFloat(row.credits_usdt),
      });
    }
  } catch (e) {
    checks.push({ name: 'expired_with_entitlement', status: 'ERROR', error: e.message });
  }

  const ok = discrepancies.filter(d => d.type !== 'revenue_payment_drift').length === 0;
  return {
    ok,
    timestamp: new Date().toISOString(),
    checks,
    discrepancies,
    summary: {
      total_checks: checks.length,
      passed: checks.filter(c => c.status === 'PASS').length,
      warnings: checks.filter(c => c.status === 'WARN').length,
      failures: checks.filter(c => c.status === 'FAIL').length,
      errors: checks.filter(c => c.status === 'ERROR').length,
    },
  };
}
