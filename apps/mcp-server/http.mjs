#!/usr/bin/env node
// apps/mcp-server/http.mjs
// Satelink MCP server — HTTP transport.
//
//   POST /execute   REST alias for the single tool (mission STEP 6):
//                     { "method": "eth_blockNumber", "params": [] }
//                   → pays via x402 when required, returns the JSON-RPC result
//                     plus paid/settlement metadata.
//   POST /mcp       MCP Streamable HTTP transport (stateless) — tools/list,
//                   tools/call, resources/list, prompts/list.
//   GET  /healthz   liveness + wallet/payment status.
//   GET  /.well-known/mcp.json   discovery metadata.
//
// Same reuse story as the stdio server: this process is an x402 CLIENT of the
// production Satelink rail. Payment validation, settlement, and revenue
// recording all happen in apps/api (already deployed) — nothing here duplicates
// them.

import express from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { buildPayingFetch } from './src/pay.mjs';
import { createRpcExecutor } from './src/rpc.mjs';
import { createIntelligenceExecutor, INTELLIGENCE_ENDPOINTS } from './src/intelligence.mjs';
import { createSatelinkMcpServer } from './src/server-factory.mjs';

const PORT = parseInt(process.env.PORT || '8402', 10);
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

const app = express();
app.use(express.json({ limit: '1mb' }));

// ── POST /execute — REST paid-call endpoint ───────────────────────────────────
app.post('/execute', async (req, res) => {
  const { method, params } = req.body || {};
  const out = await executeRpc({ method, params });
  // 402 → payment was required and could not be completed.
  if (!out.ok && out.error === 'payment_required') return res.status(402).json(out);
  if (!out.ok) return res.status(out.status && out.status >= 400 ? out.status : 400).json(out);
  return res.status(200).json(out);
});

// ── GET /execute/intelligence/:tool — REST alias for the M7/T-11 tools ────────
app.get('/execute/intelligence/:tool', async (req, res) => {
  if (!INTELLIGENCE_ENDPOINTS[req.params.tool]) {
    return res.status(404).json({ ok: false, error: 'unknown_tool', known: Object.keys(INTELLIGENCE_ENDPOINTS) });
  }
  const out = await executeIntelligence({ tool: req.params.tool, symbol: req.query.symbol });
  if (!out.ok && out.error === 'not_yet_available') return res.status(404).json(out);
  if (!out.ok && out.error === 'payment_required') return res.status(402).json(out);
  if (!out.ok) return res.status(out.status && out.status >= 400 ? out.status : 400).json(out);
  return res.status(200).json(out);
});

// ── GET /healthz ──────────────────────────────────────────────────────────────
app.get('/healthz', (_req, res) => {
  res.json({
    ok: true,
    service: 'satelink-mcp',
    version: '2.0.0',
    rpc_url: RPC_URL,
    payment: canPay ? 'x402-enabled' : 'free-tier-only',
    paying_wallet: wallet || null,
  });
});

// ── GET /.well-known/mcp.json — discovery metadata ────────────────────────────
app.get('/.well-known/mcp.json', (_req, res) => {
  res.json({
    name: 'satelink-mcp',
    version: '2.0.0',
    description: 'Pay-per-call Polygon (chain 137) JSON-RPC over MCP, settled via x402 (USDC on Base).',
    transport: { streamable_http: '/mcp', rest_execute: '/execute' },
    pricing: { unit: '$0.10 USDC per 1,000 calls', rail: 'x402', network: 'eip155:8453 (Base)' },
    tools: ['polygon_rpc'],
  });
});

// ── POST /mcp — MCP Streamable HTTP (stateless: new server+transport per req) ──
// sessionIdGenerator: undefined + enableJsonResponse → each request is fully
// independent (no session handshake required to persist), which is what a
// per-request server/transport pair needs.
app.post('/mcp', async (req, res) => {
  const server = createSatelinkMcpServer({ executeRpc, executeIntelligence, rpcUrl: RPC_URL, wallet, canPay });
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  res.on('close', () => {
    transport.close();
    server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: err.message }, id: null });
    }
  }
});

app.listen(PORT, () => {
  console.error(
    `Satelink MCP HTTP server on :${PORT} — POST /execute, POST /mcp — ` +
      `payment=${canPay ? `x402 wallet ${wallet}` : 'free-tier only'}`,
  );
});
