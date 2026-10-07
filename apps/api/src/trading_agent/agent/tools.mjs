// The approved tool set (Stage 12; founder-approved list, 2026-09-30).
// "Document A Part E" was not available; this list is the recorded substitute.
//
// READ tools call injected read ports; CONTROLLED tools only create proposals.
// Ports (implemented in later stages, faked in tests):
//   read.marketData   .getQuote(principalId, instrument, {purpose}) / .getCandles(...)   (Stage 11 provider)
//   read.intelligence .getMetric(metric, {symbol})
//   read.positions    .list(principalId)
//   read.orders       .list(principalId, {status, limit})
//   read.risk         .getActivePolicy(principalId)
//   read.mandates     .get(principalId, mandateId)
//   read.strategies   .get(principalId, strategyId)
//   read.accounts     .summary(principalId)                 (ledger read port)
//   proposals         .create({ principalId, runId, kind, payload }) → { proposalId, status: 'pending_review' }
import { defineTool, ToolTier } from './tool_registry.mjs';
import { DECIMAL_STRING } from './schema.mjs';

const INSTRUMENT = { type: 'string', pattern: '^([A-Z0-9]{2,15}-[A-Z0-9]{2,15}|[A-Z]{2,10}:[A-Z0-9&._-]{1,30})$' };
const ID = (prefix) => ({ type: 'string', pattern: `^${prefix}_[A-Za-z0-9_-]{3,64}$` });
const FRESHNESS = { type: 'object', additionalProperties: true, properties: { stale: { type: 'boolean' } }, required: ['stale'] };
const ANY_OBJECT = { type: 'object', additionalProperties: true };
const PROPOSAL_OUT = { type: 'object', properties: { proposalId: ID('prp'), status: { enum: ['pending_review'] } }, required: ['proposalId', 'status'] };
const obj = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required });

export const MARKET_PURPOSE = 'internal_use'; // agents never redistribute raw data

