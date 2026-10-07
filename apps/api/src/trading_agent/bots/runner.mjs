// BotRunner (Phase 6 item 10). Runs in its OWN worker process (workers/trading-bots), never inside the
// API. Pattern from workers/reconciler: self-scheduling loop per bot, one run at a time (no overlap),
// fail-open (a throw is logged and the next tick retries), plus:
//   flags         TRADING_AGENT + the bot's own flag, read at every run (off → skipped_flag)
//   kill switches a global engaged switch skips every ACTING bot (skipped_kill_switch); watchers run
//   deps          a bot whose deps are not configured is disabled (not_configured)
//   timeouts      a run that exceeds timeoutMs is reported as timeout (its promise is abandoned)
//   metrics       separate prom-client registry: runs by outcome, duration, last success, queue drops
import client from 'prom-client';
import { BOTS } from './registry.mjs';
import { activeGlobal } from './kill.mjs';
import { isTradingFlagEnabled } from '../flags.mjs';

export const Outcome = Object.freeze({ OK: 'ok', ERROR: 'error', TIMEOUT: 'timeout', SKIPPED_FLAG: 'skipped_flag', SKIPPED_KILL: 'skipped_kill_switch', SKIPPED_OVERLAP: 'skipped_overlap', NOT_CONFIGURED: 'not_configured' });

export function createBotMetrics() {
  const registry = new client.Registry();
  return {
    registry,
    runs: new client.Counter({ name: 'trading_bot_runs_total', help: 'Bot runs by bot and outcome', labelNames: ['bot', 'outcome'], registers: [registry] }),
    duration: new client.Histogram({ name: 'trading_bot_run_duration_seconds', help: 'Bot run duration', labelNames: ['bot'], buckets: [0.01, 0.05, 0.1, 0.5, 1, 5, 30], registers: [registry] }),
    lastSuccess: new client.Gauge({ name: 'trading_bot_last_success_timestamp_seconds', help: 'Unix time of the last successful run', labelNames: ['bot'], registers: [registry] }),
    dropped: new client.Counter({ name: 'trading_bot_events_dropped_total', help: 'Events dropped because a bot queue was full', labelNames: ['bot'], registers: [registry] }),
    killSwitchGlobal: new client.Gauge({ name: 'trading_bot_global_kill_switch', help: '1 while a global kill switch is engaged', registers: [registry] }),
    revenueVariance: new client.Gauge({ name: 'trading_bot_revenue_variance_minor', help: 'Shadow revenue variance by stream (minor units)', labelNames: ['stream', 'currency'], registers: [registry] }),
  };
}

export class BotRunner {
  #bots; #deps; #env; #clock; #log; #timer; #state = new Map(); #queues = new Map(); #stopped = true;
  #timeoutMs; #maxQueue;

  constructor({ deps = {}, env = process.env, clock = () => new Date(), log = console, metrics = createBotMetrics(), bots = BOTS, timer = { set: setTimeout, clear: clearTimeout }, timeoutMs = 30_000, maxQueue = 100 }) {
    this.#bots = new Map(bots.map((b) => [b.id, b]));
    this.#deps = deps; this.#env = env; this.#clock = clock; this.#log = log; this.metrics = metrics; this.#timer = timer;
    this.#timeoutMs = timeoutMs; this.#maxQueue = maxQueue;
    for (const b of bots) this.#state.set(b.id, { running: false, lastOutcome: null, lastRunAt: null, lastError: null, handle: null });
  }

