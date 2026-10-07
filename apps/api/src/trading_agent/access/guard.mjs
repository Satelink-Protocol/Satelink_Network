// Agent access guard (Phase 6 item 11): scope, rate limit and budget BEFORE a call; metering AFTER.
//   scope    READ < PROPOSE < EXECUTE_UNDER_MANDATE                    → 403 SCOPE_INSUFFICIENT
//   rate     per key, per minute (in-process window)                     → 429 RATE_LIMITED
//   budget   calls and USD in the key's period (day / month, UTC)        → 402 BUDGET_EXHAUSTED
//   metering one usage row per billable call (idempotent by request id) → shadow revenue engine
import { scopeAllows } from './keys.mjs';
import { MACHINE_PRICING } from './pricing.mjs';

import { ApiError } from '../api/errors.mjs';

/** An ApiError, so the Stage 24 envelope keeps the status (402 / 403 / 429 …) and code. */
export class AccessError extends ApiError {}

const periodStart = (now, period) => (period === 'month'
  ? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())));

export class AgentAccessGuard {
  #store; #ids; #clock; #pricing; #revenue; #windows = new Map();
  /** @param revenue optional ShadowRevenueEngine (item 1) — usage is posted as usage_charge events */
  constructor({ store, idFactory, clock = () => new Date(), pricing = MACHINE_PRICING, revenue = null }) {
    this.#store = store; this.#ids = idFactory; this.#clock = clock; this.#pricing = pricing; this.#revenue = revenue;
  }

  async check(principal, endpoint, needs) {
    const k = principal?.agentKey;
    if (!k) throw new AccessError(403, 'AGENT_KEY_REQUIRED', 'this endpoint is for agent / machine API keys');
    if (!scopeAllows(k.scope, needs)) throw new AccessError(403, 'SCOPE_INSUFFICIENT', `scope ${k.scope} does not allow ${endpoint}`);
    const now = this.#clock();
    const minute = Math.floor(now.getTime() / 60_000);
    const w = this.#windows.get(k.id);
    const count = w && w.minute === minute ? w.count : 0;
    if (count >= k.ratePerMinute) throw new AccessError(429, 'RATE_LIMITED', `rate limit ${k.ratePerMinute}/min`);
    this.#windows.set(k.id, { minute, count: count + 1 });
    const used = await this.#store.usageSince(k.id, periodStart(now, k.budgetPeriod).toISOString());
    const price = BigInt(this.#pricing.perCallUsdMicro[endpoint] ?? 0);
    if (used.calls + 1 > k.budgetCalls) throw new AccessError(402, 'BUDGET_EXHAUSTED', `call budget ${k.budgetCalls}/${k.budgetPeriod} used`);
    if (used.usdMicro + price > BigInt(k.budgetUsdMicro)) throw new AccessError(402, 'BUDGET_EXHAUSTED', `USD budget used for this ${k.budgetPeriod}`);
    return { price };
  }

  /** Record one billable call (idempotent per request id) and post it to the shadow revenue engine. */
  async meter(principal, endpoint, requestId) {
    const k = principal.agentKey;
    const price = BigInt(this.#pricing.perCallUsdMicro[endpoint] ?? 0);
    const row = { id: this.#ids('tau'), keyId: k.id, principalId: principal.principalId, endpoint, requestId, units: 1, chargeUsdMicro: price, priceVersion: this.#pricing.version, at: this.#clock().toISOString() };
    try { await this.#store.insertUsage(row); } catch (e) { if (e.code === 'DUPLICATE') return { duplicate: true }; throw e; }
    if (this.#revenue && price > 0n) {
      // DRAFT pricing → simulated book; a published price would post live usage to the real book
      const live = this.#pricing.published === true;
      this.#revenue.record({ type: 'usage_charge', id: `${k.id}:${requestId}`, amountMinor: price, currency: 'USDMC' /* micro-USD unit */, mode: live ? 'live' : 'test', simulated: !live, at: row.at }, { book: live ? 'real' : 'sim' });
    }
    return { duplicate: false, chargeUsdMicro: price };
  }
}
