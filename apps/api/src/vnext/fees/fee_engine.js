// Fee Engine (Constitution §9) — Satelink's revenue brain. The kernel NEVER
// computes revenue; this does, deterministically and explainably.
//
// Input:  RoutingDecision, ExecutionResult, SettlementContext, FeePolicy
// Output: FeeInstruction { feeType, feeAmount, currency, payer, receiver,
//         settlementMode, base, splits, explanation{human,machine}, auditHash }
//
// Pure and deterministic: no Date/random, integer BigInt money only, so the
// same inputs always yield byte-identical output (and the same auditHash).
// Fees are non-negative by construction; currencies must match; a failed
// execution yields a zero fee.

import { hashObject } from '../../utils/canonical_json.js';
import { FeeError, toMinor, bpsOf, assertBps, parsePercentToBps, positiveSpread } from './money.js';

const VERSION = 'fee-v1';
const FEE_TYPES = new Set(['zero', 'fixed', 'bps', 'percentage', 'spread', 'hybrid', 'subscription', 'dynamic']);

function fmt(n) { return n.toString(); }

function assertCurrency(expected, got, field) {
  if (got != null && got !== expected) {
    throw new FeeError('CURRENCY_MISMATCH', `${field} currency '${got}' != settlement currency '${expected}'`);
  }
}

/** Compute a single fee component (used by primitive types and hybrid). */
function computeComponent(type, params, ctx) {
  switch (type) {
    case 'zero':
      return 0n;
    case 'fixed':
      return toMinor(params.amount, 'fixed.amount');
    case 'bps': {
      const bps = assertBps(toMinor(params.bps, 'bps'));
      return bpsOf(ctx.base, bps);
    }
    case 'percentage': {
      const bps = assertBps(parsePercentToBps(params.percent));
      return bpsOf(ctx.base, bps);
    }
    case 'spread': {
      const captureBps = assertBps(params.captureBps != null ? toMinor(params.captureBps, 'captureBps') : 10_000n);
      return bpsOf(positiveSpread(ctx.buyerAmount, ctx.supplierCost), captureBps);
    }
    case 'dynamic': {
      if (!Array.isArray(params.tiers) || params.tiers.length === 0) throw new FeeError('CONFIG', 'dynamic requires tiers[]');
      let chosen = params.tiers[params.tiers.length - 1];
      for (const t of params.tiers) {
        if (t.upTo == null) { chosen = t; break; }
        if (ctx.base <= toMinor(t.upTo, 'tier.upTo')) { chosen = t; break; }
      }
      const bps = assertBps(toMinor(chosen.bps, 'tier.bps'));
      return bpsOf(ctx.base, bps);
    }
    default:
      throw new FeeError('CONFIG', `unknown fee component type '${type}'`);
  }
}

function humanFor(type, ctx, fee, currency, receiver, params) {
  switch (type) {
    case 'zero': return `Zero fee (${currency}).`;
    case 'fixed': return `Fixed fee of ${fmt(fee)} ${currency} to ${receiver}.`;
    case 'bps': return `${params.bps} bps of base ${fmt(ctx.base)} ${currency} = ${fmt(fee)} ${currency} to ${receiver} (floor).`;
    case 'percentage': return `${params.percent}% of base ${fmt(ctx.base)} ${currency} = ${fmt(fee)} ${currency} to ${receiver} (floor).`;
    case 'spread': return `Spread capture on max(0, ${fmt(ctx.buyerAmount)} - ${fmt(ctx.supplierCost)}) = ${fmt(fee)} ${currency} to ${receiver}.`;
    case 'hybrid': return `Hybrid fee = ${fmt(fee)} ${currency} to ${receiver} (sum of components).`;
    case 'subscription': return `Subscription override: flat ${fmt(fee)} ${currency} to ${receiver}.`;
    case 'dynamic': return `Dynamic tiered fee on base ${fmt(ctx.base)} ${currency} = ${fmt(fee)} ${currency} to ${receiver}.`;
    default: return `Fee ${fmt(fee)} ${currency}.`;
  }
}

