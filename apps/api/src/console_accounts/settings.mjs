// Server-side account settings + per-agent limits (CONSOLE_ACCOUNTS_V1).
// Enforcement lives in limits.mjs; this module validates and stores.
import { AccountError } from './keys.mjs';

export const PRODUCTS = ['rpc', 'intelligence'];

const DEFAULTS = {
  monthlySpendCapUsdt: null,
  creditAutoUse: true,
  alertThresholds: [70, 85, 95, 100],
  defaultMode: 'simple',
  timezone: 'UTC',
  notifications: { email: true, usageAlerts: true, productUpdates: false },
};

function shape(r) {
  if (!r) return { ...DEFAULTS };
  return {
    monthlySpendCapUsdt: r.monthly_spend_cap_usdt === null ? null : Number(r.monthly_spend_cap_usdt),
    creditAutoUse: r.credit_auto_use,
    alertThresholds: r.alert_thresholds,
    defaultMode: r.default_mode,
    timezone: r.timezone,
    notifications: { ...DEFAULTS.notifications, ...(r.notifications || {}) },
    updatedAt: r.updated_at,
  };
}

export async function getSettings(pool, accountId) {
  const r = await pool.query('SELECT * FROM account_settings WHERE account_id = $1', [accountId]);
  return shape(r.rows[0]);
}

function money(v, field) {
  if (v === null) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 1_000_000) throw new AccountError('invalid_setting', 400, `${field} must be between 0 and 1,000,000`, { field });
  return n;
}

/** Partial update; unknown fields are rejected, not ignored. */
export async function updateSettings(pool, accountId, patch = {}) {
  const allowed = ['monthlySpendCapUsdt', 'creditAutoUse', 'alertThresholds', 'defaultMode', 'timezone', 'notifications'];
  const unknown = Object.keys(patch).filter((k) => !allowed.includes(k));
  if (unknown.length) throw new AccountError('invalid_setting', 400, `Unknown setting: ${unknown.join(', ')}`);

  const cur = await getSettings(pool, accountId);
  const next = { ...cur, ...patch };
  if ('monthlySpendCapUsdt' in patch) next.monthlySpendCapUsdt = money(patch.monthlySpendCapUsdt, 'monthlySpendCapUsdt');
  if (typeof next.creditAutoUse !== 'boolean') throw new AccountError('invalid_setting', 400, 'creditAutoUse must be true or false');
  if (!['simple', 'advanced'].includes(next.defaultMode)) throw new AccountError('invalid_setting', 400, 'defaultMode must be simple or advanced');
  if (!Array.isArray(next.alertThresholds) || next.alertThresholds.length > 6 || !next.alertThresholds.every((n) => Number.isInteger(n) && n >= 1 && n <= 100)) {
    throw new AccountError('invalid_setting', 400, 'alertThresholds must be up to 6 whole percentages (1–100)');
  }
  next.alertThresholds = [...new Set(next.alertThresholds)].sort((a, b) => a - b);
  if ('timezone' in patch) {
    const tz = await pool.query('SELECT 1 FROM pg_timezone_names WHERE name = $1', [next.timezone]);
    if (!tz.rowCount) throw new AccountError('invalid_setting', 400, 'Unknown timezone', { field: 'timezone' });
  }
  if (typeof next.notifications !== 'object' || next.notifications === null || Array.isArray(next.notifications)) {
    throw new AccountError('invalid_setting', 400, 'notifications must be an object');
  }
  const r = await pool.query(
    `INSERT INTO account_settings (account_id, monthly_spend_cap_usdt, credit_auto_use, alert_thresholds, default_mode, timezone, notifications, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
     ON CONFLICT (account_id) DO UPDATE SET
       monthly_spend_cap_usdt = EXCLUDED.monthly_spend_cap_usdt, credit_auto_use = EXCLUDED.credit_auto_use,
       alert_thresholds = EXCLUDED.alert_thresholds, default_mode = EXCLUDED.default_mode,
       timezone = EXCLUDED.timezone, notifications = EXCLUDED.notifications, updated_at = NOW()
     RETURNING *`,
    [accountId, next.monthlySpendCapUsdt, next.creditAutoUse, next.alertThresholds, next.defaultMode, next.timezone, JSON.stringify(next.notifications)]
  );
  await pool.query('INSERT INTO account_audit (account_id, action, detail) VALUES ($1, $2, $3)', [accountId, 'settings.update', JSON.stringify({ before: cur, patch })]);
  return shape(r.rows[0]);
}

