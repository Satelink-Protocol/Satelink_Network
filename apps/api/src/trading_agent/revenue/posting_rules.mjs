// Shadow revenue posting rules (Stage 20, option 2) — PURE functions.
//
// Input: a validated event (or settlement evidence) + the book. Output: a frozen list of entries
// { account, debitMinor, creditMinor, currency } whose debits equal credits per currency. No I/O, no
// clock, no randomness: the same input always yields the same entries.
//
//   expected (accrual)     DR receivable:<stream>          CR revenue_expected:<stream>
//   matched settlement     DR clearing:gateway (net)       CR receivable:<stream> (gross)
//                          DR expense:gateway_fees (fee)
//                          DR revenue_expected:<stream>    CR revenue:<stream>           ← expected → actual
//   refund, not settled    DR revenue_expected:<stream>    CR receivable:<stream>        (reverses the accrual)
//   refund, settled        DR contra:refunds:<stream>      CR clearing:gateway
//   model cost             DR expense:model_cost           CR liability:model_provider
import { Stream, accountId } from './accounts.mjs';

export class RevenueError extends Error {
  constructor(code, message) { super(message); this.name = 'RevenueError'; this.code = code; }
}

/** Event type → revenue stream. */
export const EVENT_STREAM = Object.freeze({
  subscription_payment: Stream.SUBSCRIPTION,
  broker_rebate: Stream.REBATE,
  commission: Stream.COMMISSION,
  usage_charge: Stream.USAGE,
});
export const COST_EVENTS = Object.freeze(new Set(['model_cost']));

const INT = /^\d+$/;
const CUR = /^[A-Z]{3,5}$/;

/** Amounts are integer minor units given as decimal strings or bigints — never floats. */
export function minor(v, field) {
  if (typeof v === 'bigint') { if (v < 0n) throw new RevenueError('INVALID', `${field} must be ≥ 0`); return v; }
  if (typeof v === 'string' && INT.test(v)) return BigInt(v);
  throw new RevenueError('INVALID', `${field} must be integer minor units (string or bigint), got ${typeof v}`);
}

export function currencyOf(v) {
  if (typeof v !== 'string' || !CUR.test(v)) throw new RevenueError('INVALID', `currency must be an upper-case code, got ${v}`);
  return v;
}

const e = (account, debitMinor, creditMinor, currency) => Object.freeze({ account, debitMinor, creditMinor, currency });

/** Σ debit − Σ credit per currency must be 0. Throws otherwise. */
export function assertBalanced(entries) {
  const sum = new Map();
  for (const x of entries) sum.set(x.currency, (sum.get(x.currency) ?? 0n) + x.debitMinor - x.creditMinor);
  for (const [cur, s] of sum) if (s !== 0n) throw new RevenueError('UNBALANCED', `posting unbalanced in ${cur} by ${s}`);
  return entries;
}

function freezeAll(entries) {
  const nonZero = entries.filter((x) => x.debitMinor !== 0n || x.creditMinor !== 0n);
  return Object.freeze(assertBalanced(nonZero));
}

/** Expected (accrual) posting for a revenue event. */
export function expectedPosting(book, event) {
  const stream = EVENT_STREAM[event.type];
  if (!stream) throw new RevenueError('INVALID', `not a revenue event: ${event.type}`);
  const amt = minor(event.amountMinor, 'amountMinor');
  if (amt === 0n) throw new RevenueError('INVALID', 'amountMinor must be > 0');
  const cur = currencyOf(event.currency);
  return freezeAll([
    e(accountId(book, `receivable:${stream}`), amt, 0n, cur),
    e(accountId(book, `revenue_expected:${stream}`), 0n, amt, cur),
  ]);
}

/** Cost posting (model / provider cost) — tracked for margin, never netted against revenue. */
export function costPosting(book, event) {
  if (!COST_EVENTS.has(event.type)) throw new RevenueError('INVALID', `not a cost event: ${event.type}`);
  const amt = minor(event.amountMinor, 'amountMinor');
  const cur = currencyOf(event.currency);
  return freezeAll([
    e(accountId(book, 'expense:model_cost'), amt, 0n, cur),
    e(accountId(book, 'liability:model_provider'), 0n, amt, cur),
  ]);
}

/**
 * Settlement posting on MATCHED evidence: moves `gross` from expected to actual revenue and books
 * cash net of fees. The caller (engine) has already checked gross ≤ open expected amount.
 */
export function settlementPosting(book, stream, { grossMinor, feeMinor = 0n, currency }) {
  const gross = minor(grossMinor, 'grossMinor');
  const fee = minor(feeMinor, 'feeMinor');
  if (gross === 0n) throw new RevenueError('INVALID', 'grossMinor must be > 0');
  if (fee > gross) throw new RevenueError('INVALID', 'fee exceeds gross');
  const cur = currencyOf(currency);
  return freezeAll([
    e(accountId(book, 'clearing:gateway'), gross - fee, 0n, cur),
    e(accountId(book, 'expense:gateway_fees'), fee, 0n, cur),
    e(accountId(book, `receivable:${stream}`), 0n, gross, cur),
    e(accountId(book, `revenue_expected:${stream}`), gross, 0n, cur),
    e(accountId(book, `revenue:${stream}`), 0n, gross, cur),
  ]);
}

/** Refund posting: reverses the accrual if not yet settled, otherwise books a contra-revenue refund. */
export function refundPosting(book, stream, { amountMinor, currency, settled }) {
  const amt = minor(amountMinor, 'amountMinor');
  if (amt === 0n) throw new RevenueError('INVALID', 'refund amount must be > 0');
  const cur = currencyOf(currency);
  return settled
    ? freezeAll([e(accountId(book, `contra:refunds:${stream}`), amt, 0n, cur), e(accountId(book, 'clearing:gateway'), 0n, amt, cur)])
    : freezeAll([e(accountId(book, `revenue_expected:${stream}`), amt, 0n, cur), e(accountId(book, `receivable:${stream}`), 0n, amt, cur)]);
}