export class FeeEngine {
  /**
   * @param {object} decision   RoutingDecision (may be null)
   * @param {object} execution  ExecutionResult { status }
   * @param {object} settlement SettlementContext { txId, currency, payer, receiver, settlementMode, baseAmount?, buyerAmount?, supplierCost?, supplierCurrency?, subscription? }
   * @param {object} feePolicy  { type, ...params, currency?, receiver?, splits? }
   * @returns {object} FeeInstruction
   */
  computeFee(decision, execution, settlement, feePolicy) {
    if (!settlement || typeof settlement !== 'object') throw new FeeError('CONFIG', 'settlement context required');
    if (!settlement.currency) throw new FeeError('CONFIG', 'settlement.currency required');
    if (!settlement.txId) throw new FeeError('CONFIG', 'settlement.txId required');
    if (!feePolicy || !feePolicy.type) throw new FeeError('CONFIG', 'feePolicy.type required');

    const currency = settlement.currency;
    // Currency coherence across every currency-bearing input.
    assertCurrency(currency, feePolicy.currency, 'feePolicy');
    assertCurrency(currency, settlement.supplierCurrency, 'settlement.supplierCurrency');
    assertCurrency(currency, decision && decision.chosen && decision.chosen.currency, 'decision.chosen');

    const receiverBase = feePolicy.receiver || settlement.receiver || 'satelink-treasury';
    const payer = settlement.payer || 'anon';
    const settlementMode = settlement.settlementMode || 'POST';

    const ctx = {
      base: settlement.baseAmount != null ? toMinor(settlement.baseAmount, 'settlement.baseAmount') : 0n,
      buyerAmount: settlement.buyerAmount != null ? toMinor(settlement.buyerAmount, 'settlement.buyerAmount') : 0n,
      supplierCost: settlement.supplierCost != null ? toMinor(settlement.supplierCost, 'settlement.supplierCost') : 0n,
    };

    // Failed execution -> no charge (no delivery, no fee).
    const success = execution && execution.status === 'success';

    let feeType;
    let fee;

    if (!success) {
      feeType = 'zero';
      fee = 0n;
    } else if (settlement.subscription && settlement.subscription.active === true) {
      // Subscription override wins over any configured fee type.
      feeType = 'subscription';
      fee = toMinor(settlement.subscription.flatAmount != null ? settlement.subscription.flatAmount : 0, 'subscription.flatAmount');
    } else {
      feeType = feePolicy.type;
      if (!FEE_TYPES.has(feeType)) throw new FeeError('CONFIG', `unknown feeType '${feeType}'`);
      if (feeType === 'hybrid') {
        if (!Array.isArray(feePolicy.components) || feePolicy.components.length === 0) throw new FeeError('CONFIG', 'hybrid requires components[]');
        fee = feePolicy.components.reduce((sum, c) => sum + computeComponent(c.type, c, ctx), 0n);
      } else if (feeType === 'subscription') {
        fee = toMinor(feePolicy.flatAmount != null ? feePolicy.flatAmount : 0, 'subscription.flatAmount');
      } else {
        fee = computeComponent(feeType, feePolicy, ctx);
      }
    }

    if (fee < 0n) throw new FeeError('NEGATIVE', 'computed fee is negative'); // unreachable by construction; asserted anyway

    // Optional partner splits: exact-sum, remainder to the primary receiver (no leakage).
    let splits = null;
    if (Array.isArray(feePolicy.splits) && feePolicy.splits.length > 0 && fee > 0n) {
      splits = [];
      let allocated = 0n;
      for (const sp of feePolicy.splits) {
        const bps = assertBps(toMinor(sp.bps, 'split.bps'));
        const amt = bpsOf(fee, bps);
        allocated += amt;
        splits.push({ receiver: sp.receiver, amount: fmt(amt) });
      }
      if (allocated > fee) throw new FeeError('CONFIG', 'split bps sum exceeds 100%');
      splits.unshift({ receiver: receiverBase, amount: fmt(fee - allocated) }); // remainder -> primary
      const total = splits.reduce((s, x) => s + BigInt(x.amount), 0n);
      if (total !== fee) throw new FeeError('INTERNAL', 'split sum != fee'); // invariant guard
    }

    const machine = {
      type: feeType,
      base: fmt(ctx.base),
      buyerAmount: fmt(ctx.buyerAmount),
      supplierCost: fmt(ctx.supplierCost),
      params: sanitizeParams(feePolicy),
      result: fmt(fee),
      rounding: 'ROUND_DOWN',
    };

    const core = {
      version: VERSION,
      txId: settlement.txId,
      decisionId: decision && decision.decisionId ? decision.decisionId : null,
      feeType,
      feeAmount: fmt(fee),
      currency,
      base: fmt(ctx.base),
      payer,
      receiver: receiverBase,
      settlementMode,
      splits,
    };
    const auditHash = 'fee_' + hashObject(core);

    return {
      ...core,
      explanation: {
        human: humanFor(feeType, ctx, fee, currency, receiverBase, feePolicy),
        machine,
      },
      auditHash,
    };
  }
}

function sanitizeParams(feePolicy) {
  // Deterministic, primitive-only echo of the config for the machine explanation.
  const out = {};
  for (const k of ['bps', 'percent', 'amount', 'captureBps', 'flatAmount']) {
    if (feePolicy[k] != null) out[k] = String(feePolicy[k]);
  }
  if (Array.isArray(feePolicy.components)) out.components = feePolicy.components.map((c) => c.type);
  if (Array.isArray(feePolicy.tiers)) out.tiers = feePolicy.tiers.map((t) => ({ upTo: t.upTo == null ? null : String(t.upTo), bps: String(t.bps) }));
  if (Array.isArray(feePolicy.splits)) out.splits = feePolicy.splits.map((s) => ({ receiver: s.receiver, bps: String(s.bps) }));
  return out;
}
