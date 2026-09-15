#!/usr/bin/env node
// apps/mcp-server/index.js
// Satelink MCP server (stdio transport).
//
// ONE valuable tool — `polygon_rpc` — pay-per-call Polygon (chain 137) JSON-RPC.
// The server is an x402 CLIENT of the already-deployed Satelink RPC rail: it
// forwards the JSON-RPC request to https://rpc.satelink.network/rpc/polygon and,
// when that returns 402, signs a USDC-on-Base micropayment with the operator's
// wallet (SATELINK_WALLET_PRIVATE_KEY). Production verifies + settles the
// payment and records the revenue event — no payment logic is duplicated here.
//
// Implements: tools/list, tools/call, resources/list, prompts/list.

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { buildPayingFetch } from './src/pay.mjs';
import { createRpcExecutor } from './src/rpc.mjs';
import { createIntelligenceExecutor } from './src/intelligence.mjs';
import { createSatelinkMcpServer } from './src/server-factory.mjs';

const RPC_URL = process.env.SATELINK_RPC_URL || 'https://rpc.satelink.network/rpc/polygon';

const { fetch: payingFetch, wallet, canPay } = buildPayingFetch({});
const executeRpc = createRpcExecutor({
  fetch: payingFetch,
  wallet,
  rpcUrl: RPC_URL,
  apiKey: process.env.SATELINK_API_KEY,
});
const executeIntelligence = createIntelligenceExecutor({
  fetch: payingFetch,
  apiKey: process.env.SATELINK_API_KEY,
});

const server = createSatelinkMcpServer({ executeRpc, executeIntelligence, rpcUrl: RPC_URL, wallet, canPay });

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(
    `Satelink MCP server (stdio) running — RPC=${RPC_URL} ` +
      `payment=${canPay ? `x402 wallet ${wallet}` : 'free-tier only (no wallet)'}`,
  );
}

main().catch((error) => {
  console.error('Fatal error in MCP server:', error);
  process.exit(1);
});
