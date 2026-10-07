// Mandate terms v1 (Stage 16): the canonical document a user signs.
//
// The server fills lineageId / version / supersedes / principalId / venue / nonce; the
// user supplies the rest. Terms are validated (unknown fields rejected, bounded values),
// normalised (defaults, canonical decimals, ISO-8601 UTC ms timestamps) and hashed with
// the same RFC 8785 canonical JSON + sha256 as strategies. The nonce is inside the hash,
// so a signature binds to exactly one proposal.
//
// Modes ("Document A" is not in the repo; documented substitute):
//   A  copilot     — every order needs the owner's per-order approval     (021 mode 'copilot')
//   B  automated   — a bound, lifecycle-approved deterministic strategy executes
//                    within these terms without per-order approval        (021 mode 'automated')
//   C  autonomous  — agent-originated orders without per-order approval;  (021 mode 'automated')
//                    refused while AUTONOMOUS_MODE is LOCKED
import { MandateError } from './errors.mjs';
import { validateAgainst, assertSupportedSchema } from '../strategies/validator.mjs';
import { normalize, canonicalJson, contentHash, deepFreeze } from '../strategies/canonical.mjs';

export const MANDATE_TERMS_TAG = 'satelink.mandate/1.0';
export const MandateMode = Object.freeze({ A: 'A', B: 'B', C: 'C' });
export const MODE_TO_021 = Object.freeze({ A: 'copilot', B: 'automated', C: 'automated' });

const MINOR = { type: 'string', pattern: '^(0|[1-9][0-9]{0,37})$' };
const ISO = { type: 'string', pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]{1,3})?Z$' };
const ID = (p) => ({ type: 'string', pattern: `^${p}_[A-Za-z0-9_]{1,64}$` });

export const MANDATE_TERMS_SCHEMA = deepFreeze({
  type: 'object', additionalProperties: false,
  required: ['schema', 'lineageId', 'version', 'supersedes', 'principalId', 'brokerAccountId', 'venue', 'environment', 'mode', 'strategy', 'instruments', 'limits', 'validFrom', 'validUntil', 'nonce'],
  properties: {
    schema: { const: MANDATE_TERMS_TAG },
    lineageId: { type: 'string', pattern: '^mdl_[A-Za-z0-9]{8,64}$' },
    version: { type: 'integer', minimum: 1, maximum: 10_000 },
    supersedes: { oneOf: [ID('mdt'), { type: 'null' }] },
    principalId: ID('prn'),
    brokerAccountId: ID('bka'),
    venue: { enum: ['binance', 'alpaca', 'upstox', 'mock'] },
    environment: { enum: ['paper', 'live'] },
    mode: { enum: ['A', 'B', 'C'] },
    strategy: {
      oneOf: [
        { type: 'null' },
        { type: 'object', additionalProperties: false, required: ['strategyId', 'versionId', 'definitionHash'],
          properties: { strategyId: ID('stg'), versionId: ID('stv'), definitionHash: { type: 'string', pattern: '^sha256:[0-9a-f]{64}$' } } },
      ],
    },
    instruments: { type: 'array', minItems: 1, maxItems: 50, uniqueItems: true, items: { type: 'string', pattern: '^([A-Z0-9]{2,15}-[A-Z0-9]{2,15}|[A-Z]{2,10}:[A-Z0-9&._-]{1,30})$' } },
    limits: {
      type: 'object', additionalProperties: false, required: ['currency', 'decimals', 'maxOrderNotionalMinor', 'maxDailyNotionalMinor'],
      properties: { currency: { enum: ['USDT', 'USDC', 'USD', 'INR'] }, decimals: { type: 'integer', minimum: 0, maximum: 18 }, maxOrderNotionalMinor: MINOR, maxDailyNotionalMinor: MINOR },
    },
    validFrom: ISO,
    validUntil: ISO,
    nonce: { type: 'string', pattern: '^[0-9a-f]{32}$' },
  },
});
assertSupportedSchema(MANDATE_TERMS_SCHEMA);

/** The fields a user may set in a draft (everything else is server-assigned). */
export const DRAFT_FIELDS = Object.freeze(['brokerAccountId', 'environment', 'mode', 'strategy', 'instruments', 'limits', 'validFrom', 'validUntil']);

/**
 * Validate + normalise + hash full terms.
 * @returns frozen { terms, canonical, hash }
 */
export function defineTerms(raw, { maxValidityMs }) {
  const r = validateAgainst(MANDATE_TERMS_SCHEMA, raw);
  if (!r.ok) throw new MandateError('INVALID', r.errors.slice(0, 3).map((e) => `${e.path}: ${e.message}`).join('; '), { errors: r.errors });
  const terms = normalize(MANDATE_TERMS_SCHEMA, raw);
  for (const k of ['validFrom', 'validUntil']) {
    const t = Date.parse(terms[k]);
    if (!Number.isFinite(t)) throw new MandateError('INVALID', `${k} is not a valid timestamp`);
    terms[k] = new Date(t).toISOString();
  }
  const from = Date.parse(terms.validFrom);
  const until = Date.parse(terms.validUntil);
  if (until <= from) throw new MandateError('INVALID', 'validUntil must be after validFrom');
  if (until - from > maxValidityMs) throw new MandateError('INVALID', `validity window exceeds ${Math.round(maxValidityMs / 86_400_000)} days`);
  if (BigInt(terms.limits.maxDailyNotionalMinor) < BigInt(terms.limits.maxOrderNotionalMinor)) throw new MandateError('INVALID', 'maxDailyNotionalMinor must be ≥ maxOrderNotionalMinor');
  if (terms.mode === 'B' && !terms.strategy) throw new MandateError('INVALID', 'mode B binds a deterministic strategy version');
  if (terms.mode === 'A' && terms.strategy === undefined) throw new MandateError('INVALID', 'strategy must be null or a binding');
  if ((terms.version === 1) !== (terms.supersedes === null)) throw new MandateError('INVALID', 'only version 1 has no predecessor');
  const canonical = canonicalJson(terms);
  return deepFreeze({ terms: deepFreeze(terms), canonical, hash: contentHash(canonical) });
}

export const hashTerms = (terms) => contentHash(canonicalJson(terms));
