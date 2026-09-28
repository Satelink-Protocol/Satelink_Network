// Per-request log for an account's keys (CONSOLE_ACCOUNTS_V1), read from the
// EXISTING per-request events in revenue_events_v2 (rpc_call, intelligence…).
// The join from key id to key string happens here, server-side; the key is
// never returned. Latency and Usage Units are not recorded per request today,
// so they are returned as null rather than invented.
import { AccountError } from './keys.mjs';

const PRODUCTS = { rpc: ['rpc_call'], intelligence: ['intelligence'] };
const PAGE_MAX = 200;

function decodeCursor(c) {
  if (!c) return null;
  const [ts, id] = String(c).split('_').map(Number);
  if (!Number.isFinite(ts) || !Number.isFinite(id)) throw new AccountError('invalid_cursor', 400, 'Bad cursor');
  return { ts, id };
}

/** Earliest request_log row (epoch seconds), or null if the table is empty/missing. */
async function logStart(pool) {
  try {
    const r = await pool.query(`SELECT extract(epoch FROM min(created_at))::bigint AS t FROM request_log`);
    return r.rows[0].t === null ? null : Number(r.rows[0].t);
  } catch (e) {
    if (e.code === '42P01') return null; // migration 020 not applied yet
    throw e;
  }
}

/**
 * @param q {keyId?, product?, status?, from?, to?, limit?, cursor?}
 *   from/to: ISO dates or epoch seconds. status: 'ok' | 'error' | an HTTP code.
 *   Source 1 (D5): request_log — every credentialed call incl. 402/429/5xx,
 *   with latency. Source 2: billed calls in revenue_events_v2 from before the
 *   request log existed (no latency, successes only). Keyset pagination on
 *   (created_at, id) DESC per source; the cursor names its source.
 */
