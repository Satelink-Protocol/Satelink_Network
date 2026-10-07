// Shadow revenue engine (Stage 20, option 2).
//
// An in-memory, append-only, double-entry PROJECTION of what Satelink Trading AI expects to earn
// and what matched evidence says it actually earned. It never writes to the Financial-OS ledger,
// never touches a table and never decides anything about money: it only shows expected vs actual
// and the variance, so a human can run the approved ledger process.
//
// Two books that never mix:
//   sim  — test-mode / simulated events (e.g. SimSubscriptionBook, SimCommissionBook, paper fills)
//   real — live, customer-funded events; expected → actual ONLY on three-way-matched evidence
//          (journal ↔ statement ↔ gateway/broker record, see scripts/trading/real-revenue-verify.mjs)
//
// Flag: REVENUE_ENGINE (TRADING_FLAG_REVENUE_ENGINE, default OFF). Constructing the engine with the
// flag off throws DISABLED.
import { isTradingFlagEnabled } from '../flags.mjs';
import { Book, Stream } from './accounts.mjs';
import {
  RevenueError, EVENT_STREAM, COST_EVENTS, minor, currencyOf,
  expectedPosting, costPosting, settlementPosting, refundPosting,
} from './posting_rules.mjs';

const keyOf = (type, id) => `${type}:${id}`;

function assertBookFits(book, src, what) {
  if (book === Book.REAL) {
    if (src.simulated === true || src.mode !== 'live') throw new RevenueError('SIMULATED_IN_REAL', `${what}: only live, non-simulated items may enter the real book`);
  } else if (book === Book.SIM) {
    if (src.simulated !== true && src.mode !== 'test') throw new RevenueError('REAL_IN_SIM', `${what}: only simulated / test-mode items may enter the sim book`);
  } else throw new RevenueError('INVALID', `unknown book ${book}`);
}

