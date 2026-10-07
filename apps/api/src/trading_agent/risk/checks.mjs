// The ordered pre-trade checks 1–20 (Stage 15). Pure functions of (order, context).
//
// "Document A Part E" (the brief's source list) is not in the repo; this registry is the
// documented substitute (docs/trading-agent/stages/15-risk.md). It is versioned
// (CHECKS_VERSION) so reconciling with Document A is a reviewed change with a new version.
//
// Contract: each check returns PASS or { ok: false, code, detail[, trip] }. Anything
// else, or any exception (including a missing context field read through need()), is a
// REJECT. That is enforced by evaluate.mjs, not trusted here.
import { validateAgainst } from '../strategies/validator.mjs';
import { compareDecimal, mulDecimal, toMinor, Rounding, isMultipleOf } from '../brokers/decimal.mjs';
import { fx, mul, div, fxInt, ONE } from '../strategies/fixed.mjs';
import { isTradingFlagEnabled } from '../flags.mjs';
import { marketCalendar } from '../backtest/calendar.mjs';
import { activeKillSwitchesFor } from './kill_switch.mjs';

export const CHECKS_VERSION = 'risk-checks/1.1'; // 1.1 (Phase 6 item 12): Mode B coverage inside check 7, MANDATE_MODE_B in check 3
export const PASS = Object.freeze({ ok: true });
const no = (code, detail, extra = {}) => Object.freeze({ ok: false, code, detail, ...extra });

/** Read a required context value; a missing one throws, which the evaluator turns into REJECT. */
export function need(value, path) {
  if (value === undefined || value === null) throw new Error(`context missing ${path}`);
  return value;
}
const int = (v, path) => {
  if (!Number.isSafeInteger(need(v, path))) throw new Error(`context ${path} must be an integer`);
  return v;
};
const minor = (v, path) => {
  const s = need(v, path);
  if (typeof s !== 'string' || !/^-?(0|[1-9][0-9]*)$/.test(s)) throw new Error(`context ${path} must be integer minor units as a string`);
  return BigInt(s);
};
const bool = (v, path) => {
  if (typeof need(v, path) !== 'boolean') throw new Error(`context ${path} must be boolean`);
  return v;
};

const ID = (p) => ({ type: 'string', pattern: `^${p}_[A-Za-z0-9_]{1,64}$` });
const DEC = { type: 'string', pattern: '^(0|[1-9][0-9]*)(\\.[0-9]+)?$', 'x-decimal': { min: '0', exclusiveMin: true, maxScale: 18 } };
export const ORDER_INTENT_SCHEMA = Object.freeze({
  type: 'object', additionalProperties: false,
  required: ['idempotencyKey', 'principalId', 'brokerAccountId', 'mandateId', 'origin', 'mode', 'venue', 'instrument', 'side', 'type', 'quantity'],
  properties: {
    idempotencyKey: { type: 'string', pattern: '^[A-Za-z0-9_-]{8,128}$' },
    principalId: ID('prn'), brokerAccountId: ID('bka'), mandateId: ID('mdt'),
    strategyVersionId: { ...ID('stv') },
    origin: { enum: ['strategy', 'manual', 'llm_proposal', 'agent_proposal'] },
    approvedBy: ID('prn'),
    proposedBy: ID('prn'),          // agent / machine principal that proposed it (Mode B)
    decisionId: ID('dec'),          // the scorecard GO it relies on (Mode B)
    mode: { enum: ['paper', 'live'] },
    venue: { enum: ['binance', 'alpaca', 'upstox', 'mock'] },
    instrument: { type: 'string', pattern: '^([A-Z0-9]{2,15}-[A-Z0-9]{2,15}|[A-Z]{2,10}:[A-Z0-9&._-]{1,30})$' },
    side: { enum: ['buy', 'sell'] },
    type: { enum: ['market', 'limit'] },
    quantity: DEC,
    limitPrice: DEC,
    reduceOnly: { type: 'boolean' },
  },
});

