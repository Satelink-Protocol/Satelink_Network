import { expect } from 'chai';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { BotRunner, BOTS, Outcome } from '../src/trading_agent/bots/index.mjs';
import { tradingFlagEnvName as F } from '../src/trading_agent/flags.mjs';

// Phase 6 item 10 — automation bot runner (library + separate worker process).
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const ON = { [F('TRADING_AGENT')]: 'true', [F('BINANCE')]: 'true', [F('REVENUE_ENGINE')]: 'true' };
const GLOBAL_ENGAGED = [{ seq: 1, scopeType: 'global', scopeId: null, principalId: null, action: 'engage', source: 'admin', reason: 'halt' }];
const quiet = { info() {}, error() {} };
/** GET via node:http — independent of globalThis.fetch (other suites stub it). */
const get = (url) => new Promise((resolve, reject) => { http.get(url, (res) => { let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => resolve(b)); }).on('error', reject); });

/** Manual timer: records scheduled callbacks, runs them on demand. */
function manualTimer() {
  let id = 0; const pending = new Map();
  return {
    set: (fn, ms) => { pending.set(++id, { fn, ms }); return id; },
    clear: (h) => pending.delete(h),
    pending,
    async runAll() { const items = [...pending.entries()]; pending.clear(); for (const [, p] of items) await p.fn(); },
  };
}
function deps(over = {}) {
  const calls = [];
  const job = (name, ret = 'ok') => ({ runOnce: async (...a) => { calls.push(name); return typeof ret === 'function' ? ret(...a) : ret; } });
  return {
    calls,
    d: {
      marketMonitor: job('market'), brokerHealth: job('broker'), dispatcher: job('dispatch', 'placed'), omsReconciler: job('oms_reconcile'),
      fillConsumer: job('fills'), portfolioReconciler: job('pf_reconcile'), reconcileScopes: async () => [{ principalId: 'prn_a', brokerAccountId: 'bka_1', mode: 'paper' }],
      killSwitchEvents: async () => [],
      keyRecheck: { accounts: async () => [], fetchRestrictions: async () => ({}), killSwitch: { engage: async () => {} }, alert: async () => {} },
      revenueEngine: { varianceReport: () => ({ streams: [{ stream: 'subscription', currency: 'INR', varianceMinor: '1200' }], open: [{}] }) },
      orchestrator: { run: async (t) => { calls.push(`orch:${t.kind}`); return { status: 'ok', recommendation: 'GO', task: t }; } },
      memory: { recordTrade: async () => { calls.push('memory'); } },
      ...over,
    },
  };
}
const runner = (d, env = ON, extra = {}) => new BotRunner({ deps: d, env, log: quiet, clock: () => new Date('2026-10-07T00:00:00Z'), ...extra });

