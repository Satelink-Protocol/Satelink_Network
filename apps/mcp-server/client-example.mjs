#!/usr/bin/env node
// apps/mcp-server/client-example.mjs
// External paid-call demo — the "Customer Zero" script.
//
// Simulates an external user/agent making a real paid Polygon RPC call through
// Satelink's x402 rail. It uses ITS OWN Base-funded USDC wallet (never a Satelink
// wallet), so a successful settlement counts as genuine external revenue.
//
//   SATELINK_WALLET_PRIVATE_KEY=0x<base-funded-usdc-wallet> node client-example.mjs
//
// What it does:
//   1. Reports the paying wallet.
//   2. Calls polygon_rpc(eth_blockNumber) in a loop until production returns a
//      402 (free tier exhausted) — at which point @x402/fetch signs a $0.10
//      USDC-on-Base payment and retries. Production settles it, records the
//      revenue_events_v2 row, and credits the wallet a 1,000-call bundle.
//   3. Prints the settlement tx hash + remaining bundle calls (proof of a paid
//      call), then stops.
//
// This talks to the SAME code path the MCP tool uses (src/pay.mjs + src/rpc.mjs),
// so a green run here means the MCP tool will produce a paid call too.

import { buildPayingFetch } from './src/pay.mjs';
import { createRpcExecutor } from './src/rpc.mjs';

const RPC_URL = process.env.SATELINK_RPC_URL || 'https://rpc.satelink.network/rpc/polygon';
const MAX_ATTEMPTS = parseInt(process.env.DEMO_MAX_ATTEMPTS || '600', 10);

const { fetch: payingFetch, wallet, canPay } = buildPayingFetch({});
if (!canPay) {
  console.error(
    'No wallet configured. Set SATELINK_WALLET_PRIVATE_KEY to a Base-funded USDC ' +
      'wallet (NOT a Satelink/founder wallet) and re-run.',
  );
  process.exit(1);
}

const execute = createRpcExecutor({ fetch: payingFetch, wallet, rpcUrl: RPC_URL });

console.log(`Paying wallet: ${wallet}`);
console.log(`Target RPC:    ${RPC_URL}`);
console.log('Calling polygon_rpc(eth_blockNumber) until a payment settles...\n');

let attempt = 0;
while (attempt++ < MAX_ATTEMPTS) {
  const out = await execute({ method: 'eth_blockNumber', params: [] });

  if (out.ok && out.paid) {
    console.log(`\n✅ PAID CALL SETTLED on attempt ${attempt}`);
    console.log(`   block:              ${out.result?.result}`);
    console.log(`   x402 settlement:    ${out.payment_response || '(in credited body)'}`);
    console.log(`   credited:           ${JSON.stringify(out.credited)}`);
    console.log('\nVerify on-chain / in the ledger — see README "How to verify the first paid call".');
    process.exit(0);
  }

  if (!out.ok) {
    if (out.error === 'payment_required') {
      console.error('\n❌ 402 but payment did NOT complete. Check the wallet holds USDC on Base.');
      console.error(JSON.stringify(out.payment_requirements, null, 2));
      process.exit(2);
    }
    console.error(`\n❌ error on attempt ${attempt}:`, JSON.stringify(out, null, 2));
    process.exit(2);
  }

  if (attempt % 50 === 0) console.log(`  ...${attempt} free calls so far (block ${out.result?.result})`);
}

console.error(`\nReached ${MAX_ATTEMPTS} calls without a 402 — the free tier for this IP is larger than expected.`);
console.error('Raise DEMO_MAX_ATTEMPTS, or run from an IP/subnet that has already used its daily free calls.');
process.exit(3);