class ShadowBook {
  #entries = []; #postings = new Set(); #items = new Map();
  constructor(name) { this.name = name; }
  hasPosting(k) { return this.#postings.has(k); }
  post(postingKey, kind, ref, entries, at) {
    this.#postings.add(postingKey);
    for (const x of entries) this.#entries.push(Object.freeze({ ...x, postingKey, kind, ref, at, book: this.name, shadow: true }));
  }
  item(k) { return this.#items.get(k); }
  setItem(k, v) { this.#items.set(k, v); }
  items() { return [...this.#items.values()]; }
  entries() { return [...this.#entries]; }
}

export class ShadowRevenueEngine {
  #books;

  /** @param {{ env?: Record<string,string|undefined> }} [opts] */
  constructor({ env = process.env } = {}) {
    if (!isTradingFlagEnabled('REVENUE_ENGINE', env)) throw new RevenueError('DISABLED', 'REVENUE_ENGINE flag is off');
    this.#books = { [Book.SIM]: new ShadowBook(Book.SIM), [Book.REAL]: new ShadowBook(Book.REAL) };
  }

  #book(name) {
    const b = this.#books[name];
    if (!b) throw new RevenueError('INVALID', `unknown book ${name}`);
    return b;
  }

  /** Record an expected revenue event or a cost event. Idempotent by (type, id). */
  record(event, { book }) {
    const b = this.#book(book);
    if (!event || typeof event.id !== 'string' || !event.id) throw new RevenueError('INVALID', 'event.id required');
    assertBookFits(book, event, `event ${event.type}:${event.id}`);
    const k = keyOf(event.type, event.id);
    if (b.hasPosting(`expected|${k}`) || b.hasPosting(`cost|${k}`)) return { posted: false, duplicate: true };
    const at = event.at ?? null;
    if (COST_EVENTS.has(event.type)) {
      b.post(`cost|${k}`, 'cost', k, costPosting(book, event), at);
      return { posted: true, kind: 'cost' };
    }
    const entries = expectedPosting(book, event);
    b.post(`expected|${k}`, 'expected', k, entries, at);
    b.setItem(k, {
      key: k, type: event.type, stream: EVENT_STREAM[event.type], currency: currencyOf(event.currency),
      expectedMinor: minor(event.amountMinor, 'amountMinor'), actualMinor: 0n, refundedOpenMinor: 0n, refundedSettledMinor: 0n,
      evidence: [],
    });
    return { posted: true, kind: 'expected' };
  }

  /**
   * Apply MATCHED settlement evidence: moves the evidenced gross from expected to actual revenue.
   * @param evidence { eventType, eventId, evidenceId, matched, mode, simulated, fundedBy, settled,
   *                   grossMinor, feeMinor?, currency, statementRef }
   */
  settle(evidence, { book }) {
    const b = this.#book(book);
    if (!evidence || typeof evidence.evidenceId !== 'string' || !evidence.evidenceId) throw new RevenueError('INVALID', 'evidenceId required');
    const k = keyOf(evidence.eventType, evidence.eventId);
    const pk = `settle|${k}|${evidence.evidenceId}`;
    if (b.hasPosting(pk)) return { posted: false, duplicate: true };
    const item = b.item(k);
    if (!item) throw new RevenueError('UNKNOWN_EVENT', `no expected event ${k} in the ${book} book`);
    assertBookFits(book, evidence, `evidence ${evidence.evidenceId}`);
    if (evidence.matched !== true) throw new RevenueError('NOT_MATCHED', 'evidence is not three-way matched');
    if (evidence.settled !== true) throw new RevenueError('NOT_SETTLED', 'evidence is not settled');
    if (book === Book.REAL && evidence.fundedBy !== 'customer') throw new RevenueError('FOUNDER_FUNDED', 'only customer-funded money is revenue');
    if (book === Book.REAL && !evidence.statementRef) throw new RevenueError('NOT_MATCHED', 'real evidence needs a statement reference');
    if (currencyOf(evidence.currency) !== item.currency) throw new RevenueError('CURRENCY_MISMATCH', `${evidence.currency} ≠ ${item.currency}`);
    const gross = minor(evidence.grossMinor, 'grossMinor');
    const open = item.expectedMinor - item.actualMinor - item.refundedOpenMinor;
    if (gross > open) throw new RevenueError('OVER_RECEIPT', `evidence ${gross} exceeds the open expected amount ${open}; needs human review`);
    b.post(pk, 'settlement', k, settlementPosting(book, item.stream, { grossMinor: gross, feeMinor: evidence.feeMinor ?? 0n, currency: item.currency }), evidence.at ?? null);
    b.setItem(k, { ...item, actualMinor: item.actualMinor + gross, evidence: [...item.evidence, evidence.evidenceId] });
    return { posted: true, residualMinor: open - gross };
  }

  /** Refund against an expected event. Reverses the accrual (open part first), else contra-revenue. */
  refund({ eventType, eventId, refundId, amountMinor, mode, simulated, at }, { book }) {
    const b = this.#book(book);
    const k = keyOf(eventType, eventId);
    const pk = `refund|${k}|${refundId}`;
    if (!refundId) throw new RevenueError('INVALID', 'refundId required');
    if (b.hasPosting(pk)) return { posted: false, duplicate: true };
    const item = b.item(k);
    if (!item) throw new RevenueError('UNKNOWN_EVENT', `no expected event ${k} in the ${book} book`);
    assertBookFits(book, { mode, simulated }, `refund ${refundId}`);
    const amt = minor(amountMinor, 'amountMinor');
    const open = item.expectedMinor - item.actualMinor - item.refundedOpenMinor;
    const settledRemaining = item.actualMinor - item.refundedSettledMinor;
    if (amt > open + settledRemaining) throw new RevenueError('OVER_REFUND', `refund ${amt} exceeds ${open + settledRemaining}`);
    const fromOpen = amt <= open ? amt : open;
    const fromSettled = amt - fromOpen;
    const entries = [
      ...(fromOpen > 0n ? refundPosting(book, item.stream, { amountMinor: fromOpen, currency: item.currency, settled: false }) : []),
      ...(fromSettled > 0n ? refundPosting(book, item.stream, { amountMinor: fromSettled, currency: item.currency, settled: true }) : []),
    ];
    b.post(pk, 'refund', k, entries, at ?? null);
    b.setItem(k, { ...item, refundedOpenMinor: item.refundedOpenMinor + fromOpen, refundedSettledMinor: item.refundedSettledMinor + fromSettled });
    return { posted: true, fromOpenMinor: fromOpen, fromSettledMinor: fromSettled };
  }

  entries(book) { return this.#book(book).entries(); }

  /** account → currency → balance (debit-positive). */
  trialBalance(book) {
    const tb = {};
    for (const x of this.#book(book).entries()) {
      tb[x.account] ??= {};
      tb[x.account][x.currency] = (tb[x.account][x.currency] ?? 0n) + x.debitMinor - x.creditMinor;
    }
    return tb;
  }

  /** True when Σ debits = Σ credits per currency over the whole book. */
  balanced(book) {
    const s = new Map();
    for (const x of this.#book(book).entries()) s.set(x.currency, (s.get(x.currency) ?? 0n) + x.debitMinor - x.creditMinor);
    return [...s.values()].every((v) => v === 0n);
  }

  /**
   * Variance report: expected vs evidenced-actual per stream and currency, plus every item that is
   * not fully matched. Amounts are strings (minor units) so the report serialises safely.
   */
  varianceReport(book) {
    const items = this.#book(book).items();
    const agg = new Map();
    const open = [];
    for (const i of items) {
      const k = `${i.stream}|${i.currency}`;
      const a = agg.get(k) ?? { stream: i.stream, currency: i.currency, expected: 0n, actual: 0n, refunded: 0n, residual: 0n };
      const residual = i.expectedMinor - i.actualMinor - i.refundedOpenMinor;
      a.expected += i.expectedMinor; a.actual += i.actualMinor; a.refunded += i.refundedOpenMinor + i.refundedSettledMinor; a.residual += residual;
      agg.set(k, a);
      if (residual !== 0n) open.push({ item: i.key, stream: i.stream, currency: i.currency, expectedMinor: String(i.expectedMinor), actualMinor: String(i.actualMinor), residualMinor: String(residual), status: i.actualMinor === 0n ? 'unmatched' : 'partial' });
    }
    const streams = [...agg.values()]
      .sort((x, y) => (x.stream + x.currency).localeCompare(y.stream + y.currency))
      .map((a) => ({ stream: a.stream, currency: a.currency, expectedMinor: String(a.expected), actualMinor: String(a.actual), refundedMinor: String(a.refunded), varianceMinor: String(a.residual) }));
    return Object.freeze({
      schema: 'shadow-revenue-variance/1.0', book, shadow: true,
      note: book === Book.REAL ? 'actual = three-way-matched evidence only; nothing here is posted to the ledger' : 'SIMULATED — not revenue',
      balanced: this.balanced(book), streams, open: open.sort((x, y) => x.item.localeCompare(y.item)),
    });
  }
}

export { Book, Stream, RevenueError };