// ── shared derivations (all pure) ───────────────────────────────────────────────

/** Reference price: limit price, else the side's touch (buy → ask, sell → bid). */
export function referencePrice(o, ctx) {
  if (o.type === 'limit') return o.limitPrice;
  return o.side === 'buy' ? need(ctx.quote?.ask, 'quote.ask') : need(ctx.quote?.bid, 'quote.bid');
}
/** Order notional in policy minor units, rounded UP (conservative). */
export function notionalMinor(o, ctx) {
  return toMinor(mulDecimal(o.quantity, referencePrice(o, ctx)), int(ctx.policy.decimals, 'policy.decimals'), Rounding.CEIL);
}
function positionOf(o, ctx) {
  const list = need(ctx.activity?.openPositions, 'activity.openPositions');
  return list.find((p) => p.instrument === o.instrument) ?? null;
}
/** True only when the order strictly reduces an existing position (never flips it). */
export function reducesExposure(o, ctx) {
  const p = positionOf(o, ctx);
  if (!p) return false;
  const q = need(p.quantity, 'position.quantity'); // signed decimal string
  if (o.side === 'sell') return compareDecimal(q, '0') > 0 && compareDecimal(o.quantity, q) <= 0;
  return compareDecimal(q, '0') < 0 && compareDecimal(o.quantity, q.slice(1)) <= 0;
}
const strategyIdOf = (ctx) => ctx.strategy?.strategyId ?? null;

// ── Mode B (Phase 6 item 12) ─────────────────────────────────────────────────────
// An agent / machine proposal may proceed WITHOUT a per-order human click only when ALL hold
// (every other check still runs and must pass; live mode still needs LIVE_TRADING, which is LOCKED):
//   the mandate is a human step-up-signed Mode B mandate (021 'automated', terms mode B) for the
//   order's strategy version and instrument; the proposer's key is EXECUTE_UNDER_MANDATE, bound to
//   this mandate and owned by this principal; a persisted scorecard GO for the same principal,
//   instrument and side, not expired; and the order is within the LIVE_SMALL caps.
export const MODE_B_CAPS = Object.freeze({ maxOrderNotional: '50', maxDailyNotional: '200' }); // in policy currency units (LIVE_SMALL, Stage 35)
export const isModeB = (o) => o.origin === 'agent_proposal' && !o.approvedBy;

function modeBCoverage(o, ctx, m, now) {
  if (m.mode !== 'automated' || m.termsMode !== 'B') return no('MODE_B_MANDATE_REQUIRED', 'a Mode B mandate is required for orders without a per-order approval');
  if (!['totp', 'passkey'].includes(m.stepUpMethod)) return no('MANDATE_NOT_APPROVED', 'Mode B mandate must be step-up signed');
  if (!o.strategyVersionId || o.strategyVersionId !== m.strategyVersionId) return no('MODE_B_STRATEGY_MISMATCH', 'the order is not for the strategy version the mandate binds');
  if (!Array.isArray(m.instruments) || !m.instruments.includes(o.instrument)) return no('MODE_B_INSTRUMENT', 'the mandate does not cover this instrument');
  const p = ctx.proposer;
  if (!p || p.principalId !== o.proposedBy || p.ownerPrincipalId !== o.principalId || p.scope !== 'EXECUTE_UNDER_MANDATE' || p.mandateId !== o.mandateId) {
    return no('MODE_B_PROPOSER', 'the proposer is not authorised to act under this mandate');
  }
  const d = ctx.scorecardDecision;
  if (!d || d.id !== o.decisionId || d.decision !== 'GO' || !(Date.parse(d.expires_at) > now)
      || d.subject?.principalId !== o.principalId || d.subject?.instrument !== o.instrument || d.subject?.side !== o.side) {
    return no('MODE_B_SCORECARD', 'Mode B needs a current scorecard GO for this exact principal, instrument and side');
  }
  const dec = int(ctx.policy.decimals, 'policy.decimals');
  const n = BigInt(notionalMinor(o, ctx));
  const capOrder = BigInt(toMinor(MODE_B_CAPS.maxOrderNotional, dec, Rounding.FLOOR));
  const capDay = BigInt(toMinor(MODE_B_CAPS.maxDailyNotional, dec, Rounding.FLOOR));
  if (n > capOrder) return no('MODE_B_CAP', `order notional exceeds the LIVE_SMALL per-order cap ${MODE_B_CAPS.maxOrderNotional}`);
  if (BigInt(need(ctx.activity?.todayNotionalMinor, 'activity.todayNotionalMinor')) + n > capDay) return no('MODE_B_CAP', `daily notional would exceed the LIVE_SMALL cap ${MODE_B_CAPS.maxDailyNotional}`);
  return null;
}

