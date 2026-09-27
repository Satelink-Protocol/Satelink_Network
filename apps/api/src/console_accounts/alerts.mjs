// Console alerts (D7, CONSOLE_ACCOUNTS_V1): per-account preferences, an
// evaluator job, email delivery via Resend, de-dup/cooldown and history.
//
// Sources — every alert is computed from data that already exists:
//   usage        api_usage_daily.request_count ÷ api_credits.daily_limit, per
//                linked key per UTC day; plus Pricing V2 plan UU windows when
//                SATELINK_USAGE_LIMITS_V2_ENABLED (accountPlan).
//   spend_cap    account_spend_counters ('account_month') ÷ the account's
//                monthly_spend_cap_usdt.
//   low_balance  per linked key, the RPC-spendable balance
//                (credits_usdt − dodo_funded_usdt) below the account's floor,
//                only for keys that were funded at least once.
//   deposit      api_deposits rows for linked keys, newer than both the
//                preference and 24 h.
//   error_rate   NOT MEASURED: failed calls are not recorded per request yet
//                (the request log only holds served, billed calls — D5). The
//                threshold is stored and the API says so; no alert is invented.
// Levels (usage and spend cap) and the on/off switches for usage warnings and
// account notices live in account_settings — one source of truth with Settings.
//
// De-dup: account_alert_events is UNIQUE (account_id, dedupe_key). A row is
// claimed ('queued') BEFORE the email is sent, so two instances or two ticks
// never send the same alert twice; a FAILED send is re-claimed after 30 min,
// up to 3 attempts. Windows: usage per key per day (plan: per
// window), spend cap per month, low balance per cooldown window, deposit per tx.
import crypto from 'node:crypto';
import { AccountError } from './keys.mjs';
import { getSettings } from './settings.mjs';
import { isConsoleAccountsEnabled } from './flag.mjs';
import { ensureConsoleAccountsSchema } from './schema.mjs';
import { isUsageLimitsV2Enabled } from '../pricing_v2/metering.mjs';
import { accountPlan } from '../pricing_v2/account_plan.mjs';

export const ALERT_FROM_DEFAULT = 'Satelink <automation@satelink.network>';
const HISTORY_LIMIT = 50;
const TEST_SENDS_PER_HOUR = 3;
const MAX_EMAILS_PER_ACCOUNT_PER_TICK = 3;
const RETENTION_DAYS = 180;
const ACCOUNTS_PER_TICK = 500;
const ADVISORY_KEY = 7_042_001; // pg_try_advisory_lock key for the evaluator

const PREF_DEFAULTS = { lowBalanceUsdt: null, depositConfirmed: true, errorRatePct: null, cooldownMinutes: 360 };

function shapePrefs(r) {
  if (!r) return { ...PREF_DEFAULTS };
  const n = (v) => (v === null ? null : Number(v));
  return {
    lowBalanceUsdt: n(r.low_balance_usdt),
    depositConfirmed: r.deposit_confirmed,
    errorRatePct: n(r.error_rate_pct),
    cooldownMinutes: r.cooldown_minutes,
    updatedAt: r.updated_at,
  };
}

export async function getAlertPrefs(pool, accountId) {
  const r = await pool.query('SELECT * FROM account_alert_prefs WHERE account_id = $1', [accountId]);
  return shapePrefs(r.rows[0]);
}

function optNumber(v, field, { min, max, exclusiveMin = false }) {
  if (v === null) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || (exclusiveMin ? n <= min : n < min) || n > max) {
    throw new AccountError('invalid_setting', 400, `${field} must be ${exclusiveMin ? 'above' : 'at least'} ${min} and at most ${max}, or null to turn it off`, { field });
  }
  return n;
}

