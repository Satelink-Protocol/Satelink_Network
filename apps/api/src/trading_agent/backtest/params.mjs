// Simulation parameters v1 (Stage 14): validated, normalised and hashed like a strategy.
//
// The SAME parameter object drives a backtest and a paper run, so their results are
// comparable (parity). Everything that changes a result is in here, including the
// per-instrument exchange filters (Stage 10 InstrumentSpec subset), so params_hash
// + definition_hash + data_hash fully determine a backtest result.
import { SimError } from './errors.mjs';
import { validateAgainst, assertSupportedSchema } from '../strategies/validator.mjs';
import { normalize, canonicalJson, contentHash, deepFreeze } from '../strategies/canonical.mjs';

export const SIM_PARAMS_TAG = 'satelink.sim-params/1.0';
const dec = (spec) => ({ type: 'string', pattern: '^-?(0|[1-9][0-9]*)(\\.[0-9]+)?$', 'x-decimal': spec });
const int = (minimum, maximum, def) => ({ type: 'integer', minimum, maximum, ...(def === undefined ? {} : { default: def }) });

export const SIM_PARAMS_SCHEMA = deepFreeze({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'Satelink simulation parameters v1.0',
  type: 'object',
  additionalProperties: false,
  required: ['params', 'initialCash', 'quoteCurrency', 'instruments'],
  properties: {
    params: { const: SIM_PARAMS_TAG },
    initialCash: dec({ min: '0', exclusiveMin: true, max: '1000000000000', maxScale: 8 }),
    quoteCurrency: { enum: ['USDT', 'USDC', 'USD', 'INR'] },
    instruments: {
      type: 'object', minProperties: 1, maxProperties: 10,
      propertyNames: { pattern: '^([A-Z0-9]{2,15}-[A-Z0-9]{2,15}|[A-Z]{2,10}:[A-Z0-9&._-]{1,30})$' },
      additionalProperties: {
        type: 'object', additionalProperties: false, required: ['tickSize', 'lotSize', 'minQuantity', 'minNotional'],
        properties: {
          tickSize: dec({ min: '0', exclusiveMin: true, max: '1000000', maxScale: 12 }),
          lotSize: dec({ min: '0', exclusiveMin: true, max: '1000000', maxScale: 12 }),
          minQuantity: dec({ min: '0', max: '1000000000', maxScale: 12 }),
          minNotional: dec({ min: '0', max: '1000000000', maxScale: 8 }),
        },
      },
    },
    fees: {
      type: 'object', additionalProperties: false, default: {},
      properties: {
        takerBps: { ...dec({ min: '0', max: '1000', maxScale: 4 }), default: '10' },
        makerBps: { ...dec({ min: '-100', max: '1000', maxScale: 4 }), default: '10' }, // negative = rebate
      },
    },
    slippageBps: { ...dec({ min: '0', max: '1000', maxScale: 4 }), default: '5' },
    latencyMs: int(0, 86_400_000, 0),
    partialFills: {
      type: 'object', additionalProperties: false, default: {},
      properties: {
        maxParticipationPct: { ...dec({ min: '0', exclusiveMin: true, max: '100', maxScale: 4 }), default: '10' },
        maxBarsToFill: int(1, 1000, 3),
      },
    },
    rejectRateBps: int(0, 10_000, 0),
    seed: int(0, 2_147_483_647, 1),
    windowBars: int(50, 5000, 500),
    holidays: { type: 'array', maxItems: 400, uniqueItems: true, items: { type: 'string', pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' }, default: [] },
    passCriteria: {
      type: 'object', additionalProperties: false, default: {},
      properties: {
        minTrades: int(0, 100_000, 1),
        maxDrawdownPct: { ...dec({ min: '0', max: '100', maxScale: 4 }), default: '50' },
      },
    },
  },
});
assertSupportedSchema(SIM_PARAMS_SCHEMA);

/**
 * Validate + normalise + hash simulation params against a strategy definition.
 * @returns frozen { params, canonical, hash }
 */
export function defineSimParams(raw, definition) {
  const first = validateAgainst(SIM_PARAMS_SCHEMA, raw);
  if (!first.ok) throw new SimError('CONFIG', first.errors.slice(0, 3).map((e) => `${e.path}: ${e.message}`).join('; '), { errors: first.errors });
  const params = normalize(SIM_PARAMS_SCHEMA, raw);
  if (definition) {
    const missing = definition.universe.instruments.filter((i) => !Object.hasOwn(params.instruments, i));
    if (missing.length) throw new SimError('CONFIG', `no instrument filters for ${missing.join(', ')}`);
    const sizing = definition.position.sizing;
    if (sizing.mode === 'fixed_notional' && sizing.currency !== params.quoteCurrency) {
      throw new SimError('CONFIG', `strategy sizes in ${sizing.currency} but the simulation is in ${params.quoteCurrency}`);
    }
  }
  const canonical = canonicalJson(params);
  return deepFreeze({ params: deepFreeze(params), canonical, hash: contentHash(canonical) });
}
