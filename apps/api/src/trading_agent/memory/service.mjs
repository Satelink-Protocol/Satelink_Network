// Trading memory service (Phase 6 item 9). Records structured memory and retrieves a BOUNDED,
// structured context for the AI layer — summaries and recent rows, never chat history (none is stored).
import { fx, add, toDecimal } from '../strategies/fixed.mjs';

const OUTCOMES = ['profit', 'loss', 'flat', 'not_executed'];

export class MemoryService {
  #store; #ids; #clock;
  constructor({ store, idFactory, clock = () => new Date() }) {
    if (!store || typeof idFactory !== 'function') throw new Error('MemoryService needs a store and idFactory');
    this.#store = store; this.#ids = idFactory; this.#clock = clock;
  }
  #now() { return this.#clock().toISOString(); }

  async setProfile({ principalId, riskTolerance, capital = null, currency = 'USDT', maxLoss = null, markets = [], brokers = [] }) {
    if (!['low', 'medium', 'high'].includes(riskTolerance)) throw Object.assign(new Error('riskTolerance must be low | medium | high'), { code: 'INVALID' });
    return this.#store.upsertProfile({ principalId, riskTolerance, capital, currency, maxLoss, markets, brokers, updatedAt: this.#now() });
  }

  /** A scorecard decision (item 6) enters memory with its dimensions and evidence. */
  async recordDecision(decision) {
    await this.#store.append('decision_memory', {
      id: this.#ids('dm'), decisionId: decision.id, entryKind: 'decision', principalId: decision.subject?.principalId ?? null,
      opportunityId: decision.subject?.opportunityId ?? null, strategyVersionId: decision.strategy_version ?? null,
      decision: decision.decision, score: decision.score, dimensionScores: decision.dimension_scores, evidenceRefs: decision.evidence_refs ?? [], recordedAt: this.#now(),
    });
  }
  async recordAuthorization({ decisionId, principalId, mandateId }) {
    await this.#store.append('decision_memory', { id: this.#ids('dm'), decisionId, entryKind: 'authorization', principalId, authorizationRef: `mandate:${mandateId}`, recordedAt: this.#now() });
  }
  /** Exactly one outcome per decision (later corrections are new decisions, not edits). */
  async recordOutcome({ decisionId, principalId, outcome, pnl = null }) {
    if (!OUTCOMES.includes(outcome)) throw Object.assign(new Error(`outcome must be one of ${OUTCOMES.join(', ')}`), { code: 'INVALID' });
    await this.#store.append('decision_memory', { id: this.#ids('dm'), decisionId, entryKind: 'outcome', principalId, outcome, outcomePnl: pnl, recordedAt: this.#now() });
  }
  async recordTrade({ decisionId = null, principalId, orderId = null, fillIds = [], instrument, pnl, regime = null, score = null, executionQuality = null, closedAt }) {
    await this.#store.append('trade_memory', { id: this.#ids('tm'), decisionId, principalId, orderId, fillIds, instrument, pnl, regime, score, executionQuality, closedAt });
  }
  async recordStrategyEvidence({ strategyVersionId, kind, regime = null, metrics, failureModes = [], evidenceRef = null }) {
    await this.#store.append('strategy_memory', { id: this.#ids('sm'), strategyVersionId, kind, regime, metrics, failureModes, evidenceRef, recordedAt: this.#now() });
  }
  async recordError({ scope, code, detail = null, context = null, principalId = null }) {
    await this.#store.append('error_memory', { id: this.#ids('em'), scope, code, detail: detail == null ? null : String(detail).slice(0, 500), context, principalId, occurredAt: this.#now() });
  }

  /**
   * Structured context for an agent: bounded counts, summaries and the last few rows.
   * @returns {{ profile, decisions, strategy, trades, errors, summary }} — no chat history, ever
   */
  async contextFor({ principalId, strategyVersionId = null, limit = 10 }) {
    const n = Math.min(Math.max(1, limit), 25);
    const profile = await this.#store.profile(principalId);
    const dm = await this.#store.list('decision_memory', { principalId }, 200);
    const outcomes = new Map(dm.filter((r) => r.entryKind === 'outcome').map((r) => [r.decisionId, r.outcome]));
    const decisions = dm.filter((r) => r.entryKind === 'decision');
    const byOutcome = {};
    const counts = {};
    for (const d of decisions) { const o = outcomes.get(d.decisionId) ?? 'pending'; counts[o] = (counts[o] ?? 0) + 1; }
    for (const o of [...OUTCOMES, 'pending']) if (counts[o]) byOutcome[o] = counts[o]; // canonical order: stable across stores
    const trades = await this.#store.list('trade_memory', { principalId }, 200);
    const pnl = toDecimal(trades.reduce((s, t) => add(s, fx(t.pnl)), 0n));
    const sm = strategyVersionId ? await this.#store.list('strategy_memory', { strategyVersionId }, 50) : [];
    const latestByKind = {};
    for (const r of sm) if (!latestByKind[r.kind]) latestByKind[r.kind] = { metrics: r.metrics, regime: r.regime, recordedAt: r.recordedAt };
    const failureModes = [...new Set(sm.flatMap((r) => r.failureModes ?? []))].slice(0, 10);
    const errors = await this.#store.list('error_memory', { principalId }, n);
    const ctx = {
      profile: profile ? { riskTolerance: profile.riskTolerance, capital: profile.capital, currency: profile.currency, maxLoss: profile.maxLoss, markets: profile.markets, brokers: profile.brokers } : null,
      decisions: { total: decisions.length, byOutcome, recent: decisions.slice(0, n).map((d) => ({ decisionId: d.decisionId, decision: d.decision, score: d.score, outcome: outcomes.get(d.decisionId) ?? 'pending' })) },
      strategy: strategyVersionId ? { strategyVersionId, latestByKind, failureModes } : null,
      trades: { total: trades.length, netPnl: pnl, recent: trades.slice(0, n).map((t) => ({ instrument: t.instrument, pnl: t.pnl, regime: t.regime, score: t.score })) },
      errors: errors.map((e) => ({ scope: e.scope, code: e.code })),
    };
    const parts = [
      ctx.profile ? `Profile: ${ctx.profile.riskTolerance} risk, max loss ${ctx.profile.maxLoss ?? 'unset'} ${ctx.profile.currency}, markets ${ctx.profile.markets.join(', ') || 'none'}.` : 'No trading profile.',
      `${ctx.decisions.total} past decisions (${Object.entries(byOutcome).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}).`,
      `${ctx.trades.total} closed trades, net P&L ${ctx.trades.netPnl}.`,
      ctx.strategy ? `Strategy ${strategyVersionId}: evidence ${Object.keys(latestByKind).join(', ') || 'none'}; failure modes ${failureModes.join(', ') || 'none recorded'}.` : '',
      errors.length ? `Recent errors: ${[...new Set(errors.map((e) => e.code))].join(', ')}.` : '',
    ].filter(Boolean);
    return Object.freeze({ ...ctx, summary: parts.join(' ') });
  }
}
