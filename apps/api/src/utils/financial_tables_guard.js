/**
 * Financial-table guard for retention / cleanup jobs.
 *
 * These tables hold the on-chain revenue ledger and customer balances.
 * They are an audit record of money and MUST NEVER be pruned by any
 * retention, cleanup, aggregation, or "lean the DB" job.
 *
 * History: a daily DataRetentionJob deleted every revenue_events_v2 row whose
 * epoch had CLOSED, collapsing the table from 40,748 rows to ~0 (revenue
 * history destroyed). This guard exists so no cleanup path can do that again.
 *
 * If you need to control table growth, roll raw rows up into an aggregate
 * table FIRST and keep the financial source rows, or archive to cold storage —
 * do not DELETE the ledger.
 */

export const FINANCIAL_TABLES = Object.freeze([
  'revenue_events_v2',
  'api_credits',
  'credit_balances',
  'credit_deposits',
  'epoch_ledger',
  'settlement_batches',
  'api_deposits',
]);

const FINANCIAL_TABLE_SET = new Set(FINANCIAL_TABLES);

/**
 * @param {string} table
 * @returns {boolean} true if `table` is a protected financial table
 */
export function isFinancialTable(table) {
  return FINANCIAL_TABLE_SET.has(String(table || '').trim());
}

/**
 * Returns true and logs if a prune of `table` must be blocked.
 * Use at the top of any method that DELETEs by table name.
 * @param {string} table
 * @param {string} [source] caller label for the log line
 * @returns {boolean} true => caller MUST abort the delete
 */
export function blockIfFinancial(table, source = 'retention') {
  if (isFinancialTable(table)) {
    console.error(
      `[${source}] BLOCKED attempt to prune financial table: ${table}`
    );
    return true;
  }
  return false;
}