export function createDefaultTools() {
  return [
    // ── READ ──────────────────────────────────────────────────────────────
    defineTool({
      name: 'get_quote', tier: ToolTier.READ,
      description: 'Latest best bid/ask for an instrument with staleness metadata. Stale data must not be used for decisions.',
      inputSchema: obj({ instrument: INSTRUMENT }),
      outputSchema: obj({ data: ANY_OBJECT, freshness: FRESHNESS }),
      handler: async ({ instrument }, ctx) => {
        const r = await ctx.read.marketData.getQuote(ctx.principalId, instrument, { purpose: MARKET_PURPOSE });
        return { data: r.data, freshness: r.freshness };
      },
    }),
    defineTool({
      name: 'get_candles', tier: ToolTier.READ,
      description: 'OHLCV candles for an instrument and interval, with staleness of the latest candle.',
      inputSchema: obj({ instrument: INSTRUMENT, interval: { enum: ['1m', '5m', '15m', '1h', '4h', '1d'] }, limit: { type: 'integer', minimum: 1, maximum: 500 } }, ['instrument', 'interval']),
      outputSchema: obj({ data: { type: 'array', maxItems: 500, items: ANY_OBJECT }, freshness: FRESHNESS }),
      handler: async ({ instrument, interval, limit = 100 }, ctx) => {
        const r = await ctx.read.marketData.getCandles(ctx.principalId, instrument, interval, { purpose: MARKET_PURPOSE, limit });
        return { data: r.data, freshness: r.freshness };
      },
    }),
    defineTool({
      name: 'get_intelligence', tier: ToolTier.READ,
      description: 'Derived trading-intelligence metric (funding heatmap, OI shifts, liquidation clusters, microstructure). Not investment advice.',
      inputSchema: obj({ metric: { enum: ['funding-rate-heatmap', 'open-interest-shifts', 'liquidation-clusters', 'market-microstructure'] }, symbol: { type: 'string', maxLength: 20 } }, ['metric']),
      outputSchema: ANY_OBJECT,
      handler: async ({ metric, symbol }, ctx) => ctx.read.intelligence.getMetric(metric, { symbol }),
    }),
    defineTool({
      name: 'list_positions', tier: ToolTier.READ,
      description: 'Current positions for the principal (paper and live are labelled).',
      inputSchema: obj({}),
      outputSchema: obj({ positions: { type: 'array', maxItems: 500, items: ANY_OBJECT } }),
      handler: async (_a, ctx) => ({ positions: await ctx.read.positions.list(ctx.principalId) }),
    }),
    defineTool({
      name: 'list_orders', tier: ToolTier.READ,
      description: 'Recent orders and their normalized status for the principal.',
      inputSchema: obj({ status: { enum: ['open', 'closed', 'all'] }, limit: { type: 'integer', minimum: 1, maximum: 200 } }, []),
      outputSchema: obj({ orders: { type: 'array', maxItems: 200, items: ANY_OBJECT } }),
      handler: async ({ status = 'open', limit = 50 }, ctx) => ({ orders: await ctx.read.orders.list(ctx.principalId, { status, limit }) }),
    }),
    defineTool({
      name: 'get_risk_policy', tier: ToolTier.READ,
      description: 'The active risk policy (limits, allowed instruments, kill switch). Read-only.',
      inputSchema: obj({}),
      outputSchema: ANY_OBJECT,
      handler: async (_a, ctx) => ctx.read.risk.getActivePolicy(ctx.principalId),
    }),
    defineTool({
      name: 'get_mandate', tier: ToolTier.READ,
      description: 'A mandate: mode, status, limits, validity window. Read-only.',
      inputSchema: obj({ mandateId: ID('mdt') }),
      outputSchema: ANY_OBJECT,
      handler: async ({ mandateId }, ctx) => ctx.read.mandates.get(ctx.principalId, mandateId),
    }),
    defineTool({
      name: 'get_strategy', tier: ToolTier.READ,
      description: 'A strategy and its current immutable version. Read-only.',
      inputSchema: obj({ strategyId: ID('stg') }),
      outputSchema: ANY_OBJECT,
      handler: async ({ strategyId }, ctx) => ctx.read.strategies.get(ctx.principalId, strategyId),
    }),
    defineTool({
      name: 'get_account_summary', tier: ToolTier.READ,
      description: 'Balances and exposure summary from the ledger read model. Read-only.',
      inputSchema: obj({}),
      outputSchema: ANY_OBJECT,
      handler: async (_a, ctx) => ctx.read.accounts.summary(ctx.principalId),
    }),

    // ── CONTROLLED (proposal only) ───────────────────────────────────────
    defineTool({
      name: 'propose_order', tier: ToolTier.CONTROLLED,
      description: 'Propose an order intent for deterministic risk checks and human approval. Does NOT place an order.',
      inputSchema: obj({
        mandateId: ID('mdt'), instrument: INSTRUMENT, side: { enum: ['buy', 'sell'] }, type: { enum: ['market', 'limit'] },
        quantity: DECIMAL_STRING, limitPrice: DECIMAL_STRING, rationale: { type: 'string', minLength: 10, maxLength: 2000 },
      }, ['mandateId', 'instrument', 'side', 'type', 'quantity', 'rationale']),
      outputSchema: PROPOSAL_OUT,
      handler: async (a, ctx) => ctx.proposals.create({ principalId: ctx.principalId, runId: ctx.runId, kind: 'order_intent', payload: a }),
    }),
    defineTool({
      name: 'propose_cancel', tier: ToolTier.CONTROLLED,
      description: 'Propose cancelling an existing order, for human approval. Does NOT cancel anything.',
      inputSchema: obj({ orderId: ID('ord'), rationale: { type: 'string', minLength: 10, maxLength: 2000 } }),
      outputSchema: PROPOSAL_OUT,
      handler: async (a, ctx) => ctx.proposals.create({ principalId: ctx.principalId, runId: ctx.runId, kind: 'cancel_intent', payload: a }),
    }),
    defineTool({
      name: 'propose_alert', tier: ToolTier.CONTROLLED,
      description: 'Propose a price/condition alert for the user to confirm.',
      inputSchema: obj({ instrument: INSTRUMENT, condition: { enum: ['price_above', 'price_below'] }, threshold: DECIMAL_STRING, note: { type: 'string', maxLength: 500 } }, ['instrument', 'condition', 'threshold']),
      outputSchema: PROPOSAL_OUT,
      handler: async (a, ctx) => ctx.proposals.create({ principalId: ctx.principalId, runId: ctx.runId, kind: 'alert', payload: a }),
    }),
    defineTool({
      name: 'record_note', tier: ToolTier.CONTROLLED,
      description: 'Record an analysis note for the user to review.',
      inputSchema: obj({ text: { type: 'string', minLength: 1, maxLength: 4000 } }),
      outputSchema: PROPOSAL_OUT,
      handler: async (a, ctx) => ctx.proposals.create({ principalId: ctx.principalId, runId: ctx.runId, kind: 'note', payload: a }),
    }),
  ];
}
