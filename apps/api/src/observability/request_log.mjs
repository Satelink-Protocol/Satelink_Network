// D5 — bounded per-request log for the customer console (table request_log,
// migration 020). Never on the request path: the middleware only pushes a
// small object into an in-memory buffer when the response finishes; a timer
// flushes the buffer in ONE multi-row INSERT every REQUEST_LOG_FLUSH_MS.
//
// Bounded by construction:
//   - only requests that carry a credential are buffered (X-API-Key /
//     Bearer, or a settled x402 payment); anonymous traffic (~500k 402s/day)
//     is never recorded. At flush, rows whose key does not exist are dropped
//     by the join, so garbage keys cannot grow the table.
//   - the buffer holds at most REQUEST_LOG_BUFFER_MAX rows; beyond that rows
//     are dropped and counted (stats().dropped), never queued unboundedly.
//   - rows older than REQUEST_LOG_RETENTION_DAYS (default 14) are deleted
//     hourly in batches; a size guard deletes the oldest day early if the
//     table exceeds REQUEST_LOG_MAX_MB.
// The raw key lives only in process memory until the flush resolves it to
// api_credits.id; it is never written or logged.
// Kill switch: REQUEST_LOG_ENABLED=false.

const env = (k, d) => (process.env[k] === undefined || process.env[k] === '' ? d : process.env[k]);

export function requestLogEnabled() {
  return env('REQUEST_LOG_ENABLED', 'true') !== 'false';
}

function credentialOf(req) {
  const h = req.headers || {};
  if (h['x-api-key']) return { key: String(h['x-api-key']).trim().slice(0, 200) };
  const auth = h.authorization;
  if (auth && /^Bearer\s+/i.test(auth)) return { key: auth.replace(/^Bearer\s+/i, '').trim().slice(0, 200) };
  if (req.x402?.settled && req.x402.wallet) return { wallet: String(req.x402.wallet).toLowerCase() };
  return null;
}

export function createRequestLog({ bufferMax = Number(env('REQUEST_LOG_BUFFER_MAX', 5000)), now = () => Date.now() } = {}) {
  let buffer = [];
  const counters = { buffered: 0, dropped: 0, flushed: 0, discarded: 0, flushErrors: 0 };

  function push(row) {
    if (buffer.length >= bufferMax) { counters.dropped += 1; return; }
    buffer.push(row);
    counters.buffered += 1;
  }

  /**
   * Express middleware. product: 'rpc' | 'intelligence'.
   * Reads what the route leaves in res.locals.satelinkBilling
   * ({ requestId, chargedUsdt, apiKey }) — descriptive only.
   */
  function middleware(product) {
    return (req, res, next) => {
      try { observe(req, res); } catch { /* logging never affects a response */ }
      next();
    };
    function observe(req, res) {
      if (!requestLogEnabled()) return;
      // Header credentials are known now; an x402 payment is verified by a later
      // middleware (req.x402), so anonymous-looking calls are re-checked at finish.
      const early = credentialOf(req);
      const start = now();
      // Path is relative to this mount NOW; later routers rewrite req.url.
      const seg = req.path.split('/').filter(Boolean);
      const chain = product === 'rpc' ? (seg[0] || '').slice(0, 32) || null : null;
      const tiEndpoint = product === 'intelligence' ? (seg.pop() || 'catalog').slice(0, 80) : null;
      res.once('finish', () => {
        try {
          const cred = early || credentialOf(req);
          if (!cred) return; // anonymous — never recorded
          const b = res.locals?.satelinkBilling || {};
          // The JSON-RPC body is parsed downstream, so the method is read at finish.
          const endpoint = product === 'rpc' ? String(req.body?.method || 'unknown').slice(0, 80) : tiEndpoint;
          push({
            at: new Date(start).toISOString(),
            key: b.apiKey || cred.key || null,
            wallet: cred.wallet || null,
            product,
            endpoint,
            chain,
            status: res.statusCode,
            latency: Math.max(0, now() - start),
            rail: req.x402?.settled ? 'x402' : 'credits',
            charged: Number(b.chargedUsdt) > 0 ? Number(b.chargedUsdt) : 0,
            requestId: b.requestId ? String(b.requestId).slice(0, 120) : null,
            error: res.statusCode >= 400 ? String(res.locals?.satelinkError || res.statusCode).slice(0, 64) : null,
          });
        } catch { /* never let logging affect a response */ }
      });
    }
  }

  /** Write the buffered rows in one statement. Returns rows inserted. */
  async function flush(pool) {
    if (!buffer.length) return 0;
    const rows = buffer;
    buffer = [];
    const cols = { at: [], key: [], wallet: [], product: [], endpoint: [], chain: [], status: [], latency: [], rail: [], charged: [], requestId: [], error: [] };
    for (const r of rows) for (const c of Object.keys(cols)) cols[c].push(r[c]);
    try {
      const res = await pool.query(
        `INSERT INTO request_log (created_at, api_key_id, product, endpoint, chain, http_status, latency_ms, rail, charged_usdt, request_id, error_code)
         SELECT v.at, k.id, v.product, v.endpoint, v.chain, v.status, v.latency, v.rail, v.charged, v.request_id, v.error
           FROM unnest($1::timestamptz[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::int[], $8::int[], $9::text[], $10::numeric[], $11::text[], $12::text[])
                AS v(at, key, wallet, product, endpoint, chain, status, latency, rail, charged, request_id, error)
           JOIN LATERAL (
             SELECT a.id FROM api_credits a
              WHERE (v.key IS NOT NULL AND a.api_key = v.key)
                 OR (v.key IS NULL AND v.wallet IS NOT NULL AND (a.api_key = 'x402_' || v.wallet OR lower(a.wallet_address) = v.wallet))
              ORDER BY (a.api_key = v.key) DESC NULLS LAST, a.id
              LIMIT 1
           ) k ON TRUE`,
        [cols.at, cols.key, cols.wallet, cols.product, cols.endpoint, cols.chain, cols.status, cols.latency, cols.rail, cols.charged, cols.requestId, cols.error]
      );
      counters.flushed += res.rowCount;
      counters.discarded += rows.length - res.rowCount;
      return res.rowCount;
    } catch (e) {
      counters.flushErrors += 1;
      counters.dropped += rows.length;
      throw e;
    }
  }

  return { middleware, flush, push, stats: () => ({ ...counters, pending: buffer.length }) };
}

