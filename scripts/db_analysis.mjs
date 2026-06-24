import pg from "pg";

// railway run injects the correct DATABASE_URL — no dotenv needed
const pool = new pg.Pool({ 
  connectionString: process.env.DATABASE_URL, 
  ssl: { rejectUnauthorized: false } 
});

const tables = await pool.query(`
  SELECT relname as t, n_live_tup as rows
  FROM pg_stat_user_tables
  WHERE relname IN ('billing_events','revenue_events_v2','epoch_ledger','credit_balances')
  ORDER BY rows DESC
`);
console.log("=== TABLE ROW COUNTS ===");
tables.rows.forEach(r => console.log(`  ${r.t.padEnd(25)} ${r.rows} rows`));

const sample = await pool.query(`SELECT * FROM billing_events ORDER BY created_at DESC LIMIT 3`)
  .catch(() => ({ rows: [] }));
console.log("\n=== BILLING_EVENTS LATEST 3 ROWS ===");
if (sample.rows.length === 0) console.log("  (empty)");
sample.rows.forEach(r => console.log(JSON.stringify(r)));

const methods = await pool.query(`
  SELECT COALESCE(method, rpc_method, chain, 'unknown') as method,
    COUNT(*) as calls, COUNT(DISTINCT client_id) as ips
  FROM billing_events
  WHERE created_at > NOW() - INTERVAL '7 days'
  GROUP BY 1 ORDER BY calls DESC LIMIT 15
`).catch(() => ({ rows: [] }));
console.log("\n=== BILLING_EVENTS METHODS (7 days) ===");
if (methods.rows.length === 0) console.log("  (empty)");
methods.rows.forEach(r => console.log(`  ${String(r.calls).padStart(8)} calls  ${r.method}`));

await pool.end();