// ── the checks ──────────────────────────────────────────────────────────────────

function killSwitch(o, ctx) {
  if (!ctx.policy) return no('POLICY_MISSING', 'no active risk policy (fail closed)');
  if (ctx.policy.killSwitch !== false) return no('POLICY_KILL_SWITCH', 'the risk policy kill switch is engaged (default ON until explicitly cleared)');
  const active = activeKillSwitchesFor(need(ctx.killSwitchEvents, 'killSwitchEvents'), { ...o, strategyId: strategyIdOf(ctx) });
  if (active.length) return no('KILL_SWITCH', `${active[0].scopeType} kill switch engaged (${active[0].source}): ${active[0].reason}`, { scope: active[0].scopeType });
  return PASS;
}

function circuitBreakers(o, ctx) {
  const b = need(ctx.policy.limits?.breakers, 'policy.limits.breakers');
  const a = need(ctx.activity, 'activity');
  const trip = (code, reason) => no(code, reason, { trip: { scopeType: 'mandate', scopeId: o.mandateId, principalId: o.principalId, reason } });
  if (int(a.consecutiveLosses, 'activity.consecutiveLosses') >= b.maxConsecutiveLosses) return trip('BREAKER_CONSECUTIVE_LOSSES', `${a.consecutiveLosses} consecutive losing trades (max ${b.maxConsecutiveLosses})`);
  if (int(a.consecutiveRejects, 'activity.consecutiveRejects') >= b.maxConsecutiveRejects) return trip('BREAKER_CONSECUTIVE_REJECTS', `${a.consecutiveRejects} consecutive rejected orders (max ${b.maxConsecutiveRejects})`);
  if (int(a.brokerErrorsInWindow, 'activity.brokerErrorsInWindow') >= b.maxBrokerErrors) return trip('BREAKER_BROKER_ERRORS', `${a.brokerErrorsInWindow} broker errors in window (max ${b.maxBrokerErrors})`);
  return PASS;
}

function tradingFlags(o, ctx) {
  const env = need(ctx.flagsEnv, 'flagsEnv');
  const required = ['TRADING_AGENT'];
  required.push({ binance: 'BINANCE', alpaca: 'ALPACA', upstox: 'UPSTOX_COPILOT', mock: null }[o.venue]);
  if (o.mode === 'live') required.push('LIVE_TRADING');
  // No per-order human approval: only Mode B (agent proposal under a Mode B mandate, MANDATE_MODE_B on)
  // or full autonomy (AUTONOMOUS_MODE, LOCKED). Upstox automation stays LOCKED either way.
  if (!o.approvedBy) required.push(isModeB(o) ? 'MANDATE_MODE_B' : 'AUTONOMOUS_MODE', ...(o.venue === 'upstox' ? ['UPSTOX_AUTOMATED'] : []));
  const off = required.filter((f) => f && !isTradingFlagEnabled(f, env));
  return off.length ? no('FLAG_DISABLED', `required flag(s) not enabled: ${off.join(', ')}`) : PASS;
}