/** Delete rows past retention, in batches; then enforce the size guard. */
export async function pruneRequestLog(pool, {
  days = Number(env('REQUEST_LOG_RETENTION_DAYS', 14)),
  maxMb = Number(env('REQUEST_LOG_MAX_MB', 512)),
  batch = 10_000,
  maxBatches = 50,
} = {}) {
  let deleted = 0;
  for (let i = 0; i < maxBatches; i++) {
    const r = await pool.query(
      `DELETE FROM request_log WHERE id IN (SELECT id FROM request_log WHERE created_at < NOW() - make_interval(days => $1) ORDER BY id LIMIT $2)`,
      [days, batch]
    );
    deleted += r.rowCount;
    if (r.rowCount < batch) break;
  }
  const size = Number((await pool.query(`SELECT pg_total_relation_size('request_log') AS b`)).rows[0].b) / 1024 / 1024;
  let guard = 0;
  if (size > maxMb) {
    const r = await pool.query(
      `DELETE FROM request_log WHERE created_at < (SELECT min(created_at) + interval '1 day' FROM request_log)`
    );
    guard = r.rowCount;
  }
  return { deleted, guardDeleted: guard, sizeMb: +size.toFixed(1) };
}

/** Start the flush + retention timers (idempotent per log). */
export function startRequestLog(pool, log, { flushMs = Number(env('REQUEST_LOG_FLUSH_MS', 2000)), pruneMs = 3_600_000, logger = console } = {}) {
  if (!requestLogEnabled()) return null;
  let missingTableWarned = false;
  const flushTimer = setInterval(() => {
    log.flush(pool).catch((e) => {
      if (e.code === '42P01') { if (!missingTableWarned) logger.warn?.('[RequestLog] table request_log missing — run migration 020; rows are dropped until then'); missingTableWarned = true; }
      else logger.error?.(`[RequestLog] flush failed: ${e.message}`);
    });
  }, flushMs);
  const pruneTimer = setInterval(() => {
    pruneRequestLog(pool).then((r) => { if (r.deleted || r.guardDeleted) logger.log?.(`[RequestLog] pruned ${r.deleted} (+${r.guardDeleted} size guard), ${r.sizeMb} MB`); })
      .catch((e) => { if (e.code !== '42P01') logger.error?.(`[RequestLog] prune failed: ${e.message}`); });
  }, pruneMs);
  flushTimer.unref?.(); pruneTimer.unref?.();
  return { stop: () => { clearInterval(flushTimer); clearInterval(pruneTimer); } };
}

export const requestLog = createRequestLog();
