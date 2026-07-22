// x402 funnel evidence harness (Task 5). Boots the REAL x402 middleware + REAL
// free_tier_gate offline (redis=null -> in-memory counters; mock pool -> anonymous
// caller) with FREE_TIER_DAILY_LIMIT=3, and drives one IP past the limit.
//
// Two scenarios (the difference is the whole audit finding):
//   A. facilitator reachable+authed  -> the 4th call returns a PAYABLE x402 402
//      (accepts in the PAYMENT-REQUIRED header, USDT preserved as alternativePayment).
//   B. facilitator unreachable/401   -> the upgrade FAILS OPEN to the legacy USDT
//      402 (this is exactly the audit's "USDT on exhaustion" finding; the fix is
//      valid CDP_API_KEY_*, not code).
//
// No prod DB, no redis, no real CDP keys, no external network. Env MUST be set
// before importing free_tier_gate (FREE_TIER_LIMIT is a module-load const), so
// imports are dynamic. Run: node apps/api/scripts/x402_funnel_harness.mjs
import http from 'node:http';

process.env.X402_ENABLED = 'true';
process.env.FREE_TIER_DAILY_LIMIT = '3';
process.env.SUBNET_FREE_LIMIT = '100';

// Embedded facilitator mock: the SDK's getSupported hits GET /supported and
// expects { kinds:[{x402Version,scheme,network}] }. Scenario A points at this.
const facMock = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/supported') {
    res.setHeader('content-type', 'application/json');
    return res.end(JSON.stringify({ kinds: [{ x402Version: 2, scheme: 'exact', network: 'eip155:8453' }] }));
  }
  res.statusCode = 404; res.end('{}');
});
await new Promise((r) => facMock.listen(0, r));
const facPort = facMock.address().port;

const express = (await import('express')).default;
const { createFreeTierGate } = await import('../src/middleware/free_tier_gate.js');

const quiet = { log() {}, info() {}, warn() {}, error() {}, debug() {} };
const mockPool = { query: async () => ({ rows: [] }) }; // anonymous, no credits, telemetry no-op

async function runScenario(label, facilitatorUrl, IP) {
  process.env.X402_FACILITATOR_URL = facilitatorUrl;
  // Fresh module graph per scenario so the x402 server rebuilds with this URL and
  // the gate's in-memory counter starts clean.
  const { createX402Middleware } = await import(`../src/payments/x402/middleware.js?scn=${encodeURIComponent(label)}`);
  const x402Middleware = createX402Middleware(mockPool, quiet);
  const freeTierGate = createFreeTierGate(quiet, null, mockPool);
  const gateUnlessPaid = (req, res, next) => (req.x402?.settled ? next() : freeTierGate(req, res, next));
  const app = express();
  app.use('/rpc', x402Middleware, gateUnlessPaid, express.json({ limit: '1mb' }), (req, res) =>
    res.json({ jsonrpc: '2.0', id: req.body?.id ?? 1, result: '0x56775ef' })
  );
  const srv = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const port = srv.address().port;

  async function call(n) {
    const res = await fetch(`http://127.0.0.1:${port}/rpc/polygon`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': IP, accept: 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_blockNumber', params: [], id: n }),
    });
    const pr = res.headers.get('payment-required');
    const text = await res.text();
    let note;
    if (res.status === 200) note = `free 200 served`;
    else if (res.status === 402 && pr) {
      const d = JSON.parse(Buffer.from(pr, 'base64').toString('utf8'));
      const a = (d.accepts && d.accepts[0]) || {};
      const alt = (() => { try { return !!JSON.parse(text).alternativePayment; } catch { return false; } })();
      note = `x402 402  PAYMENT-REQUIRED accepts=[scheme=${a.scheme} network=${a.network} amount=${a.amount} asset=${(a.asset || '').slice(0, 12)}… payTo=${(a.payTo || '').slice(0, 12)}…]  alternativePayment(USDT)=${alt}`;
    } else if (res.status === 402) {
      note = `LEGACY 402 (no PAYMENT-REQUIRED header) — body=${text.slice(0, 70)}`;
    } else note = `HTTP ${res.status} ${text.slice(0, 60)}`;
    console.log(`  call ${n}: HTTP ${res.status}  ${note}`);
    return { status: res.status, pr };
  }

  console.log(`\n[${label}] FREE_TIER_DAILY_LIMIT=3, X402_ENABLED=true, facilitator=${facilitatorUrl}`);
  for (let i = 1; i <= 3; i++) await call(i);
  const c4 = await call(4);
  srv.close();
  return c4;
}

console.log('=== x402 funnel evidence harness ===');
const a4 = await runScenario('A: facilitator reachable+authed', `http://127.0.0.1:${facPort}`, '203.0.113.7');
const b4 = await runScenario('B: facilitator unreachable', 'http://127.0.0.1:1', '198.51.100.9'); // connection refused -> fail-open

facMock.close();
const aPass = a4.status === 402 && !!a4.pr;                 // payable x402 402
const bFailOpen = b4.status === 402 && !b4.pr;              // legacy USDT (audit finding)
console.log(`\nRESULT: scenario A payable-x402-402=${aPass ? 'PASS' : 'FAIL'}; scenario B fail-open-to-USDT=${bFailOpen ? 'CONFIRMED' : 'no'} (root cause of the audit finding).`);
process.exit(aPass ? 0 : 1);