function orderSchema(o, ctx) {
  const r = validateAgainst(ORDER_INTENT_SCHEMA, o);
  if (!r.ok) return no('INVALID_ORDER', r.errors.slice(0, 3).map((e) => `${e.path}: ${e.message}`).join('; '));
  if (o.type === 'limit' && o.limitPrice === undefined) return no('INVALID_ORDER', 'limit order needs limitPrice');
  if (o.type === 'market' && o.limitPrice !== undefined) return no('INVALID_ORDER', 'market order must not carry limitPrice');
  if (o.origin === 'strategy' && !o.strategyVersionId) return no('INVALID_ORDER', 'strategy orders need strategyVersionId');
  const spec = need(ctx.instrument, 'instrument');
  if (spec.canonical !== o.instrument || spec.venue !== o.venue) return no('INVALID_ORDER', 'instrument spec does not match the order');
  return PASS;
}

function idempotency(o, ctx) {
  return bool(ctx.activity.idempotencyKeyUsed, 'activity.idempotencyKeyUsed') ? no('DUPLICATE_IDEMPOTENCY_KEY', `idempotency key ${o.idempotencyKey} already used`) : PASS;
}

function brokerAccount(o, ctx) {
  const a = ctx.brokerAccount;
  if (!a || a.id !== o.brokerAccountId || a.principalId !== o.principalId) return no('ACCOUNT_NOT_FOUND', 'broker account not found for this principal');
  if (a.status !== 'active') return no('ACCOUNT_INACTIVE', `broker account is ${a.status}`);
  if (a.environment !== o.mode) return no('ACCOUNT_MODE_MISMATCH', `account environment ${a.environment} ≠ order mode ${o.mode}`);
  if (o.venue !== 'mock' && a.broker !== o.venue) return no('ACCOUNT_VENUE_MISMATCH', `account broker ${a.broker} ≠ venue ${o.venue}`);
  return PASS;
}

function mandate(o, ctx) {
  const m = ctx.mandate;
  const now = int(ctx.now, 'now');
  if (!m || m.id !== o.mandateId || m.principalId !== o.principalId) return no('MANDATE_NOT_FOUND', 'mandate not found for this principal');
  if (m.brokerAccountId !== o.brokerAccountId) return no('MANDATE_ACCOUNT_MISMATCH', 'mandate is for a different broker account');
  if (m.status !== 'active') return no('MANDATE_INACTIVE', `mandate is ${m.status}`);
  if (!m.approvedAt || !m.stepUpMethod) return no('MANDATE_NOT_APPROVED', 'mandate lacks step-up approval');
  if (now < int(m.validFrom, 'mandate.validFrom') || (m.validUntil !== null && m.validUntil !== undefined && now >= m.validUntil)) return no('MANDATE_EXPIRED', 'outside the mandate validity window');
  if (m.mode === 'copilot' && o.approvedBy !== o.principalId) return no('APPROVAL_REQUIRED', 'copilot mandate: the account owner must approve each order');
  if (!o.approvedBy) {
    if (!isModeB(o)) return no('APPROVAL_REQUIRED', 'an order without a human approval is only possible under Mode B');
    const r = modeBCoverage(o, ctx, m, now);
    if (r) return r;
  }
  if (m.currency !== ctx.policy.currency) return no('CURRENCY_MISMATCH', `mandate currency ${m.currency} ≠ policy ${ctx.policy.currency}`);
  return PASS;
}