/** Per-agent limits for a key the account owns. */
export async function setAgentLimits(pool, accountId, keyId, patch = {}) {
  const owned = await pool.query('SELECT 1 FROM account_api_keys WHERE account_id = $1 AND api_key_id = $2 AND revoked_at IS NULL', [accountId, keyId]);
  if (!owned.rowCount) throw new AccountError('key_not_found', 404, 'No such key on this account');
  const allowed = ['paused', 'scopes', 'dailyCapUsdt', 'monthlyCapUsdt'];
  const unknown = Object.keys(patch).filter((k) => !allowed.includes(k));
  if (unknown.length) throw new AccountError('invalid_setting', 400, `Unknown limit: ${unknown.join(', ')}`);

  const cur = (await pool.query('SELECT paused, scopes, daily_cap_usdt, monthly_cap_usdt FROM agent_limits WHERE api_key_id = $1', [keyId])).rows[0]
    || { paused: false, scopes: null, daily_cap_usdt: null, monthly_cap_usdt: null };
  const paused = 'paused' in patch ? patch.paused : cur.paused;
  if (typeof paused !== 'boolean') throw new AccountError('invalid_setting', 400, 'paused must be true or false');
  let scopes = 'scopes' in patch ? patch.scopes : cur.scopes;
  if (scopes !== null) {
    if (!Array.isArray(scopes) || !scopes.every((p) => PRODUCTS.includes(p))) {
      throw new AccountError('invalid_setting', 400, `scopes must be null (all products) or a list of: ${PRODUCTS.join(', ')}`);
    }
    scopes = [...new Set(scopes)];
  }
  const dailyCap = 'dailyCapUsdt' in patch ? money(patch.dailyCapUsdt, 'dailyCapUsdt') : cur.daily_cap_usdt;
  const monthlyCap = 'monthlyCapUsdt' in patch ? money(patch.monthlyCapUsdt, 'monthlyCapUsdt') : cur.monthly_cap_usdt;

  const r = await pool.query(
    `INSERT INTO agent_limits (api_key_id, account_id, scopes, daily_cap_usdt, monthly_cap_usdt, paused, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())
     ON CONFLICT (api_key_id) DO UPDATE SET scopes = EXCLUDED.scopes, daily_cap_usdt = EXCLUDED.daily_cap_usdt,
       monthly_cap_usdt = EXCLUDED.monthly_cap_usdt, paused = EXCLUDED.paused, updated_at = NOW()
     RETURNING paused, scopes, daily_cap_usdt, monthly_cap_usdt`,
    [keyId, accountId, scopes, dailyCap, monthlyCap, paused]
  );
  await pool.query('INSERT INTO account_audit (account_id, action, subject, detail) VALUES ($1, $2, $3, $4)', [accountId, 'agent.limits', String(keyId), JSON.stringify({ before: cur, patch })]);
  const row = r.rows[0];
  const n = (v) => (v === null ? null : Number(v));
  return { paused: row.paused, scopes: row.scopes, dailyCapUsdt: n(row.daily_cap_usdt), monthlyCapUsdt: n(row.monthly_cap_usdt) };
}

/**
 * What this account has spent. Real spend comes from api_usage_daily (every
 * metered charge, by UTC day). Cap usage comes from the enforcement counters
 * (account timezone), which only move while a cap is set.
 */
