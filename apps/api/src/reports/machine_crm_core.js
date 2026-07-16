// machine_crm_core.js
//
// Reusable Machine-CRM builder. Pure reads (SELECT-only) — shared by the CLI
// (scripts/machine_crm.js) and the hourly cron (admin/cron_scheduler.js).
//
// buildMachineCrm(runner, now, meta) takes anything with a .query() (pg Client
// or Pool), returns { _meta, summary, machines }. It performs no writes and does
// not manage the connection — callers own that.
//
// Identity model:
//   * Machine ID = api_credits.api_key.
//   * Revenue events matched by client_id ∈ {api_key, wallet, x402_<wallet>}.
//   * Payments = api_deposits(api_key) ∪ payment_sources(credited_api_key=api_key OR payer=wallet).
//   * revenue_events_v2.created_at is epoch SECONDS -> to_timestamp(created_at).
// Recurring = >= 2 payments. Lifecycle from recency of last_seen.

// Lifecycle thresholds (days since last seen). Autonomous RPC machines run
// continuously, so "active" is tight.
export const ACTIVE_MAX_D = 3;
export const AT_RISK_MAX_D = 7;
export const DORMANT_MAX_D = 30;

const num = (v) => (v == null ? 0 : Math.round(Number(v) * 1e6) / 1e6);
const iso = (d) => (d ? new Date(d).toISOString() : null);
const daysBetween = (a, b) => (a && b ? (new Date(a) - new Date(b)) / 86_400_000 : null);

function walletOf(machine) {
  if (machine.wallet_address) return machine.wallet_address.toLowerCase();
  const m = /^x402_(0x[0-9a-fA-F]{40})/.exec(machine.api_key || '');
  return m ? m[1].toLowerCase() : null;
}

const rows = async (runner, text) => (await runner.query(text)).rows;