function strategyState(o, ctx) {
  if (!o.strategyVersionId) return PASS; // manual / approved-proposal orders (approval enforced by checks 3 and 7)
  const s = ctx.strategy;
  if (!s || s.versionId !== o.strategyVersionId) return no('STRATEGY_NOT_FOUND', 'strategy version not found');
  const allowed = o.mode === 'paper' ? ['PAPER'] : ['LIVE_SMALL', 'LIVE'];
  if (!allowed.includes(s.state)) return no('STRATEGY_STATE', `strategy version is ${s.state}; ${o.mode} orders need ${allowed.join(' or ')}`);
  if (ctx.mandate.strategyId && ctx.mandate.strategyId !== s.strategyId) return no('STRATEGY_NOT_IN_MANDATE', 'mandate is bound to a different strategy');
  if (!need(s.instruments, 'strategy.instruments').includes(o.instrument)) return no('STRATEGY_UNIVERSE', `${o.instrument} is outside the strategy universe`);
  return PASS;
}

function instrumentAllowed(o, ctx) {
  const list = need(ctx.policy.allowedInstruments, 'policy.allowedInstruments');
  return list.includes(o.instrument) ? PASS : no('INSTRUMENT_NOT_ALLOWED', `${o.instrument} is not on the policy allowlist${list.length ? '' : ' (empty allowlist = nothing allowed)'}`);
}

function marketHours(o, ctx) {
  return marketCalendar(o.venue, ctx.holidays ?? []).isOpen(int(ctx.now, 'now')) ? PASS : no('MARKET_CLOSED', `${o.venue} is closed`);
}

function marketData(o, ctx) {
  const q = ctx.quote;
  if (!q || q.instrument !== o.instrument) return no('NO_MARKET_DATA', 'no quote for the instrument');
  if (bool(q.stale, 'quote.stale')) return no('STALE_MARKET_DATA', 'quote is stale (Stage 11 staleness)');
  const age = int(ctx.now, 'now') - int(q.sourceTime, 'quote.sourceTime');
  if (age > int(ctx.policy.limits.maxQuoteAgeMs, 'policy.limits.maxQuoteAgeMs') || age < -1000) return no('STALE_MARKET_DATA', `quote age ${age} ms`);
  if (compareDecimal(q.bid, '0') <= 0 || compareDecimal(q.bid, q.ask) > 0) return no('BAD_MARKET_DATA', 'crossed or non-positive quote');
  return PASS;
}

function priceCollar(o, ctx) {
  const bid = fx(ctx.quote.bid);
  const ask = fx(ctx.quote.ask);
  const mid = div(bid + ask, fxInt(2));
  const maxBps = fxInt(int(ctx.policy.limits.maxPriceDeviationBps, 'policy.limits.maxPriceDeviationBps'));
  const bps = (x) => div(mul(x < 0n ? -x : x, fxInt(10_000)), mid);
  if (bps(ask - bid) > maxBps) return no('SPREAD_TOO_WIDE', 'spread exceeds the price collar');
  if (o.type === 'limit' && bps(fx(o.limitPrice) - mid) > maxBps) return no('PRICE_COLLAR', `limit ${o.limitPrice} is outside ±${ctx.policy.limits.maxPriceDeviationBps} bps of mid`);
  return PASS;
}

function quantityFilters(o, ctx) {
  const s = ctx.instrument;
  if (!isMultipleOf(o.quantity, s.lotSize)) return no('LOT_SIZE', `quantity ${o.quantity} is not a multiple of lot ${s.lotSize}`);
  if (compareDecimal(o.quantity, s.minQuantity) < 0) return no('MIN_QUANTITY', `quantity below minimum ${s.minQuantity}`);
  if (o.type === 'limit' && !isMultipleOf(o.limitPrice, s.tickSize)) return no('TICK_SIZE', `limit price is not a multiple of tick ${s.tickSize}`);
  return PASS;
}

function minNotional(o, ctx) {
  const n = mulDecimal(o.quantity, referencePrice(o, ctx));
  return compareDecimal(n, ctx.instrument.minNotional) < 0 ? no('MIN_NOTIONAL', `notional ${n} below venue minimum ${ctx.instrument.minNotional}`) : PASS;
}