/** Partial update; unknown fields are rejected, not ignored. Audited. */
export async function updateAlertPrefs(pool, accountId, patch = {}) {
  const allowed = ['lowBalanceUsdt', 'depositConfirmed', 'errorRatePct', 'cooldownMinutes'];
  const unknown = Object.keys(patch).filter((k) => !allowed.includes(k));
  if (unknown.length) throw new AccountError('invalid_setting', 400, `Unknown alert setting: ${unknown.join(', ')}`);
  const cur = await getAlertPrefs(pool, accountId);
  const next = { ...cur, ...patch };
  if ('lowBalanceUsdt' in patch) next.lowBalanceUsdt = optNumber(patch.lowBalanceUsdt, 'lowBalanceUsdt', { min: 0, max: 1_000_000 });
  if ('errorRatePct' in patch) next.errorRatePct = optNumber(patch.errorRatePct, 'errorRatePct', { min: 0, max: 100, exclusiveMin: true });
  if (typeof next.depositConfirmed !== 'boolean') throw new AccountError('invalid_setting', 400, 'depositConfirmed must be true or false');
  if (!Number.isInteger(next.cooldownMinutes) || next.cooldownMinutes < 15 || next.cooldownMinutes > 10080) {
    throw new AccountError('invalid_setting', 400, 'cooldownMinutes must be a whole number from 15 to 10080 (one week)');
  }
  const r = await pool.query(
    `INSERT INTO account_alert_prefs (account_id, low_balance_usdt, deposit_confirmed, error_rate_pct, cooldown_minutes, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (account_id) DO UPDATE SET low_balance_usdt = EXCLUDED.low_balance_usdt,
       deposit_confirmed = EXCLUDED.deposit_confirmed, error_rate_pct = EXCLUDED.error_rate_pct,
       cooldown_minutes = EXCLUDED.cooldown_minutes, updated_at = NOW()
     RETURNING *`,
    [accountId, next.lowBalanceUsdt, next.depositConfirmed, next.errorRatePct, next.cooldownMinutes]
  );
  await pool.query('INSERT INTO account_audit (account_id, action, detail) VALUES ($1, $2, $3)',
    [accountId, 'alerts.update', JSON.stringify({ before: cur, patch })]);
  return shapePrefs(r.rows[0]);
}

export function senderConfigured(env = process.env) {
  return Boolean(env.RESEND_API_KEY);
}

/** Resend delivery. Returns 'sent' | 'skipped_no_sender'; throws on a send error. */
export async function sendAlertEmail({ to, subject, text, html }, env = process.env) {
  if (!senderConfigured(env)) return 'skipped_no_sender';
  const { Resend } = await import('resend');
  const resend = new Resend(env.RESEND_API_KEY);
  const r = await resend.emails.send({ from: env.ALERTS_EMAIL_FROM || ALERT_FROM_DEFAULT, to, subject, text, html });
  if (r?.error) throw new Error(r.error.message || 'resend_error');
  return 'sent';
}

const consoleUrl = (env = process.env) => (env.CONSOLE_PUBLIC_URL || 'https://console.satelink.network').replace(/\/$/, '');

function render(subject, lines, env) {
  const text = [...lines, '', `Manage alerts: ${consoleUrl(env)}/alerts`, 'You get this because alerts are on for your Satelink account.'].join('\n');
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const html = `<div style="font-family:system-ui,sans-serif;font-size:14px;line-height:1.5">${lines.map((l) => `<p>${esc(l)}</p>`).join('')}`
    + `<p><a href="${consoleUrl(env)}/alerts">Manage alerts</a></p><p style="color:#666;font-size:12px">You get this because alerts are on for your Satelink account.</p></div>`;
  return { subject, text, html };
}

/**
 * Claim → send → record. Returns the event row (or null when this dedupe key
 * was already claimed). `suppressed` claims without sending (a lower level
 * superseded by a higher one in the same pass).
 */
