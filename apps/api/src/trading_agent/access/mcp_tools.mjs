// MCP tools for agents (Phase 6 item 11): evaluate_opportunity, propose_strategy, get_receipt.
// Registered in the Stage 12 ToolRegistry like every other tool, so the forbidden-name lint and the
// READ / CONTROLLED tiers still apply. There is still no placeOrder and no withdraw.
import { defineTool, ToolTier } from '../agent/tool_registry.mjs';

const obj = (properties, required = Object.keys(properties)) => ({ type: 'object', additionalProperties: false, properties, required });
const INSTRUMENT = { type: 'string', pattern: '^([A-Z0-9]{2,15}-[A-Z0-9]{2,15}|[A-Z]{2,10}:[A-Z0-9&._-]{1,30})$' };
const ANY = { type: 'object', additionalProperties: true };

export function createMachineTools() {
  return [
    defineTool({
      name: 'evaluate_opportunity', tier: ToolTier.CONTROLLED,
      description: 'Evaluate a trading opportunity through Satelink\'s engines and scorecard. Returns GO / WAIT / REJECT with score, confidence, failed gates and evidence. Never places an order.',
      inputSchema: obj({ instrument: INSTRUMENT, mandateId: { type: 'string', pattern: '^mdt_[A-Za-z0-9_-]{3,64}$' }, opportunityId: { type: 'string', maxLength: 80 } }, ['instrument']),
      outputSchema: ANY,
      handler: async (args, ctx) => ctx.read.machine.evaluate(ctx.principalId, args, ctx.runId),
    }),
    defineTool({
      name: 'propose_strategy', tier: ToolTier.CONTROLLED,
      description: 'Propose a strategy (Satelink Strategy DSL) for human review. It is validated, backtested and challenged before anything can run.',
      inputSchema: obj({ dsl: ANY, rationale: { type: 'string', minLength: 10, maxLength: 2000 } }),
      outputSchema: obj({ proposalId: { type: 'string' }, status: { type: 'string' } }),
      handler: async (args, ctx) => ctx.proposals.create({ kind: 'strategy', principalId: ctx.principalId, dsl: args.dsl, rationale: args.rationale }),
    }),
    defineTool({
      name: 'get_receipt', tier: ToolTier.READ,
      description: 'Read a persisted decision receipt (why Satelink said GO, WAIT or REJECT).',
      inputSchema: obj({ receiptId: { type: 'string', pattern: '^dec_[A-Za-z0-9_-]{3,64}$' } }),
      outputSchema: ANY,
      handler: async (args, ctx) => ctx.read.machine.receipt(ctx.principalId, args.receiptId, ctx.runId),
    }),
  ];
}
