// Shadow revenue chart of accounts (Stage 20, option 2).
//
// SHADOW ONLY: these accounts live in an in-memory projection. They are not Financial-OS ledger
// accounts and nothing here writes to the ledger (ledger_txns / ledger_entries) or to any table.
// Every account id is namespaced by book ("sim:" or "real:") so simulated and real money can never
// share an account.

export const Book = Object.freeze({ SIM: 'sim', REAL: 'real' });

export const AccountType = Object.freeze({
  ASSET: 'asset', LIABILITY: 'liability', REVENUE: 'revenue', CONTRA_REVENUE: 'contra_revenue', EXPENSE: 'expense',
});

/** Revenue streams the engine knows. Each has its own receivable / expected / actual accounts. */
export const Stream = Object.freeze({
  SUBSCRIPTION: 'subscription', // trading subscriptions (Stage 27, Razorpay)
  REBATE: 'rebate',             // broker rebates (Binance Exchange Link, Stage 21)
  COMMISSION: 'commission',     // correspondent commission (Alpaca, Stage 23)
  USAGE: 'usage',               // metered agent / machine API usage (Phase 6 item 11)
});

const base = {
  'clearing:gateway': [AccountType.ASSET, 'cash in transit at a payment gateway / broker, net of fees'],
  'expense:gateway_fees': [AccountType.EXPENSE, 'gateway / broker fees and their taxes'],
  'expense:model_cost': [AccountType.EXPENSE, 'LLM provider cost (model_traces), for margin only'],
  'liability:model_provider': [AccountType.LIABILITY, 'LLM provider cost owed'],
};
for (const s of Object.values(Stream)) {
  base[`receivable:${s}`] = [AccountType.ASSET, `${s}: amount expected, not yet evidenced`];
  base[`revenue_expected:${s}`] = [AccountType.REVENUE, `${s}: expected revenue (shadow accrual, not recognised)`];
  base[`revenue:${s}`] = [AccountType.REVENUE, `${s}: actual revenue, backed by matched evidence`];
  base[`contra:refunds:${s}`] = [AccountType.CONTRA_REVENUE, `${s}: refunds of actual revenue`];
}

/** Unprefixed account templates → { type, description }. */
export const ACCOUNT_TEMPLATES = Object.freeze(Object.fromEntries(
  Object.entries(base).map(([id, [type, description]]) => [id, Object.freeze({ type, description })]),
));

export function accountId(book, template) {
  if (book !== Book.SIM && book !== Book.REAL) throw new Error(`unknown book ${book}`);
  if (!ACCOUNT_TEMPLATES[template]) throw new Error(`unknown account ${template}`);
  return `${book}:${template}`;
}

/** Full chart for one book: [{ id, type, description }]. */
export function chartOfAccounts(book) {
  return Object.entries(ACCOUNT_TEMPLATES).map(([t, a]) => Object.freeze({ id: accountId(book, t), ...a }));
}

export function accountType(id) {
  const t = String(id).replace(/^(sim|real):/, '');
  const a = ACCOUNT_TEMPLATES[t];
  if (!a) throw new Error(`unknown account ${id}`);
  return a.type;
}
