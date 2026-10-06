// Strategy DSL v1.0: the JSON Schema (draft 2020-12) and its hard limits (Stage 13).
//
// The schema is a plain JSON Schema document, so any standard validator can read
// it. `x-decimal` is an annotation keyword that standard validators ignore and
// ./validator.mjs enforces: decimal strings with bounded range and scale.
// Every object has additionalProperties:false, so unknown fields are rejected.
//
// "Document A" (the brief's reference example) was not found in the repo; this
// v1.0 is the substitute described in docs/trading-agent/stages/13-strategy-dsl.md.

export const DSL_V1_TAG = 'satelink.strategy/1.0';

/** Structural bounds checked before and alongside the schema. */
export const DSL_V1_LIMITS = Object.freeze({
  maxBytes: 32_768,       // UTF-8 bytes of the canonical document
  maxDepth: 24,           // JSON nesting depth of the whole document
  maxConditionDepth: 8,   // nesting of all/any/not
  maxConditionNodes: 64,  // total condition + operand nodes across entry and exit
});

export const PRICE_SOURCES = Object.freeze(['open', 'high', 'low', 'close']);
export const TIMEFRAMES = Object.freeze(['1m', '5m', '15m', '1h', '4h', '1d']); // = market_data INTERVAL_MS keys
const INSTRUMENT = '^([A-Z0-9]{2,15}-[A-Z0-9]{2,15}|[A-Z]{2,10}:[A-Z0-9&._-]{1,30})$'; // = brokers/symbols.mjs
const IDENT = '^[a-z][a-z0-9_]{0,31}$';

const decimal = (xDecimal, description) => ({ type: 'string', pattern: '^-?(0|[1-9][0-9]*)(\\.[0-9]+)?$', 'x-decimal': xDecimal, ...(description ? { description } : {}) });
const int = (minimum, maximum, description) => ({ type: 'integer', minimum, maximum, ...(description ? { description } : {}) });
const indicator = (types, periodMax, withSource) => ({
  type: 'object',
  additionalProperties: false,
  required: ['type', 'period'],
  properties: {
    type: { enum: types },
    ...(withSource ? { source: { enum: PRICE_SOURCES, default: 'close' } } : {}),
    period: int(2, periodMax),
  },
});

export const DSL_V1_SCHEMA = deepFreeze({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://satelink.network/schemas/trading/strategy-dsl/1.0.json',
  title: 'Satelink strategy DSL v1.0',
  type: 'object',
  additionalProperties: false,
  required: ['dsl', 'name', 'universe', 'timeframe', 'entry', 'exit', 'position', 'risk'],
  properties: {
    dsl: { const: DSL_V1_TAG },
    name: { type: 'string', minLength: 1, maxLength: 120 },
    description: { type: 'string', maxLength: 2000, default: '' },
    universe: {
      type: 'object',
      additionalProperties: false,
      required: ['venue', 'instruments'],
      properties: {
        venue: { enum: ['binance', 'alpaca', 'upstox', 'mock'] },
        instruments: { type: 'array', minItems: 1, maxItems: 10, uniqueItems: true, items: { type: 'string', pattern: INSTRUMENT } },
      },
    },
    timeframe: { enum: TIMEFRAMES },
    indicators: {
      type: 'object',
      maxProperties: 16,
      propertyNames: { pattern: IDENT },
      additionalProperties: { $ref: '#/$defs/indicator' },
      default: {},
    },
    entry: { $ref: '#/$defs/condition' },
    exit: { $ref: '#/$defs/condition' },
    position: {
      type: 'object',
      additionalProperties: false,
      required: ['side', 'sizing'],
      properties: {
        side: { enum: ['long', 'short'] },
        sizing: {
          oneOf: [
            {
              type: 'object', additionalProperties: false, required: ['mode', 'quantity'],
              properties: { mode: { const: 'fixed_quantity' }, quantity: decimal({ min: '0', exclusiveMin: true, max: '1000000000', maxScale: 12 }) },
            },
            {
              type: 'object', additionalProperties: false, required: ['mode', 'notional', 'currency'],
              properties: {
                mode: { const: 'fixed_notional' },
                notional: decimal({ min: '0', exclusiveMin: true, max: '1000000000', maxScale: 8 }),
                currency: { enum: ['USDT', 'USDC', 'USD', 'INR'] },
              },
            },
          ],
        },
        maxOpenPositions: { ...int(1, 10), default: 1 },
      },
    },
    risk: {
      type: 'object',
      additionalProperties: false,
      required: ['stopLossPct'],
      properties: {
        stopLossPct: decimal({ min: '0.01', max: '50', maxScale: 4 }, 'mandatory stop, percent of entry price'),
        takeProfitPct: decimal({ min: '0.01', max: '1000', maxScale: 4 }),
        maxHoldingBars: int(1, 100_000),
      },
    },
    execution: {
      type: 'object',
      additionalProperties: false,
      default: {},
      properties: {
        orderType: { enum: ['market', 'limit'], default: 'market' },
        limitOffsetBps: { ...int(0, 500), default: 0 },
        cooldownBars: { ...int(0, 10_000), default: 0 },
      },
    },
  },
  $defs: {
    indicator: {
      oneOf: [
        indicator(['sma', 'ema'], 500, true),
        indicator(['rsi'], 200, true),
        indicator(['atr'], 200, false),
        indicator(['highest', 'lowest'], 500, true),
      ],
    },
    operand: {
      oneOf: [
        { type: 'object', additionalProperties: false, required: ['ind'], properties: { ind: { type: 'string', pattern: IDENT } } },
        { type: 'object', additionalProperties: false, required: ['price'], properties: { price: { enum: PRICE_SOURCES } } },
        { type: 'object', additionalProperties: false, required: ['const'], properties: { const: decimal({ min: '-1000000000000', max: '1000000000000', maxScale: 12 }) } },
      ],
    },
    comparison: {
      type: 'object', additionalProperties: false, required: ['op', 'left', 'right'],
      properties: { op: { enum: ['gt', 'gte', 'lt', 'lte'] }, left: { $ref: '#/$defs/operand' }, right: { $ref: '#/$defs/operand' } },
    },
    crossing: {
      type: 'object', additionalProperties: false, required: ['dir', 'left', 'right'],
      properties: { dir: { enum: ['above', 'below'] }, left: { $ref: '#/$defs/operand' }, right: { $ref: '#/$defs/operand' } },
    },
    condition: {
      oneOf: [
        { type: 'object', additionalProperties: false, required: ['all'], properties: { all: { type: 'array', minItems: 1, maxItems: 16, items: { $ref: '#/$defs/condition' } } } },
        { type: 'object', additionalProperties: false, required: ['any'], properties: { any: { type: 'array', minItems: 1, maxItems: 16, items: { $ref: '#/$defs/condition' } } } },
        { type: 'object', additionalProperties: false, required: ['not'], properties: { not: { $ref: '#/$defs/condition' } } },
        { type: 'object', additionalProperties: false, required: ['cmp'], properties: { cmp: { $ref: '#/$defs/comparison' } } },
        { type: 'object', additionalProperties: false, required: ['cross'], properties: { cross: { $ref: '#/$defs/crossing' } } },
      ],
    },
  },
});

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}
