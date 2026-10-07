// MCP over HTTP (Stage 24): JSON-RPC 2.0 at POST /v1/trading/mcp, behind MCP_TRADING (and
// TRADING_AGENT). Tools come from the Stage 12 ToolRegistry, so only READ and CONTROLLED (propose)
// tiers exist: execution-style names (place/submit/cancel/modify order, withdraw, transfer,
// credentials, execute_*) cannot be registered and are rejected if called. The registry factory
// receives the authenticated principal only — never a broker adapter, OMS, pool or env.
import { ToolTier } from '../agent/tool_registry.mjs';

export const MCP_PROTOCOL_VERSION = '2025-06-18';
const ALLOWED_TIERS = new Set([ToolTier.READ, ToolTier.CONTROLLED]);
const rpcError = (id, code, message) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

/**
 * @param registryFor (principal) → ToolRegistry scoped to that principal's read ports + proposal sink
 * @param runIdFactory () → 'run_…' id recorded with each call
 */
export function createMcpHandler({ registryFor, runIdFactory, serverName = 'satelink-trading', serverVersion = '1.0.0' }) {
  async function one(msg, principal) {
    if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return rpcError(msg?.id, -32600, 'invalid request');
    const notification = !Object.hasOwn(msg, 'id');
    const reply = (result) => (notification ? null : { jsonrpc: '2.0', id: msg.id, result });
    switch (msg.method) {
      case 'initialize':
        return reply({ protocolVersion: MCP_PROTOCOL_VERSION, capabilities: { tools: { listChanged: false } }, serverInfo: { name: serverName, version: serverVersion },
          instructions: 'Read Satelink trading data and create proposals for human review. This server cannot place, modify or cancel orders.' });
      case 'notifications/initialized':
      case 'ping':
        return reply({});
      case 'tools/list': {
        const reg = await registryFor(principal);
        const tools = reg.names().filter((n) => ALLOWED_TIERS.has(reg.tierOf(n))).map((n) => {
          const spec = reg.specs().find((s) => s.function.name === n).function;
          return { name: n, description: spec.description, inputSchema: spec.parameters, annotations: { readOnlyHint: reg.tierOf(n) === ToolTier.READ } };
        });
        return reply({ tools });
      }
      case 'tools/call': {
        const reg = await registryFor(principal);
        const name = String(msg.params?.name ?? '');
        if (reg.has(name) && !ALLOWED_TIERS.has(reg.tierOf(name))) return reply({ isError: true, content: [{ type: 'text', text: JSON.stringify({ error: 'FORBIDDEN_TOOL' }) }] });
        const r = await reg.invoke({ name, arguments: msg.params?.arguments ?? {} }, { principalId: principal.principalId, runId: runIdFactory() });
        if (r.status === 'ok') return reply({ isError: false, content: [{ type: 'text', text: r.wrapped }], structuredContent: r.output });
        return reply({ isError: true, content: [{ type: 'text', text: JSON.stringify({ error: r.code, message: r.message }) }] });
      }
      default:
        return notification ? null : rpcError(msg.id, -32601, `method not found: ${msg.method}`);
    }
  }

  return async (req, res) => {
    const body = req.body;
    if (Array.isArray(body)) {
      if (body.length === 0 || body.length > 20) return res.status(400).json(rpcError(null, -32600, 'batch must have 1–20 messages'));
      const out = (await Promise.all(body.map((m) => one(m, req.principal)))).filter(Boolean);
      return out.length ? res.json(out) : res.status(202).end();
    }
    const r = await one(body, req.principal);
    return r ? res.json(r) : res.status(202).end();
  };
}
