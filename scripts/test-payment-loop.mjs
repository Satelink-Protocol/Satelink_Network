// scripts/test-payment-loop.mjs
// End-to-end payment-loop verifier for Satelink: deposit -> credit -> authenticated
// call -> billing -> epoch -> settlement.
//
// SCHEMA NOTE (verified against code, audit 2026-06-13 — the earlier draft of this
// script used columns that do not exist):
//   - credit balances live in `credit_balances` (wallet_address, balance_usdt, total_spent)
//     NOT a `credits` table. (apps/api/src/middleware/credit_gate.js:62-71)
//   - `revenue_events_v2` has NO wallet_address column; client_id holds the api key or
//     'public'. The RPC method is in `method` (not `rpc_method`). created_at is BIGINT
//     epoch-seconds. (apps/api/server.js:114-129, rpc_billing.js:73)
//   - `epochs` has total_revenue_usdt but NO call_count / tx_hash. Settlement tx_hash
//     lives in `epoch_ledger` and `settlement_batches`. (server.js:68-112)
//
// The real billing proof for a WALLET is a credit_balances.total_spent increase, because
// creditGate deducts there; recordRpcRevenue writes client_id='public', not the wallet.
//
// MUST be run with a DATABASE_URL that points at the PRODUCTION DB (e.g. inside Railway,
// or with a tunnel). The local .env DATABASE_URL points at 127.0.0.1 (down) — the script
// will say so rather than guess.

import pg from "pg";
try { (await import("dotenv")).default.config(); } catch { /* dotenv optional */ }

const WALLET = (process.env.TEST_WALLET || "0x966E1Ae22996545015b1414B35234b10719d7Ad4").toLowerCase();
const RPC_URL = process.env.TEST_RPC_URL || "https://rpc.satelink.network/rpc/polygon";
const THRESHOLD = parseFloat(process.env.MIN_ANCHOR_REVENUE_USDT || "0.01");
const VAULT = "0x80AFEaC3B77CbeC1f7B9f24a50319DC72785DdA3";
const USDT = "0xc2132D05D31c914a87C6611C10748AEb04B58e8F";

console.log("=== SATELINK PAYMENT LOOP TEST ===");
console.log(`Wallet:    ${WALLET}`);
console.log(`RPC:       ${RPC_URL}`);
console.log(`Threshold: ${THRESHOLD} USDT (MIN_ANCHOR_REVENUE_USDT)`);
console.log("");

if (!process.env.DATABASE_URL) {
  console.log("❌ DATABASE_URL not set. Run inside Railway (prod DB) or export a prod connection string.");
  process.exit(1);
}

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes("127.0.0.1") || process.env.DATABASE_URL.includes("localhost")
    ? false : { rejectUnauthorized: false },
  connectionTimeoutMillis: 8000,
});

// fail fast if the DB is unreachable (local .env points at a dead localhost PG)
try {
  await pool.query("SELECT 1");
} catch (e) {
  console.log(`❌ Cannot reach DATABASE_URL: ${e.message}`);
  console.log("   The local .env points at 127.0.0.1:5432 (down). Use the production DB.");
  await pool.end().catch(() => {});
  process.exit(1);
}

const num = (v) => (v == null ? null : parseFloat(v));
const fmtBigintSecs = (v) => (v ? new Date(Number(v) * 1000).toISOString().slice(11, 19) : "—");

// 1. Credit balance BEFORE
const balBefore = await pool.query(
  "SELECT balance_usdt, total_spent FROM credit_balances WHERE lower(wallet_address) = $1",
  [WALLET]
).catch((e) => ({ rows: [], _err: e.message }));

let creditedBefore = null;
let spentBefore = 0;
if (balBefore.rows.length === 0) {
  console.log("❌ WALLET NOT CREDITED — no credit_balances row.");
  console.log(`   Deposit USDT first: vault ${VAULT}`);
  console.log(`   Chain: Polygon 137 | Token: USDT ${USDT}`);
} else {
  creditedBefore = num(balBefore.rows[0].balance_usdt);
  spentBefore = num(balBefore.rows[0].total_spent) || 0;
  console.log(`✅ Credit balance (before): ${creditedBefore} USDT | total_spent: ${spentBefore} USDT`);
}

// 2. Authenticated RPC call
console.log("\nMaking authenticated RPC call (x-wallet-address)...");
let httpStatus = "network error";
let bodyText = "";
try {
  const resp = await fetch(RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-wallet-address": WALLET },
    body: JSON.stringify({ jsonrpc: "2.0", method: "eth_blockNumber", params: [], id: 1 }),
  });
  httpStatus = String(resp.status);
  bodyText = await resp.text();
  if (resp.status === 200) console.log(`✅ RPC 200: ${bodyText.slice(0, 120)}`);
  else if (resp.status === 402) console.log(`⚠️  RPC 402 Payment Required (insufficient credits): ${bodyText.slice(0, 200)}`);
  else console.log(`⚠️  RPC ${httpStatus}: ${bodyText.slice(0, 200)}`);
} catch (e) {
  console.log(`⚠️  RPC call failed: ${e.message}`);
}