function maxOrderNotional(o, ctx) {
  if (ctx.instrument.quoteCurrency !== ctx.policy.currency) return no('CURRENCY_MISMATCH', `instrument quotes in ${ctx.instrument.quoteCurrency}, policy is in ${ctx.policy.currency} (no FX conversion)`);
  if (int(ctx.mandate.decimals, 'mandate.decimals') !== int(ctx.policy.decimals, 'policy.decimals')) return no('CURRENCY_MISMATCH', 'mandate and policy minor units differ');
  const n = notionalMinor(o, ctx);
  if (n > minor(ctx.policy.maxOrderNotionalMinor, 'policy.maxOrderNotionalMinor')) return no('MAX_ORDER_NOTIONAL', 'order notional above the policy per-order limit');
  if (n > minor(ctx.mandate.maxNotionalMinor, 'mandate.maxNotionalMinor')) return no('MANDATE_NOTIONAL', 'order notional above the mandate limit');
  return PASS;
}

function dailyNotional(o, ctx) {
  if (reducesExposure(o, ctx)) return PASS;
  const total = minor(ctx.activity.todayNotionalMinor, 'activity.todayNotionalMinor') + notionalMinor(o, ctx);
  return total > minor(ctx.policy.maxDailyNotionalMinor, 'policy.maxDailyNotionalMinor') ? no('MAX_DAILY_NOTIONAL', 'daily notional limit reached') : PASS;
}

function dailyLoss(o, ctx) {
  if (reducesExposure(o, ctx)) return PASS;
  const pnl = minor(ctx.activity.realizedPnlTodayMinor, 'activity.realizedPnlTodayMinor') + minor(ctx.activity.unrealizedPnlMinor, 'activity.unrealizedPnlMinor');
  return -pnl >= minor(ctx.policy.maxDailyLossMinor, 'policy.maxDailyLossMinor') ? no('MAX_DAILY_LOSS', 'daily loss limit reached: only exposure-reducing orders are allowed') : PASS;
}

function positionLimits(o, ctx) {
  const reduces = reducesExposure(o, ctx);
  if (o.reduceOnly === true && !reduces) return no('REDUCE_ONLY', 'reduce-only order would not reduce a position');
  if (reduces) return PASS;
  const open = ctx.activity.openPositions.filter((p) => compareDecimal(p.quantity, '0') !== 0);
  const existing = positionOf(o, ctx);
  if (!existing && open.length >= int(ctx.policy.maxOpenPositions, 'policy.maxOpenPositions')) return no('MAX_OPEN_POSITIONS', `already ${open.length} open positions`);
  const after = (existing ? minor(existing.notionalMinor, 'position.notionalMinor') : 0n) + notionalMinor(o, ctx);
  if (after > minor(ctx.policy.limits.maxPositionNotionalMinor, 'policy.limits.maxPositionNotionalMinor')) return no('MAX_POSITION_NOTIONAL', 'resulting position above the per-instrument limit');
  return PASS;
}

function leverage(o, ctx) {
  if (reducesExposure(o, ctx)) return PASS;
  const acc = need(ctx.account, 'account');
  if (o.side === 'sell' && ctx.policy.limits.allowShort !== true) return no('SHORT_NOT_ALLOWED', 'sell would open or increase a short; policy does not allow shorts');
  const equity = minor(acc.equityMinor, 'account.equityMinor');
  if (equity <= 0n) return no('NO_EQUITY', 'account equity is not positive');
  const n = notionalMinor(o, ctx);
  const gross = minor(acc.grossExposureMinor, 'account.grossExposureMinor') + n;
  const maxLev = fx(need(ctx.policy.maxLeverage, 'policy.maxLeverage'));
  if (gross * ONE > maxLev * equity) return no('MAX_LEVERAGE', `gross exposure would exceed ${ctx.policy.maxLeverage}× equity`);
  if (o.side === 'buy' && n > minor(acc.cashAvailableMinor, 'account.cashAvailableMinor')) return no('INSUFFICIENT_BUYING_POWER', 'not enough cash available');
  return PASS;
}

