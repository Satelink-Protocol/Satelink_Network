// Tool registry (Stage 12): the ONLY surface a model can act through.
//
// Tiers:
//   READ        — reads through injected read-only ports; no side effects.
//   CONTROLLED  — writes a PROPOSAL (data) through a proposal sink; never executes.
//                 Deterministic policy (risk/mandates) + human approval decide later.
// There is no EXECUTE tier. Execution-style tool names (place/submit/cancel/modify
// orders, withdraw, transfer, credentials, execute_*) cannot even be registered,
// and a model's attempt to call one is rejected and traced, with no side effect.
//
// Capability scoping: a READ handler receives only { read } ports; a CONTROLLED
// handler receives only { read, proposals }. No handler ever receives a broker
// adapter, credential loader, DB pool, Redis client or env.
import { AgentError } from './errors.mjs';
import { assertSchema, assertValid } from './schema.mjs';
import { wrapUntrusted } from './untrusted.mjs';

export const ToolTier = Object.freeze({ READ: 'READ', CONTROLLED: 'CONTROLLED' });

const TOOL_NAME_RE = /^[a-z][a-z0-9_]{2,48}$/;

/** Names (and name shapes) that can never be registered or invoked. */
export const FORBIDDEN_TOOL_PATTERNS = Object.freeze([
  /^(place|submit|send|create|execute|modify|amend|replace|cancel)_?(an_)?(market_|limit_)?order(s)?$/,
  /order_(place|submit|send|execute|cancel|modify)/,
  /^execute(_|$)/,
  /(withdraw|transfer|payout|settle|deposit|sweep|send_funds|send_crypto)/,
  /(credential|api_key|apikey|secret|private[_]key|seed|mnemonic|password)/,
  /^(set|update|disable|override)_(risk|mandate|kill_switch|limit)/,
  /(shell|exec_command|run_sql|sql_query|eval|http_request|fetch_url)/,
]);

export function isForbiddenToolName(name) {
  const n = String(name).toLowerCase();
  return FORBIDDEN_TOOL_PATTERNS.some((re) => re.test(n));
}

/** Validate and freeze a tool definition. */
export function defineTool({ name, tier, description, inputSchema, outputSchema, handler }) {
  if (typeof name !== 'string' || !TOOL_NAME_RE.test(name)) throw new AgentError('CONFIG', `invalid tool name ${name}`);
  if (isForbiddenToolName(name)) throw new AgentError('FORBIDDEN_TOOL', `tool "${name}" is forbidden and cannot be registered`);
  if (!Object.values(ToolTier).includes(tier)) throw new AgentError('CONFIG', `tool ${name}: unknown tier ${tier}`);
  if (typeof description !== 'string' || description.length < 10) throw new AgentError('CONFIG', `tool ${name}: description required`);
  if (typeof handler !== 'function') throw new AgentError('CONFIG', `tool ${name}: handler required`);
  assertSchema(inputSchema, `${name}.input`);
  assertSchema(outputSchema, `${name}.output`);
  if (inputSchema.type !== 'object') throw new AgentError('CONFIG', `tool ${name}: input schema must be an object`);
  return Object.freeze({ name, tier, description, inputSchema, outputSchema, handler });
}

export class ToolRegistry {
  #tools = new Map();
  #read;
  #proposals;

  /**
   * @param {object} deps
   * @param {object} deps.read       read-only ports (market data, positions, …)
   * @param {{create:Function}} deps.proposals  proposal sink (the only write capability)
   */
  constructor({ read, proposals }) {
    if (!read || typeof read !== 'object') throw new AgentError('CONFIG', 'read ports required');
    if (!proposals || typeof proposals.create !== 'function') throw new AgentError('CONFIG', 'proposal sink required');
    this.#read = Object.freeze({ ...read });
    this.#proposals = Object.freeze({ create: (...a) => proposals.create(...a) });
  }

  register(tool) {
    const t = tool?.handler && Object.isFrozen(tool) ? tool : defineTool(tool);
    if (isForbiddenToolName(t.name)) throw new AgentError('FORBIDDEN_TOOL', `tool "${t.name}" is forbidden`);
    if (this.#tools.has(t.name)) throw new AgentError('CONFIG', `duplicate tool ${t.name}`);
    this.#tools.set(t.name, t);
    return this;
  }

  has(name) { return this.#tools.has(name); }
  names() { return [...this.#tools.keys()].sort(); }

  /** Model-facing specs (OpenAI-compatible function shape). No handler, no ports. */
  specs() {
    return this.names().map((n) => {
      const t = this.#tools.get(n);
      return { type: 'function', function: { name: t.name, description: `[${t.tier}] ${t.description}`, parameters: t.inputSchema } };
    });
  }

  tierOf(name) { return this.#tools.get(name)?.tier ?? null; }

  /**
   * Invoke a model-requested tool call. Never throws for model-caused problems:
   * returns { status: 'rejected' | 'error' | 'ok', … } so the runner can trace it
   * and feed a (wrapped) error back to the model.
   * @param {{name:string, arguments:any}} call
   * @param {{principalId:string, runId:string}} scope
   */
  async invoke(call, scope) {
    const name = String(call?.name ?? '');
    if (isForbiddenToolName(name)) return reject(name, 'FORBIDDEN_TOOL', `tool "${name}" is forbidden; the agent can only read data and create proposals`);
    const tool = this.#tools.get(name);
    if (!tool) return reject(name, 'UNKNOWN_TOOL', `unknown tool "${name}"`);

    let args = call.arguments;
    if (typeof args === 'string') {
      try { args = JSON.parse(args); } catch { return reject(name, 'SCHEMA_INVALID', 'arguments are not valid JSON', tool.tier); }
    }
    try { assertValid(tool.inputSchema, args ?? {}, `${name} input`); }
    catch (e) { return reject(name, 'SCHEMA_INVALID', e.message, tool.tier); }

    const ctx = tool.tier === ToolTier.READ
      ? Object.freeze({ read: this.#read, principalId: scope.principalId, runId: scope.runId })
      : Object.freeze({ read: this.#read, proposals: this.#proposals, principalId: scope.principalId, runId: scope.runId });

    let output;
    try { output = await tool.handler(args ?? {}, ctx); }
    catch (e) { return { status: 'error', name, tier: tool.tier, code: e.code || 'TOOL_FAILED', message: e.message, input: args, wrapped: wrapUntrusted(name, { error: e.code || 'TOOL_FAILED' }) }; }

    try { assertValid(tool.outputSchema, output, `${name} output`); }
    catch (e) { return { status: 'error', name, tier: tool.tier, code: 'SCHEMA_INVALID', message: e.message, input: args, wrapped: wrapUntrusted(name, { error: 'SCHEMA_INVALID' }) }; }

    return { status: 'ok', name, tier: tool.tier, input: args, output, wrapped: wrapUntrusted(name, output) };
  }
}

function reject(name, code, message, tier = null) {
  return { status: 'rejected', name, tier, code, message, input: null, wrapped: wrapUntrusted('tool_registry', { rejected: name, code }) };
}