async function deliver(pool, { accountId, email, kind, dedupeKey, message, detail, suppressed = false, send, env }) {
  const claim = await pool.query(
    `INSERT INTO account_alert_events (account_id, kind, dedupe_key, subject, detail, delivery)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (account_id, dedupe_key) DO UPDATE
        SET delivery = 'queued', attempts = account_alert_events.attempts + 1, last_attempt_at = NOW()
      -- Re-claim only a FAILED send, after 30 min, at most 3 attempts in total.
      WHERE account_alert_events.delivery = 'failed' AND account_alert_events.attempts < 3
        AND account_alert_events.last_attempt_at < NOW() - interval '30 minutes'
     RETURNING id`,
    [accountId, kind, dedupeKey, message.subject, JSON.stringify(detail), suppressed ? 'suppressed' : 'queued']
  );
  if (!claim.rowCount) return null;
  const id = claim.rows[0].id;
  if (suppressed) return { id, delivery: 'suppressed' };
  let delivery, error = null;
  try {
    delivery = await send({ to: email, ...message }, env);
  } catch (err) {
    delivery = 'failed';
    error = String(err.message || err).slice(0, 300);
  }
  await pool.query(
    `UPDATE account_alert_events SET delivery = $2, delivery_error = $3, delivered_at = CASE WHEN $2 = 'sent' THEN NOW() ELSE NULL END WHERE id = $1`,
    [id, delivery, error]
  );
  return { id, delivery };
}

const pct = (used, cap) => (cap > 0 ? (used / cap) * 100 : 0);
const fmtUsd = (n) => `$${Number(n).toFixed(Number(n) < 1 ? 5 : 2)}`;