function orderRate(o, ctx) {
  const a = ctx.activity;
  const l = ctx.policy.limits;
  if (int(a.ordersLastMinute, 'activity.ordersLastMinute') >= int(l.maxOrdersPerMinute, 'policy.limits.maxOrdersPerMinute')) return no('ORDER_RATE_MINUTE', 'per-minute order limit reached');
  if (int(a.ordersToday, 'activity.ordersToday') >= int(l.maxOrdersPerDay, 'policy.limits.maxOrdersPerDay')) return no('ORDER_RATE_DAY', 'daily order limit reached');
  if (a.lastSimilarOrderAt !== null && int(ctx.now, 'now') - int(a.lastSimilarOrderAt, 'activity.lastSimilarOrderAt') < int(l.duplicateWindowMs, 'policy.limits.duplicateWindowMs')) {
    return no('DUPLICATE_ORDER', 'same instrument/side/quantity submitted within the duplicate window');
  }
  return PASS;
}

/** Ordered registry. The number is the evaluation order; an order must pass all 20. */
export const CHECKS = Object.freeze([
  { n: 1, id: 'kill_switch', title: 'Kill switches (policy + every matching scope) — evaluated first', fn: killSwitch },
  { n: 2, id: 'circuit_breakers', title: 'Circuit breakers (consecutive losses / rejects, broker errors) — trip a mandate kill switch', fn: circuitBreakers },
  { n: 3, id: 'trading_flags', title: 'Required trading flags for venue, mode and autonomy', fn: tradingFlags },
  { n: 4, id: 'order_schema', title: 'Order intent is well-formed and matches the instrument spec', fn: orderSchema },
  { n: 5, id: 'idempotency', title: 'Idempotency key not used before', fn: idempotency },
  { n: 6, id: 'broker_account', title: 'Broker account owned, active, environment = mode, broker = venue', fn: brokerAccount },
  { n: 7, id: 'mandate', title: 'Mandate owned, active, step-up approved, in window, copilot approval, currency', fn: mandate },
  { n: 8, id: 'strategy_state', title: 'Strategy version lifecycle allows the mode; mandate binding; universe', fn: strategyState },
  { n: 9, id: 'instrument_allowed', title: 'Instrument on the policy allowlist (empty = none)', fn: instrumentAllowed },
  { n: 10, id: 'market_hours', title: 'Venue session open', fn: marketHours },
  { n: 11, id: 'market_data', title: 'Quote present, fresh, sane', fn: marketData },
  { n: 12, id: 'price_collar', title: 'Spread and limit price within ±maxPriceDeviationBps of mid', fn: priceCollar },
  { n: 13, id: 'quantity_filters', title: 'Lot size, minimum quantity, tick size', fn: quantityFilters },
  { n: 14, id: 'min_notional', title: 'Venue minimum notional', fn: minNotional },
  { n: 15, id: 'max_order_notional', title: 'Per-order notional ≤ policy and mandate limits; currency match', fn: maxOrderNotional },
  { n: 16, id: 'daily_notional', title: 'Daily notional limit (exposure-reducing orders exempt)', fn: dailyNotional },
  { n: 17, id: 'daily_loss', title: 'Daily loss limit (exposure-reducing orders exempt)', fn: dailyLoss },
  { n: 18, id: 'position_limits', title: 'Reduce-only honoured; max open positions; per-instrument position notional', fn: positionLimits },
  { n: 19, id: 'leverage', title: 'No unapproved shorts; leverage ≤ max; buying power', fn: leverage },
  { n: 20, id: 'order_rate', title: 'Orders per minute / per day; duplicate-order window', fn: orderRate },
].map((c) => Object.freeze(c)));
