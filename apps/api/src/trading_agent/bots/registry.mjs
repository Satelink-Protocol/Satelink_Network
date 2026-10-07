// Bot registry (Phase 6 item 10). Bots are the operating workers of Satelink Trading AI.
//
//   scheduled + deterministic — never call an LLM; they run the existing Stage 15–29 jobs' runOnce()
//   event-driven + AI         — only through the orchestrator (item 8) → scorecard; never an order
//
// Each bot declares: the extra trading flag it needs (on top of TRADING_AGENT), whether it ACTS on
// orders (acting bots stop while a global kill switch is engaged; watchers keep running), which deps
// it needs (missing deps → disabled 'not_configured'), and its interval or event.
import { runDailyKeyRecheck } from '../security/key_recheck.mjs';
import { activeGlobal } from './kill.mjs';

const MIN = 60_000;

export const BOTS = Object.freeze([
  { id: 'market_monitor', kind: 'scheduled', intervalMs: MIN, flag: null, acts: false, requires: ['marketMonitor'],
    run: (d) => d.marketMonitor.runOnce() },
  { id: 'broker_health', kind: 'scheduled', intervalMs: MIN, flag: null, acts: false, requires: ['brokerHealth'],
    run: (d) => d.brokerHealth.runOnce() },
  { id: 'oms_dispatcher', kind: 'scheduled', intervalMs: 2_000, flag: null, acts: true, requires: ['dispatcher'],
    run: (d) => d.dispatcher.runOnce() },
  { id: 'oms_reconciler', kind: 'scheduled', intervalMs: 15_000, flag: null, acts: false, requires: ['omsReconciler'],
    run: (d) => d.omsReconciler.runOnce() },
  { id: 'fill_consumer', kind: 'scheduled', intervalMs: 5_000, flag: null, acts: false, requires: ['fillConsumer'],
    run: (d) => d.fillConsumer.runOnce() },
  { id: 'portfolio_reconciler', kind: 'scheduled', intervalMs: 5 * MIN, flag: null, acts: false, requires: ['portfolioReconciler', 'reconcileScopes'],
    run: async (d) => { const out = []; for (const s of await d.reconcileScopes()) out.push(await d.portfolioReconciler.runOnce(s)); return out.length; } },
  { id: 'kill_switch_watcher', kind: 'scheduled', intervalMs: 10_000, flag: null, acts: false, requires: ['killSwitchEvents'],
    run: async (d, ctx) => { const g = activeGlobal(await d.killSwitchEvents()); ctx.metrics.killSwitchGlobal.set(g ? 1 : 0); return g ? 'engaged' : 'clear'; } },
  { id: 'key_recheck', kind: 'scheduled', intervalMs: 24 * 60 * MIN, flag: 'BINANCE', acts: false, requires: ['keyRecheck'],
    run: (d) => runDailyKeyRecheck(d.keyRecheck) },
  { id: 'revenue_variance', kind: 'scheduled', intervalMs: 60 * MIN, flag: 'REVENUE_ENGINE', acts: false, requires: ['revenueEngine'],
    run: (d, ctx) => {
      const r = d.revenueEngine.varianceReport('real');
      for (const s of r.streams) ctx.metrics.revenueVariance.set({ stream: s.stream, currency: s.currency }, Number(s.varianceMinor));
      return r.open.length;
    } },
  // event-driven, AI via the orchestrator only
  { id: 'opportunity_pipeline', kind: 'event', event: 'opportunity.detected', flag: null, acts: true, requires: ['orchestrator'],
    run: (d, _ctx, e) => d.orchestrator.run({ kind: 'evaluate_opportunity', principalId: e.principalId, instrument: e.instrument, mandateId: e.mandateId, opportunityId: e.opportunityId, machineRequestId: e.machineRequestId ?? null }) },
  { id: 'post_trade_review', kind: 'event', event: 'trade.closed', flag: null, acts: false, requires: ['orchestrator', 'memory'],
    run: async (d, _ctx, e) => {
      const r = await d.orchestrator.run({ kind: 'post_trade_review', principalId: e.principalId, instrument: e.instrument });
      await d.memory.recordTrade({ decisionId: e.decisionId ?? null, principalId: e.principalId, orderId: e.orderId ?? null, fillIds: e.fillIds ?? [], instrument: e.instrument, pnl: e.pnl, regime: e.regime ?? null, score: e.score ?? null, closedAt: e.closedAt });
      return r.status;
    } },
].map((b) => Object.freeze(b)));