/** Every alert currently due for one account (pure read). */
export async function dueAlerts(pool, accountId, { now = new Date(), usageV2 = isUsageLimitsV2Enabled(), planFn = accountPlan } = {}) {
  const [settings, prefs] = await Promise.all([getSettings(pool, accountId), getAlertPrefs(pool, accountId)]);
  const levels = [...(settings.alertThresholds || [])].sort((a, b) => a - b);
  const notices = settings.notifications?.email !== false;
  const usageOn = settings.notifications?.usageAlerts !== false;
  const day = now.toISOString().slice(0, 10);
  const out = [];

  const keys = (await pool.query(
    `SELECT l.api_key_id AS id, l.label, l.key_hint, c.daily_limit, c.credits_usdt, c.total_deposited,
            COALESCE((to_jsonb(c) ->> 'dodo_funded_usdt')::numeric, 0) AS dodo_fence,
            COALESCE((SELECT u.request_count FROM api_usage_daily u WHERE u.api_key = c.api_key AND u.date = $2::date), 0) AS used_today
       FROM account_api_keys l JOIN api_credits c ON c.id = l.api_key_id
      WHERE l.account_id = $1 AND l.revoked_at IS NULL`,
    [accountId, day]
  )).rows;
  const keyName = (k) => `${k.label} (${k.key_hint})`;

  // Usage — highest newly crossed level per window is sent; lower ones are recorded as suppressed.
  const levelSet = (window, used, cap, describe) => {
    const crossed = levels.filter((t) => pct(used, cap) >= t);
    crossed.forEach((t, i) => out.push({
      kind: 'usage', dedupeKey: `usage:${window}:${t}`, suppressed: i < crossed.length - 1,
      detail: { window, level: t, used, cap, pct: Math.round(pct(used, cap) * 10) / 10 },
      message: describe(t),
    }));
  };
  if (usageOn) {
    for (const k of keys) {
      const cap = Number(k.daily_limit) || 0;
      levelSet(`key:${k.id}:${day}`, Number(k.used_today), cap, (t) => ({
        subject: `Satelink: ${keyName(k)} reached ${t}% of its daily request limit`,
        lines: [`Your key ${keyName(k)} has made ${Number(k.used_today).toLocaleString('en-US')} of ${cap.toLocaleString('en-US')} requests allowed today (UTC).`,
          t >= 100 ? 'Further calls today get a 429 until the limit resets at 00:00 UTC.' : 'The limit resets at 00:00 UTC.'],
      }));
    }
    if (usageV2) {
      try {
        const plan = await planFn(pool, accountId, { tz: settings.timezone });
        for (const [name, w] of Object.entries(plan.windows || {})) {
          const stamp = w.resetsAt ? new Date(w.resetsAt).toISOString().slice(0, 13) : day;
          levelSet(`plan_${name}:${stamp}`, w.usedUu, w.capUu, (t) => ({
            subject: `Satelink: ${t}% of your ${name} Trading Intelligence allowance used`,
            lines: [`You have used ${w.usedUu.toLocaleString('en-US')} of ${w.capUu.toLocaleString('en-US')} Usage Units in the current ${name} window of your ${plan.plan.id} plan.`],
          }));
        }
      } catch { /* plan data unavailable — the key-level usage above still applies */ }
    }
  }

  // Monthly spend cap.
  const cap = settings.monthlySpendCapUsdt;
  if (usageOn && cap !== null && cap > 0) {
    const r = await pool.query(
      `SELECT spent_usdt, period FROM account_spend_counters
        WHERE scope = 'account_month' AND scope_id = $1 AND period = to_char(NOW() AT TIME ZONE $2, 'YYYY-MM')`,
      [accountId, settings.timezone || 'UTC']
    );
    const spent = Number(r.rows[0]?.spent_usdt || 0);
    const period = r.rows[0]?.period || now.toISOString().slice(0, 7);
    const crossed = levels.filter((t) => pct(spent, cap) >= t);
    crossed.forEach((t, i) => out.push({
      kind: 'spend_cap', dedupeKey: `spend_cap:${period}:${t}`, suppressed: i < crossed.length - 1,
      detail: { level: t, spentUsdt: spent, capUsdt: cap, period },
      message: {
        subject: `Satelink: ${t}% of your monthly spend cap used`,
        lines: [`Your account has spent ${fmtUsd(spent)} of its ${fmtUsd(cap)} monthly cap (${period}).`,
          t >= 100 ? 'Paid calls are refused until the month ends or you raise the cap in Settings.' : 'Paid calls stop when the cap is reached.'],
      },
    }));
  }

  // Low balance (RPC-spendable crypto credits, per key that was funded once).
  if (notices && prefs.lowBalanceUsdt !== null) {
    const bucket = Math.floor(now.getTime() / (prefs.cooldownMinutes * 60_000));
    for (const k of keys) {
      if (!(Number(k.total_deposited) > 0)) continue;
      const spendable = Math.max(0, Number(k.credits_usdt) - Number(k.dodo_fence));
      if (spendable >= prefs.lowBalanceUsdt) continue;
      out.push({
        kind: 'low_balance', dedupeKey: `low_balance:${k.id}:${bucket}`,
        detail: { keyId: k.id, spendableUsdt: spendable, floorUsdt: prefs.lowBalanceUsdt },
        message: {
          subject: `Satelink: low balance on ${keyName(k)}`,
          lines: [`${keyName(k)} has ${fmtUsd(spendable)} of USDT credits left for RPC, below your alert level of ${fmtUsd(prefs.lowBalanceUsdt)}.`,
            'Top up with a USDT deposit on Polygon from Billing → Add money.'],
        },
      });
    }
  }

  // Deposit confirmed.
  if (notices && prefs.depositConfirmed && keys.length) {
    const since = new Date(Math.max(new Date(prefs.updatedAt || 0).getTime(), now.getTime() - 24 * 3600e3));
    const deps = (await pool.query(
      `SELECT d.tx_hash, d.amount_usdt, COALESCE((to_jsonb(d) ->> 'credited_usdt')::numeric, d.amount_usdt) AS credited, d.created_at, l.api_key_id, l.label, l.key_hint
         FROM api_deposits d JOIN api_credits c ON c.api_key = d.api_key
         JOIN account_api_keys l ON l.api_key_id = c.id AND l.account_id = $1 AND l.revoked_at IS NULL
        WHERE d.created_at >= $2 ORDER BY d.created_at LIMIT 20`,
      [accountId, since]
    )).rows;
    for (const d of deps) {
      out.push({
        kind: 'deposit_confirmed', dedupeKey: `deposit:${d.tx_hash}`,
        detail: { keyId: d.api_key_id, amountUsdt: Number(d.amount_usdt), creditedUsdt: Number(d.credited), txHash: d.tx_hash },
        message: {
          subject: `Satelink: deposit of ${fmtUsd(d.amount_usdt)} confirmed`,
          lines: [`A deposit of ${fmtUsd(d.amount_usdt)} was confirmed and ${fmtUsd(d.credited)} credited to ${d.label} (${d.key_hint}).`, `Reference: ${d.tx_hash}`],
        },
      });
    }
  }
  return out;
}