export async function listRequests(pool, accountId, q = {}) {
  const limit = Math.min(Math.max(parseInt(q.limit, 10) || 50, 1), PAGE_MAX);
  const toEpoch = (v) => (/^\d+$/.test(String(v)) ? Number(v) : Math.floor(new Date(v).getTime() / 1000));
  const from = q.from ? toEpoch(q.from) : null;
  const to = q.to ? toEpoch(q.to) : null;
  if (q.from && !Number.isFinite(from)) throw new AccountError('invalid_filter', 400, 'from is not a date');
  if (q.to && !Number.isFinite(to)) throw new AccountError('invalid_filter', 400, 'to is not a date');
  if (q.product && !PRODUCTS[q.product]) throw new AccountError('invalid_filter', 400, `product must be one of: ${Object.keys(PRODUCTS).join(', ')}`);
  const status = q.status ? String(q.status).slice(0, 32) : null;
  if (status && !['ok', 'error'].includes(status) && !/^\d{3}$/.test(status)) throw new AccountError('invalid_filter', 400, 'status must be ok, error or an HTTP code');
  const keyId = q.keyId !== undefined && q.keyId !== '' ? Number(q.keyId) : null;

  let src = 'log';
  let cur = null;
  if (q.cursor) {
    const c = String(q.cursor);
    const m = c.match(/^(log|rev):(.+)$/);
    src = m ? m[1] : 'rev'; // un-prefixed cursors are from the pre-D5 API
    cur = decodeCursor(m ? m[2] : c);
  }
  const start = await logStart(pool);
  const items = [];
  let next = null;

  if (src === 'log' && start !== null) {
    const params = [accountId];
    const where = ['k.account_id = $1'];
    const add = (sql, v) => { params.push(v); where.push(sql.replace('?', `$${params.length}`)); };
    if (keyId !== null) add('r.api_key_id = ?', keyId);
    if (q.product) add('r.product = ?', q.product);
    if (status === 'ok') where.push('r.http_status < 400');
    else if (status === 'error') where.push('r.http_status >= 400');
    else if (status) add('r.http_status = ?', Number(status));
    if (from !== null) add('r.created_at >= to_timestamp(?)', from);
    if (to !== null) add('r.created_at < to_timestamp(?)', to);
    if (cur) { params.push(cur.ts, cur.id); where.push(`(extract(epoch FROM r.created_at)::bigint, r.id) < ($${params.length - 1}, $${params.length})`); }
    params.push(limit + 1);
    const r = await pool.query(
      `SELECT r.id, extract(epoch FROM r.created_at)::bigint AS ts, r.created_at, r.product, r.endpoint, r.chain, r.http_status,
              r.latency_ms, r.rail, r.charged_usdt, r.request_id, k.api_key_id, k.label, k.key_hint
         FROM request_log r
         JOIN account_api_keys k ON k.api_key_id = r.api_key_id
        WHERE ${where.join(' AND ')}
        ORDER BY r.created_at DESC, r.id DESC
        LIMIT $${params.length}`,
      params
    );
    for (const e of r.rows.slice(0, limit)) {
      items.push({
        at: new Date(e.created_at).toISOString(),
        product: e.product,
        method: e.endpoint,
        chain: e.chain,
        status: e.http_status < 400 ? 'success' : 'failed',
        httpStatus: e.http_status,
        rail: e.rail,
        costUsdt: Number(e.charged_usdt),
        receiptId: e.request_id,
        key: { id: e.api_key_id, label: e.label, hint: e.key_hint },
        latencyMs: e.latency_ms,
        usageUnits: null,
        source: 'request_log',
      });
    }
    if (r.rows.length > limit) {
      const last = r.rows[limit - 1];
      return { items, nextCursor: `log:${last.ts}_${last.id}`, notes: NOTES };
    }
    // The log is exhausted for this filter: continue with billed calls from before it existed.
    src = 'rev';
    cur = null;
  }

  const remaining = limit - items.length;
  if (remaining > 0) {
    const params = [accountId];
    const where = ['l.account_id = $1'];
    const add = (sql, v) => { params.push(v); where.push(sql.replace('?', `$${params.length}`)); };
    if (keyId !== null) add('l.api_key_id = ?', keyId);
    if (q.product) add('e.op_type = ANY(?)', PRODUCTS[q.product]);
    if (status === 'error' || (status && /^\d{3}$/.test(status) && Number(status) >= 400)) where.push('FALSE'); // only billed successes here
    if (from !== null) add('e.created_at >= ?', from);
    if (to !== null) add('e.created_at < ?', to);
    if (start !== null) add('e.created_at < ?', start);
    if (cur) { params.push(cur.ts, cur.id); where.push(`(e.created_at, e.id) < ($${params.length - 1}, $${params.length})`); }
    params.push(remaining + 1);
    // Revoked links are included: history stays visible after a key is revoked.
    const r = await pool.query(
      `SELECT e.id, e.created_at, e.op_type, e.method, e.chain, e.status, e.amount_usdt, e.request_id,
              c.api_key AS _k, l.api_key_id, l.label, l.key_hint
         FROM account_api_keys l
         JOIN api_credits c ON c.id = l.api_key_id
         JOIN revenue_events_v2 e ON e.client_id = c.api_key
        WHERE ${where.join(' AND ')}
        ORDER BY e.created_at DESC, e.id DESC
        LIMIT $${params.length}`,
      params
    );
    const rows = r.rows.slice(0, remaining);
    for (const e of rows) {
      items.push({
        at: new Date(Number(e.created_at) * 1000).toISOString(),
        product: e.op_type === 'intelligence' ? 'intelligence' : e.op_type === 'rpc_call' ? 'rpc' : e.op_type,
        method: e.method,
        chain: e.chain,
        status: e.status,
        httpStatus: null,
        rail: null,
        costUsdt: Number(e.amount_usdt),
        // Some writers embed the full key in request_id (Trading Intelligence:
        // "intel:<metric>:<key>:<ts>"). Never return it — swap in the hint.
        receiptId: e.request_id ? e.request_id.split(e._k).join(e.key_hint) : null,
        key: { id: e.api_key_id, label: e.label, hint: e.key_hint },
        latencyMs: null,
        usageUnits: null,
        source: 'billing',
      });
    }
    if (r.rows.length > remaining) next = `rev:${rows[rows.length - 1].created_at}_${rows[rows.length - 1].id}`;
  }
  return { items, nextCursor: next, notes: NOTES };
}