export async function spendSummary(pool, accountId) {
  const s = await getSettings(pool, accountId);
  const spend = await pool.query(
    `SELECT l.api_key_id AS id,
            COALESCE(SUM(u.usdt_spent) FILTER (WHERE u.date >= date_trunc('month', CURRENT_DATE)::date), 0) AS month_usdt,
            COALESCE(SUM(u.usdt_spent) FILTER (WHERE u.date = CURRENT_DATE), 0) AS today_usdt,
            COALESCE(SUM(u.request_count) FILTER (WHERE u.date >= date_trunc('month', CURRENT_DATE)::date), 0) AS month_requests
       FROM account_api_keys l
       JOIN api_credits c ON c.id = l.api_key_id
       LEFT JOIN api_usage_daily u ON u.api_key = c.api_key
      WHERE l.account_id = $1 AND l.revoked_at IS NULL
      GROUP BY l.api_key_id`,
    [accountId]
  );
  const caps = await pool.query(
    `SELECT scope, scope_id, spent_usdt FROM account_spend_counters
      WHERE (scope = 'account_month' AND scope_id = $1 AND period = to_char(NOW() AT TIME ZONE $2, 'YYYY-MM'))
         OR (scope = 'agent_day' AND period = to_char(NOW() AT TIME ZONE $2, 'YYYY-MM-DD')
             AND scope_id IN (SELECT api_key_id::text FROM account_api_keys WHERE account_id = $1 AND revoked_at IS NULL))`,
    [accountId, s.timezone]
  );
  const perKey = spend.rows.map((r) => ({ id: r.id, monthUsdt: Number(r.month_usdt), todayUsdt: Number(r.today_usdt), monthRequests: Number(r.month_requests) }));
  const monthCap = caps.rows.find((x) => x.scope === 'account_month');
  return {
    monthSpentUsdt: perKey.reduce((a, k) => a + k.monthUsdt, 0),
    todaySpentUsdt: perKey.reduce((a, k) => a + k.todayUsdt, 0),
    monthRequests: perKey.reduce((a, k) => a + k.monthRequests, 0),
    perKey,
    spendDays: 'UTC',
    caps: {
      timezone: s.timezone,
      monthlySpendCapUsdt: s.monthlySpendCapUsdt,
      monthCountedUsdt: monthCap ? Number(monthCap.spent_usdt) : null,
      agentsTodayCountedUsdt: Object.fromEntries(caps.rows.filter((x) => x.scope === 'agent_day').map((x) => [x.scope_id, Number(x.spent_usdt)])),
    },
  };
}

// ---- Saved queries ----
export async function listSavedQueries(pool, accountId) {
  const r = await pool.query('SELECT id, name, query, created_at FROM account_saved_queries WHERE account_id = $1 ORDER BY created_at DESC', [accountId]);
  return r.rows.map((x) => ({ id: Number(x.id), name: x.name, query: x.query, createdAt: x.created_at }));
}

export async function saveQuery(pool, accountId, { name, query }) {
  if (typeof name !== 'string' || !name.trim() || name.length > 80) throw new AccountError('invalid_query', 400, 'Name must be 1–80 characters');
  if (typeof query !== 'object' || query === null || JSON.stringify(query).length > 4000) throw new AccountError('invalid_query', 400, 'Query must be an object under 4 KB');
  const n = await pool.query('SELECT COUNT(*)::int AS n FROM account_saved_queries WHERE account_id = $1', [accountId]);
  if (n.rows[0].n >= 100) throw new AccountError('query_limit_reached', 409, 'An account can save 100 queries');
  const r = await pool.query('INSERT INTO account_saved_queries (account_id, name, query) VALUES ($1, $2, $3) RETURNING id, created_at', [accountId, name.trim(), JSON.stringify(query)]);
  return { id: Number(r.rows[0].id), name: name.trim(), query, createdAt: r.rows[0].created_at };
}

export async function deleteSavedQuery(pool, accountId, id) {
  const r = await pool.query('DELETE FROM account_saved_queries WHERE account_id = $1 AND id = $2', [accountId, id]);
  if (!r.rowCount) throw new AccountError('not_found', 404, 'No such saved query');
  return { id, deleted: true };
}