/** Evaluate and deliver for one account. Returns counts by delivery outcome. */
export async function evaluateAccount(pool, accountId, { send = sendAlertEmail, env = process.env, now = new Date(), ...opts } = {}) {
  const user = (await pool.query('SELECT email FROM "user" WHERE id = $1', [accountId])).rows[0];
  if (!user?.email) return { skipped: 'no_email' };
  const due = await dueAlerts(pool, accountId, { now, ...opts });
  const counts = {};
  let emailed = 0;
  for (const a of due) {
    const capped = !a.suppressed && emailed >= MAX_EMAILS_PER_ACCOUNT_PER_TICK;
    if (capped) continue; // not claimed — it will be sent on a later tick
    const r = await deliver(pool, {
      accountId, email: user.email, kind: a.kind, dedupeKey: a.dedupeKey, detail: a.detail,
      message: render(a.message.subject, a.message.lines, env), suppressed: a.suppressed, send, env,
    });
    if (!r) continue;
    counts[r.delivery] = (counts[r.delivery] || 0) + 1;
    if (!a.suppressed) emailed += 1;
  }
  return counts;
}

/** One evaluator pass over every account with a linked key or alert prefs. */
export async function runAlertsTick(pool, { send = sendAlertEmail, env = process.env, logger = console, ...opts } = {}) {
  if (!isConsoleAccountsEnabled() || env.CONSOLE_ALERTS_DISABLED === '1') return { ran: false, reason: 'disabled' };
  await ensureConsoleAccountsSchema(pool);
  const client = await pool.connect();
  let locked = false;
  try {
    locked = (await client.query('SELECT pg_try_advisory_lock($1) AS ok', [ADVISORY_KEY])).rows[0].ok;
    if (!locked) return { ran: false, reason: 'locked_elsewhere' };
    await client.query(`DELETE FROM account_alert_events WHERE created_at < NOW() - make_interval(days => $1)`, [RETENTION_DAYS]);
    const accounts = (await client.query(
      `SELECT account_id FROM account_api_keys WHERE revoked_at IS NULL
       UNION SELECT account_id FROM account_alert_prefs LIMIT $1`, [ACCOUNTS_PER_TICK]
    )).rows.map((r) => r.account_id);
    const totals = { accounts: accounts.length };
    for (const id of accounts) {
      try {
        const c = await evaluateAccount(pool, id, { send, env, ...opts });
        for (const [k, v] of Object.entries(c)) if (typeof v === 'number') totals[k] = (totals[k] || 0) + v;
      } catch (err) {
        totals.errors = (totals.errors || 0) + 1;
        logger.error?.('[alerts] account evaluation failed:', err.message);
      }
    }
    return { ran: true, ...totals };
  } finally {
    if (locked) await client.query('SELECT pg_advisory_unlock($1)', [ADVISORY_KEY]).catch(() => {});
    client.release();
  }
}

/** Starts the 5-minute evaluator. Inert unless CONSOLE_ACCOUNTS_V1=true (read every tick). */
export function startAlertsJob(pool, { intervalMs = 5 * 60_000, logger = console } = {}) {
  const tick = () => runAlertsTick(pool, { logger })
    .then((r) => { if (r.ran && (r.sent || r.failed || r.errors)) logger.log?.('[alerts]', JSON.stringify(r)); })
    .catch((err) => logger.error?.('[alerts] tick failed:', err.message));
  const t = setInterval(tick, intervalMs);
  t.unref?.();
  return t;
}