describe('trading: automation bot runner (Phase 6 item 10)', () => {
  it('registers the 9 scheduled deterministic bots and the 2 event-driven AI bots', () => {
    expect(BOTS.filter((b) => b.kind === 'scheduled').map((b) => b.id)).to.deep.equal(['market_monitor', 'broker_health', 'oms_dispatcher', 'oms_reconciler', 'fill_consumer', 'portfolio_reconciler', 'kill_switch_watcher', 'key_recheck', 'revenue_variance']);
    expect(BOTS.filter((b) => b.kind === 'event').map((b) => [b.id, b.event])).to.deep.equal([['opportunity_pipeline', 'opportunity.detected'], ['post_trade_review', 'trade.closed']]);
    for (const b of BOTS.filter((x) => x.kind === 'scheduled')) expect(b.requires, b.id).to.not.include('orchestrator');
  });

  it('deterministic bots run the existing jobs; none of them reaches the orchestrator (no LLM)', async () => {
    const { d, calls } = deps();
    const r = runner(d);
    for (const b of BOTS.filter((x) => x.kind === 'scheduled')) expect((await r.tick(b.id)).outcome, b.id).to.equal(Outcome.OK);
    expect(calls).to.deep.equal(['market', 'broker', 'dispatch', 'oms_reconcile', 'fills', 'pf_reconcile']);
    expect(calls.some((c) => c.startsWith('orch'))).to.equal(false);
  });

  it('flags are read at run time: TRADING_AGENT off → everything skipped; a bot flag off → that bot skipped', async () => {
    const { d, calls } = deps();
    expect((await runner(d, {}).tick('oms_dispatcher')).outcome).to.equal(Outcome.SKIPPED_FLAG);
    const env = { [F('TRADING_AGENT')]: 'true' };
    const r = runner(d, env);
    expect((await r.tick('key_recheck')).outcome).to.equal(Outcome.SKIPPED_FLAG);
    expect((await r.tick('revenue_variance')).outcome).to.equal(Outcome.SKIPPED_FLAG);
    expect((await r.tick('market_monitor')).outcome).to.equal(Outcome.OK);
    env[F('BINANCE')] = 'true';
    expect((await r.tick('key_recheck')).outcome).to.equal(Outcome.OK);
    expect(calls).to.deep.equal(['market']);
  });

  it('a global kill switch stops every ACTING bot; watchers keep running', async () => {
    const { d, calls } = deps({ killSwitchEvents: async () => GLOBAL_ENGAGED });
    const r = runner(d);
    expect((await r.tick('oms_dispatcher')).outcome).to.equal(Outcome.SKIPPED_KILL);
    expect((await r.emit('opportunity.detected', { principalId: 'prn_a', instrument: 'BTC-USDT' }))[0].outcome).to.equal(Outcome.SKIPPED_KILL);
    expect((await r.tick('oms_reconciler')).outcome).to.equal(Outcome.OK);
    expect((await r.tick('kill_switch_watcher')).value).to.equal('engaged');
    expect(calls).to.deep.equal(['oms_reconcile']);
    expect(await r.metrics.registry.getSingleMetricAsString('trading_bot_global_kill_switch')).to.match(/trading_bot_global_kill_switch 1/);
  });

  it('acting bots fail CLOSED without kill-switch visibility (missing or erroring)', async () => {
    const { d } = deps({ killSwitchEvents: undefined });
    expect((await runner(d).tick('oms_dispatcher')).outcome).to.equal(Outcome.SKIPPED_KILL);
    const { d: d2, calls } = deps({ killSwitchEvents: async () => { throw new Error('db down'); } });
    expect((await runner(d2).tick('oms_dispatcher')).outcome).to.equal(Outcome.SKIPPED_KILL);
    expect(calls).to.deep.equal([]);
  });

  it('missing deps → not_configured; throwing bot → error (fail-open, next run proceeds); overlap and timeout', async () => {
    const { d } = deps({ dispatcher: undefined });
    expect((await runner(d).tick('oms_dispatcher')).outcome).to.equal(Outcome.NOT_CONFIGURED);
    let fail = true;
    const { d: d2 } = deps({ fillConsumer: { runOnce: async () => { if (fail) { fail = false; throw new Error('boom'); } return 3; } } });
    const r2 = runner(d2);
    expect((await r2.tick('fill_consumer')).outcome).to.equal(Outcome.ERROR);
    expect(await r2.tick('fill_consumer')).to.deep.include({ outcome: Outcome.OK, value: 3 });
    let release;
    const { d: d3 } = deps({ marketMonitor: { runOnce: () => new Promise((res) => { release = res; }) } });
    const r3 = runner(d3);
    const first = r3.tick('market_monitor');
    await new Promise((res) => setImmediate(res));
    expect((await r3.tick('market_monitor')).outcome).to.equal(Outcome.SKIPPED_OVERLAP);
    release('done');
    expect((await first).outcome).to.equal(Outcome.OK);
    const { d: d4 } = deps({ brokerHealth: { runOnce: () => new Promise(() => {}) } });
    expect((await new BotRunner({ deps: d4, env: ON, log: quiet, timeoutMs: 20 }).tick('broker_health')).outcome).to.equal(Outcome.TIMEOUT);
  });

  it('start() schedules every scheduled bot (no overlap, at its interval); stop() cancels everything', async () => {
    const { d, calls } = deps();
    const timer = manualTimer();
    const r = runner(d, ON, { timer });
    r.start();
    expect(timer.pending.size).to.equal(9);
    await timer.runAll();
    expect(calls).to.include.members(['market', 'dispatch', 'fills']);
    const intervals = [...timer.pending.values()].map((p) => p.ms).filter((ms) => ms > 0).sort((a, b) => a - b);
    expect(intervals).to.include.members([2_000, 5_000, 10_000, 15_000, 60_000, 300_000, 3_600_000, 86_400_000]);
    r.stop();
    expect(timer.pending.size).to.equal(0);
  });

  it('event bots go through the orchestrator only; post-trade review records to memory; queues are bounded', async () => {
    const { d, calls } = deps();
    const r = runner(d);
    const [opp] = await r.emit('opportunity.detected', { principalId: 'prn_a', instrument: 'BTC-USDT', opportunityId: 'opp_1', machineRequestId: 'mreq_1' });
    expect(opp.value.task).to.deep.include({ kind: 'evaluate_opportunity', opportunityId: 'opp_1', machineRequestId: 'mreq_1' });
    await r.emit('trade.closed', { principalId: 'prn_a', instrument: 'BTC-USDT', pnl: '3.2', closedAt: '2026-10-07T00:00:00Z' });
    expect(calls).to.deep.equal(['orch:evaluate_opportunity', 'orch:post_trade_review', 'memory']);
    const r2 = new BotRunner({ deps: deps({ orchestrator: { run: () => new Promise(() => {}) } }).d, env: ON, log: quiet, maxQueue: 2, timeoutMs: 60_000 });
    void r2.emit('opportunity.detected', {});
    await new Promise((res) => setImmediate(res));
    await Promise.race([r2.emit('opportunity.detected', {}), new Promise((res) => setTimeout(res, 20))]);
    await Promise.race([r2.emit('opportunity.detected', {}), new Promise((res) => setTimeout(res, 20))]);
    expect((await r2.emit('opportunity.detected', {}))[0].outcome).to.equal('dropped');
  });

  it('emits Prometheus metrics: runs by outcome, revenue variance gauge', async () => {
    const { d } = deps();
    const r = runner(d);
    await r.tick('revenue_variance');
    await r.tick('oms_dispatcher');
    const text = await r.metrics.registry.metrics();
    expect(text).to.match(/trading_bot_runs_total\{bot="oms_dispatcher",outcome="ok"\} 1/);
    expect(text).to.match(/trading_bot_revenue_variance_minor\{stream="subscription",currency="INR"\} 1200/);
    expect(r.status().oms_dispatcher).to.include({ lastOutcome: 'ok', acts: true });
  });

  it('the API process schedules nothing: no bot import or trading timers in server.js / app_factory.mjs', () => {
    for (const f of ['apps/api/server.js', 'apps/api/app_factory.mjs']) expect(fs.readFileSync(path.join(ROOT, f), 'utf8'), f).to.not.match(/trading_agent|BotRunner|trading-bots/);
  });

  it('the worker runs as a separate process with /health and /metrics (no DB, flags off → nothing runs)', async function () {
    this.timeout(20_000);
    const port = 18_000 + Math.floor(Math.random() * 1000);
    const child = spawn(process.execPath, [path.join(ROOT, 'workers/trading-bots/src/index.mjs')], { env: { PATH: process.env.PATH, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
    try {
      let health;
      for (let i = 0; i < 50 && !health; i += 1) {
        await new Promise((res) => setTimeout(res, 100));
        health = await get(`http://127.0.0.1:${port}/health`).then((x) => JSON.parse(x)).catch(() => null);
      }
      expect(health).to.include({ ok: true, service: 'trading-bots' });
      expect(Object.keys(health.bots)).to.have.length(11);
      await new Promise((res) => setTimeout(res, 200));
      const metrics = await get(`http://127.0.0.1:${port}/metrics`);
      expect(metrics).to.match(/trading_bot_runs_total\{bot="oms_dispatcher",outcome="skipped_flag"\}/);
      expect(metrics).to.not.match(/outcome="ok"/);
    } finally {
      child.kill('SIGTERM');
      await new Promise((res) => child.once('exit', res));
    }
  });
});