// 3. Billing proof — re-read credit_balances; total_spent should rise for a credited wallet
await new Promise((r) => setTimeout(r, 700));
const balAfter = await pool.query(
  "SELECT balance_usdt, total_spent FROM credit_balances WHERE lower(wallet_address) = $1",
  [WALLET]
).catch(() => ({ rows: [] }));

if (balAfter.rows.length > 0 && creditedBefore != null) {
  const spentAfter = num(balAfter.rows[0].total_spent) || 0;
  const delta = +(spentAfter - spentBefore).toFixed(8);
  if (delta > 0) console.log(`\n✅ BILLING CONFIRMED via credit_balances: total_spent +${delta} USDT (now ${spentAfter})`);
  else console.log(`\n❌ NO DEDUCTION: total_spent unchanged (${spentAfter}). creditGate may not have charged — check x-wallet-address reached rpc_gateway.js:175.`);
} else if (httpStatus === "402") {
  console.log("\n(402 returned — wallet has no/low credits, so nothing was deducted. Deposit first.)");
}

// 3b. Observability check — confirm the audit's method/chain fix is now populating columns
const recent = await pool.query(
  `SELECT created_at, amount_usdt, method, chain, source, client_id
   FROM revenue_events_v2 ORDER BY created_at DESC LIMIT 3`
).catch(() => ({ rows: [] }));
if (recent.rows.length) {
  console.log("\nMost recent revenue_events_v2 (method/chain should be populated post-fix):");
  recent.rows.forEach((r) =>
    console.log(`   ${fmtBigintSecs(r.created_at)} | ${r.amount_usdt} USDT | method:${r.method ?? "NULL"} chain:${r.chain ?? "NULL"} src:${r.source ?? "NULL"} client:${r.client_id}`)
  );
  const anyMethod = recent.rows.some((r) => r.method);
  console.log(anyMethod ? "   ✅ method column is being written" : "   ⚠️  method still NULL (pre-fix rows, or deploy not live yet)");
}

// 4. Epoch + settlement state (tx_hash lives in epoch_ledger / settlement_batches, not epochs)
const epoch = await pool.query(
  `SELECT id, total_revenue_usdt, platform_share_usdt, status, ends_at
   FROM epochs ORDER BY id DESC LIMIT 1`
).catch(() => ({ rows: [] }));
if (epoch.rows.length) {
  const e = epoch.rows[0];
  const rev = num(e.total_revenue_usdt);
  console.log(`\nLatest epoch #${e.id} (${e.status}): revenue ${rev} USDT, platform_share ${num(e.platform_share_usdt)} USDT`);
  console.log(`  Meets ${THRESHOLD} USDT anchor threshold: ${rev >= THRESHOLD ? "✅ YES — will anchor next run" : "❌ NO — stays dust"}`);
}
const settled = await pool.query(
  `SELECT epoch_id, tx_hash, status, confirmed_at FROM settlement_batches
   WHERE tx_hash IS NOT NULL ORDER BY id DESC LIMIT 3`
).catch(() => ({ rows: [] }));
console.log(`\nOn-chain settlements recorded: ${settled.rows.length}`);
settled.rows.forEach((s) => console.log(`   epoch ${s.epoch_id} | ${s.status} | tx ${String(s.tx_hash).slice(0, 24)}...`));

// 5. Next step
console.log("\n=== NEXT STEP ===");
if (balBefore.rows.length === 0) {
  console.log("ACTION: Deposit USDT to the vault, wait for DepositListener to credit, then re-run.");
} else if (httpStatus === "402") {
  console.log("ACTION: Top up credits (402 = insufficient balance), then re-run.");
} else if (balAfter.rows.length && (num(balAfter.rows[0].total_spent) || 0) <= spentBefore) {
  console.log("ACTION: Deduction did not register — verify the client sends x-wallet-address and creditGate is in the /rpc chain.");
} else {
  console.log(`ACTION: Billing works. Settlement fires at the next 10-min anchor run once an epoch's revenue >= ${THRESHOLD} USDT.`);
  console.log("        For an immediate proof, set Railway MIN_ANCHOR_REVENUE_USDT=0.0001 and watch logs for '[SettlementAnchor] USDT TX confirmed' / 'Anchor TX confirmed'.");
}

await pool.end().catch(() => {});