export async function buildMachineCrm(runner, now = Date.now(), meta = {}) {
  // pg.Client runs one query at a time — sequential, not Promise.all.
  const credits = await rows(runner, `SELECT api_key, tier, credits_usdt, total_deposited, total_spent,
                      wallet_address, created_at, last_used, status, demand_source
               FROM api_credits`);
  const events = await rows(runner, `SELECT client_id,
                      count(*) AS events,
                      count(DISTINCT date(to_timestamp(created_at))) AS days_active,
                      min(to_timestamp(created_at)) AS first_request,
                      max(to_timestamp(created_at)) AS last_event,
                      coalesce(sum(amount_usdt),0) AS total_spend,
                      coalesce(sum(amount_usdt) FILTER (WHERE is_test_data IS NOT TRUE),0) AS real_spend,
                      bool_or(is_test_data IS TRUE) AS any_test,
                      (array_agg(source ORDER BY created_at))[1] AS first_source,
                      (array_agg(demand_source ORDER BY created_at))[1] AS first_demand
               FROM revenue_events_v2 GROUP BY client_id`);
  // api_deposits has no is_test_data column; deposit test-status is inferred
  // from the machine's revenue events / payment_sources instead.
  const deposits = await rows(runner, `SELECT api_key, amount_usdt, created_at FROM api_deposits`);
  const paysrc = await rows(runner, `SELECT credited_api_key, payer, amount_usd, created_at, is_test_data FROM payment_sources`);

  const evByClient = new Map();
  for (const e of events) evByClient.set(String(e.client_id).toLowerCase(), e);

  const records = credits.map((mc) => {
    const wallet = walletOf(mc);
    const candIds = new Set([mc.api_key?.toLowerCase(), wallet].filter(Boolean));

    let events_n = 0, days = 0, spend = 0, realSpend = 0, anyTest = false;
    let firstReq = null, lastEvent = null, firstSource = null, firstDemand = null;
    for (const id of candIds) {
      const e = evByClient.get(id);
      if (!e) continue;
      events_n += Number(e.events);
      days = Math.max(days, Number(e.days_active)); // distinct-day counts don't sum cleanly; take max
      spend += Number(e.total_spend);
      realSpend += Number(e.real_spend);
      anyTest = anyTest || e.any_test === true;
      if (!firstReq || new Date(e.first_request) < new Date(firstReq)) { firstReq = e.first_request; firstSource = e.first_source; firstDemand = e.first_demand; }
      if (!lastEvent || new Date(e.last_event) > new Date(lastEvent)) lastEvent = e.last_event;
    }

    const payments = [];
    for (const d of deposits) if (d.api_key?.toLowerCase() === mc.api_key?.toLowerCase())
      payments.push({ at: d.created_at, amount: num(d.amount_usdt), rail: 'deposit_usdt', test: false });
    for (const p of paysrc) {
      const credited = p.credited_api_key?.toLowerCase() === mc.api_key?.toLowerCase();
      const byPayer = wallet && p.payer?.toLowerCase() === wallet;
      if (credited || byPayer)
        payments.push({ at: p.created_at, amount: num(p.amount_usd), rail: 'x402_usdc', test: p.is_test_data === true });
    }
    payments.sort((a, b) => new Date(a.at) - new Date(b.at));

    const last_seen = [mc.last_used, lastEvent].filter(Boolean).sort((a, b) => new Date(b) - new Date(a))[0] || null;
    const daysSinceSeen = last_seen ? daysBetween(now, last_seen) : null;
    const credits_remaining = num(mc.credits_usdt);
    const lifetime_spend = num(mc.total_spent);
    const avg_daily_spend = days > 0 ? num(lifetime_spend / days) : 0;
    const paidCount = payments.length;

    const recencyBonus = daysSinceSeen == null ? 0 : daysSinceSeen <= 3 ? 20 : daysSinceSeen <= 7 ? 12 : daysSinceSeen <= 14 ? 6 : 0;
    const paymentDepth = paidCount >= 2 ? 50 : paidCount === 1 ? 20 : 0;
    const recurring_score = Math.min(100,
      paymentDepth + Math.min(days, 10) * 2 + recencyBonus + (credits_remaining > 0 ? 10 : 0));

    const neverRequested = events_n === 0 && !last_seen;
    let lifecycle;
    if (neverRequested || (daysSinceSeen != null && daysSinceSeen > DORMANT_MAX_D)) lifecycle = 'dead';
    else if (daysSinceSeen != null && daysSinceSeen > AT_RISK_MAX_D) lifecycle = 'dormant';
    else if ((daysSinceSeen != null && daysSinceSeen > ACTIVE_MAX_D) ||
             (paidCount >= 1 && avg_daily_spend > 0 && credits_remaining > 0 && credits_remaining <= avg_daily_spend * 2))
      lifecycle = 'at_risk';
    else lifecycle = 'active';

    return {
      machine_id: mc.api_key,
      partner: mc.demand_source || 'unattributed',
      discovery_source: firstSource || firstDemand || mc.demand_source || 'unknown',
      wallet: mc.wallet_address || (wallet ? wallet : null),
      first_request: iso(firstReq),
      first_key: iso(mc.created_at),
      first_payment: payments[0] ? iso(payments[0].at) : null,
      second_payment: payments[1] ? iso(payments[1].at) : null,
      days_active: days,
      credits_remaining_usdt: credits_remaining,
      lifetime_spend_usdt: lifetime_spend,
      avg_daily_spend_usdt: avg_daily_spend,
      last_seen: iso(last_seen),
      recurring_score,
      lifecycle,
      at_risk: lifecycle === 'at_risk',
      dormant: lifecycle === 'dormant',
      dead: lifecycle === 'dead',
      payments_count: paidCount,
      is_recurring: paidCount >= 2,
      is_test_founder: anyTest || payments.some((p) => p.test),
      real_spend_usdt: num(realSpend),
      tier: mc.tier,
      status: mc.status,
    };
  });

  records.sort((a, b) => b.recurring_score - a.recurring_score || b.lifetime_spend_usdt - a.lifetime_spend_usdt);

  const byLifecycle = (s) => records.filter((r) => r.lifecycle === s).length;
  const summary = {
    machines: records.length,
    active: byLifecycle('active'),
    at_risk: byLifecycle('at_risk'),
    dormant: byLifecycle('dormant'),
    dead: byLifecycle('dead'),
    recurring_machines: records.filter((r) => r.is_recurring).length,
    recurring_external_real: records.filter((r) => r.is_recurring && !r.is_test_founder && r.real_spend_usdt > 0).length,
    paying_machines: records.filter((r) => r.payments_count >= 1).length,
    total_credits_remaining_usdt: num(records.reduce((s, r) => s + r.credits_remaining_usdt, 0)),
    total_lifetime_spend_usdt: num(records.reduce((s, r) => s + r.lifetime_spend_usdt, 0)),
  };

  return {
    _meta: {
      report: 'machine_crm',
      version: 1,
      generated_at: new Date(now).toISOString(),
      read_only: true,
      lifecycle_thresholds_days: { active: `<=${ACTIVE_MAX_D}`, at_risk: `<=${AT_RISK_MAX_D}`, dormant: `<=${DORMANT_MAX_D}`, dead: `>${DORMANT_MAX_D} or never requested` },
      notes: 'recurring = >=2 payments; is_test_founder marks founder/test machines so external-real can be isolated',
      ...meta,
    },
    summary,
    machines: records,
  };
}