  /** Why a bot cannot run right now, or null. Flags are read at call time. */
  async #blocked(bot) {
    if (!isTradingFlagEnabled('TRADING_AGENT', this.#env) || (bot.flag && !isTradingFlagEnabled(bot.flag, this.#env))) return Outcome.SKIPPED_FLAG;
    if (bot.requires.some((k) => this.#deps[k] == null)) return Outcome.NOT_CONFIGURED;
    if (bot.acts) {
      if (typeof this.#deps.killSwitchEvents !== 'function') return Outcome.SKIPPED_KILL; // acting without kill-switch visibility: fail closed
      if (activeGlobal(await this.#deps.killSwitchEvents())) return Outcome.SKIPPED_KILL;
    }
    return null;
  }

  /** Run one bot once. Never throws. */
  async tick(botId, event = null) {
    const bot = this.#bots.get(botId);
    if (!bot) throw new Error(`unknown bot ${botId}`);
    const st = this.#state.get(botId);
    if (st.running) return this.#record(bot, Outcome.SKIPPED_OVERLAP);
    st.running = true;
    const started = this.#clock().getTime();
    try {
      let blocked;
      try { blocked = await this.#blocked(bot); } catch (e) { blocked = Outcome.SKIPPED_KILL; st.lastError = String(e?.message ?? e).slice(0, 200); }
      if (blocked) return this.#record(bot, blocked);
      let to;
      const timeout = new Promise((resolve) => { to = this.#timer.set(() => resolve({ timedOut: true }), this.#timeoutMs); });
      const work = Promise.resolve().then(() => bot.run(this.#deps, { metrics: this.metrics, clock: this.#clock }, event)).then((value) => ({ value }));
      const r = await Promise.race([work, timeout]).finally(() => this.#timer.clear(to));
      if (r.timedOut) { work.catch(() => {}); return this.#record(bot, Outcome.TIMEOUT); }
      this.metrics.lastSuccess.set({ bot: botId }, Math.floor(this.#clock().getTime() / 1000));
      return this.#record(bot, Outcome.OK, r.value);
    } catch (e) {
      st.lastError = String(e?.message ?? e).slice(0, 200);
      this.#log.error?.(`[trading-bots] ${botId} failed (fail-open):`, st.lastError);
      return this.#record(bot, Outcome.ERROR);
    } finally {
      this.metrics.duration.observe({ bot: botId }, (this.#clock().getTime() - started) / 1000);
      st.running = false;
    }
  }

  #record(bot, outcome, value = undefined) {
    const st = this.#state.get(bot.id);
    if (outcome !== Outcome.SKIPPED_OVERLAP) { st.lastOutcome = outcome; st.lastRunAt = this.#clock().toISOString(); }
    this.metrics.runs.inc({ bot: bot.id, outcome });
    return Object.freeze({ bot: bot.id, outcome, value });
  }

  /** Start every scheduled bot's self-scheduling loop. */
  start() {
    this.#stopped = false;
    for (const b of this.#bots.values()) {
      if (b.kind !== 'scheduled') continue;
      const loop = async () => {
        if (this.#stopped) return;
        await this.tick(b.id);
        if (!this.#stopped) this.#state.get(b.id).handle = this.#timer.set(loop, b.intervalMs);
      };
      this.#state.get(b.id).handle = this.#timer.set(loop, 0);
    }
  }

  stop() {
    this.#stopped = true;
    for (const st of this.#state.values()) if (st.handle) this.#timer.clear(st.handle);
  }

  /** Deliver an event to its event-driven bots (bounded queue per bot, processed one at a time). */
  async emit(event, payload) {
    const results = [];
    for (const b of this.#bots.values()) {
      if (b.kind !== 'event' || b.event !== event) continue;
      const q = this.#queues.get(b.id) ?? [];
      this.#queues.set(b.id, q);
      if (q.length >= this.#maxQueue) { this.metrics.dropped.inc({ bot: b.id }); results.push({ bot: b.id, outcome: 'dropped' }); continue; }
      q.push(payload);
      while (q.length && !this.#state.get(b.id).running) results.push(await this.tick(b.id, q.shift()));
    }
    return results;
  }

  status() {
    return Object.fromEntries([...this.#bots.values()].map((b) => [b.id, { kind: b.kind, acts: b.acts, flag: b.flag, ...(({ handle: _h, ...s }) => s)(this.#state.get(b.id)) }]));
  }
}