const NOTES = [
  'Calls made with an API key are logged with status and latency for 14 days (request log). Older entries are billed calls only, without latency.',
  'Usage Units are not recorded per request.',
];

/** Share of failed calls (HTTP ≥ 500, or 4xx other than 402/429) for an account over a window. */
export async function errorRate(pool, accountId, { minutes = 60, minCalls = 20 } = {}) {
  try {
    const r = await pool.query(
      `SELECT count(*)::int AS calls,
              count(*) FILTER (WHERE r.http_status >= 500 OR (r.http_status >= 400 AND r.http_status NOT IN (402, 429)))::int AS failed
         FROM request_log r JOIN account_api_keys k ON k.api_key_id = r.api_key_id AND k.revoked_at IS NULL
        WHERE k.account_id = $1 AND r.created_at > NOW() - make_interval(mins => $2)`,
      [accountId, minutes]
    );
    const { calls, failed } = r.rows[0];
    return { measured: true, calls, failed, pct: calls ? +((failed / calls) * 100).toFixed(2) : 0, enough: calls >= minCalls, minutes };
  } catch (e) {
    if (e.code === '42P01') return { measured: false };
    throw e;
  }
}

/** Daily usage per linked key (api_usage_daily, UTC days), zero-filled. */
export async function usageSeries(pool, accountId, { days = 30 } = {}) {
  const d = Math.min(Math.max(parseInt(days, 10) || 30, 1), 90);
  const r = await pool.query(
    `SELECT l.api_key_id AS id, l.label, g.day::date AS date,
            COALESCE(u.request_count, 0) AS requests, COALESCE(u.usdt_spent, 0) AS spent
       FROM account_api_keys l
       JOIN api_credits c ON c.id = l.api_key_id
      CROSS JOIN generate_series(CURRENT_DATE - ($2::int - 1), CURRENT_DATE, interval '1 day') AS g(day)
       LEFT JOIN api_usage_daily u ON u.api_key = c.api_key AND u.date = g.day::date
      WHERE l.account_id = $1 AND l.revoked_at IS NULL
      ORDER BY l.api_key_id, g.day`,
    [accountId, d]
  );
  const byKey = new Map();
  for (const row of r.rows) {
    if (!byKey.has(row.id)) byKey.set(row.id, { id: row.id, label: row.label, points: [] });
    byKey.get(row.id).points.push({ date: row.date.toISOString().slice(0, 10), requests: Number(row.requests), spentUsdt: Number(row.spent) });
  }
  return { days: d, timezone: 'UTC', keys: [...byKey.values()] };
}

/** USDT deposits credited to any of the account's keys (incl. revoked ones). */
export async function listDeposits(pool, accountId) {
  const r = await pool.query(
    `SELECT d.tx_hash, d.amount_usdt, d.credited_usdt, d.created_at, d.is_test_data, l.api_key_id, l.label, l.key_hint
       FROM account_api_keys l
       JOIN api_credits c ON c.id = l.api_key_id
       JOIN api_deposits d ON d.api_key = c.api_key
      WHERE l.account_id = $1
      ORDER BY d.created_at DESC LIMIT 200`,
    [accountId]
  );
  return r.rows.map((x) => ({
    txHash: x.tx_hash,
    amountUsdt: Number(x.amount_usdt),
    creditedUsdt: x.credited_usdt === null ? null : Number(x.credited_usdt),
    at: x.created_at,
    test: Boolean(x.is_test_data),
    key: { id: x.api_key_id, label: x.label, hint: x.key_hint },
  }));
}