/** "Send test alert" — rate-limited, recorded in history, audited. */
export async function sendTestAlert(pool, account, { send = sendAlertEmail, env = process.env } = {}) {
  const recent = await pool.query(
    `SELECT COUNT(*)::int AS n FROM account_alert_events WHERE account_id = $1 AND kind = 'test' AND created_at > NOW() - interval '1 hour'`,
    [account.accountId]
  );
  if (recent.rows[0].n >= TEST_SENDS_PER_HOUR) {
    throw new AccountError('rate_limited', 429, `At most ${TEST_SENDS_PER_HOUR} test alerts per hour`);
  }
  const email = account.email || (await pool.query('SELECT email FROM "user" WHERE id = $1', [account.accountId])).rows[0]?.email;
  if (!email) throw new AccountError('no_email', 400, 'This account has no email address');
  const r = await deliver(pool, {
    accountId: account.accountId, email, kind: 'test', dedupeKey: `test:${crypto.randomUUID()}`, detail: {},
    message: render('Satelink: test alert', ['This is a test alert from your Satelink console. Real alerts arrive from this address.'], env),
    send, env,
  });
  await pool.query('INSERT INTO account_audit (account_id, action, detail) VALUES ($1, $2, $3)',
    [account.accountId, 'alerts.test', JSON.stringify({ delivery: r.delivery })]);
  const row = (await pool.query('SELECT id, kind, subject, delivery, delivery_error, created_at, delivered_at FROM account_alert_events WHERE id = $1', [r.id])).rows[0];
  return shapeEvent(row);
}

function shapeEvent(r) {
  return { id: Number(r.id), kind: r.kind, subject: r.subject, delivery: r.delivery, error: r.delivery_error || null, detail: r.detail ?? undefined, createdAt: r.created_at, deliveredAt: r.delivered_at };
}

/** GET /v1/me/alerts: rules with their status, prefs, and history. */
export async function getAlerts(pool, accountId, { env = process.env } = {}) {
  const [settings, prefs, hist] = await Promise.all([
    getSettings(pool, accountId),
    getAlertPrefs(pool, accountId),
    pool.query(
      `SELECT id, kind, subject, delivery, delivery_error, detail, created_at, delivered_at
         FROM account_alert_events WHERE account_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2`,
      [accountId, HISTORY_LIMIT]
    ),
  ]);
  const usageOn = settings.notifications?.usageAlerts !== false;
  const notices = settings.notifications?.email !== false;
  const levels = settings.alertThresholds || [];
  return {
    sender: { configured: senderConfigured(env), from: env.ALERTS_EMAIL_FROM || ALERT_FROM_DEFAULT },
    evaluator: { enabled: isConsoleAccountsEnabled() && env.CONSOLE_ALERTS_DISABLED !== '1', everyMinutes: 5 },
    prefs,
    rules: [
      { kind: 'usage', status: usageOn && levels.length ? 'on' : 'off', levels, detail: 'Daily request limit per key, and plan allowance windows when usage limits are on' },
      { kind: 'spend_cap', status: usageOn && settings.monthlySpendCapUsdt ? 'on' : 'off', levels, capUsdt: settings.monthlySpendCapUsdt },
      { kind: 'low_balance', status: notices && prefs.lowBalanceUsdt !== null ? 'on' : 'off', floorUsdt: prefs.lowBalanceUsdt },
      { kind: 'deposit_confirmed', status: notices && prefs.depositConfirmed ? 'on' : 'off' },
      { kind: 'error_rate', status: 'not_measured', thresholdPct: prefs.errorRatePct, detail: 'Failed calls are not recorded per request yet, so the error rate cannot be measured. Your threshold is saved and will apply once it can.' },
    ],
    history: hist.rows.map(shapeEvent),
  };
}
