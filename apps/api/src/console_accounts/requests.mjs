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

/**
 * @param q {keyId?, product?, status?, from?, to?, limit?, cursor?}
 *   from/to: ISO dates or epoch seconds. Pagination is keyset on
 *   (created_at, id) DESC, so pages are stable while new rows arrive.
 */
export async function listRequests(pool, accountId, q = {}) {
  const limit = Math.min(Math.max(parseInt(q.limit, 10) || 50, 1), PAGE_MAX);
  const params = [accountId];
  const where = ['l.account_id = $1'];
  if (q.keyId !== undefined && q.keyId !== '') {
    params.push(Number(q.keyId));
    where.push(`l.api_key_id = $${params.length}`);
  }
  if (q.product) {
    const ops = PRODUCTS[q.product];
    if (!ops) throw new AccountError('invalid_filter', 400, `product must be one of: ${Object.keys(PRODUCTS).join(', ')}`);
    params.push(ops);
    where.push(`e.op_type = ANY($${params.length})`);
  }
  if (q.status) {
    params.push(String(q.status).slice(0, 32));
    where.push(`e.status = $${params.length}`);
  }
  const toEpoch = (v) => (/^\d+$/.test(String(v)) ? Number(v) : Math.floor(new Date(v).getTime() / 1000));
  if (q.from) {
    const f = toEpoch(q.from);
    if (!Number.isFinite(f)) throw new AccountError('invalid_filter', 400, 'from is not a date');
    params.push(f);
    where.push(`e.created_at >= $${params.length}`);
  }
  if (q.to) {
    const t = toEpoch(q.to);
    if (!Number.isFinite(t)) throw new AccountError('invalid_filter', 400, 'to is not a date');
    params.push(t);
    where.push(`e.created_at < $${params.length}`);
  }
  const cur = decodeCursor(q.cursor);
  if (cur) {
    params.push(cur.ts, cur.id);
    where.push(`(e.created_at, e.id) < ($${params.length - 1}, $${params.length})`);
  }
  params.push(limit + 1);

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
  const rows = r.rows.slice(0, limit);
  const next = r.rows.length > limit ? `${rows[rows.length - 1].created_at}_${rows[rows.length - 1].id}` : null;
  return {
    items: rows.map((e) => ({
      at: new Date(Number(e.created_at) * 1000).toISOString(),
      product: e.op_type === 'intelligence' ? 'intelligence' : e.op_type === 'rpc_call' ? 'rpc' : e.op_type,
      method: e.method,
      chain: e.chain,
      status: e.status,
      costUsdt: Number(e.amount_usdt),
      // Some writers embed the full key in request_id (Trading Intelligence:
      // "intel:<metric>:<key>:<ts>"). Never return it — swap in the hint.
      receiptId: e.request_id ? e.request_id.split(e._k).join(e.key_hint) : null,
      key: { id: e.api_key_id, label: e.label, hint: e.key_hint },
      latencyMs: null,
      usageUnits: null,
    })),
    nextCursor: next,
    notes: ['Latency and Usage Units are not recorded per request yet; they appear once Pricing V2 metering ships.'],
  };
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
