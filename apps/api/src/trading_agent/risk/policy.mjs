// Risk policy versioning (Stage 15).
//
// A policy is an immutable version (risk_policies row + 025 columns); "editing" creates
// version n+1. Who may author a version:
//   * the owning user (human, role 'user'): every limit within their PLAN caps (injected port);
//   * an admin (human, role 'admin'): within the platform HARD caps;
//   * agents (and any other kind): never.
// New policies default kill_switch = true (021: halted until explicitly cleared).
import { RiskError } from './errors.mjs';
import { validateAgainst, assertSupportedSchema } from '../strategies/validator.mjs';
import { normalize, canonicalJson, contentHash, deepFreeze } from '../strategies/canonical.mjs';
import { compareDecimal } from '../brokers/decimal.mjs';

const MINOR = { type: 'string', pattern: '^(0|[1-9][0-9]{0,37})$' };
const int = (minimum, maximum, def) => ({ type: 'integer', minimum, maximum, ...(def === undefined ? {} : { default: def }) });

export const POLICY_SCHEMA = deepFreeze({
  type: 'object', additionalProperties: false,
  required: ['currency', 'decimals', 'maxOrderNotionalMinor', 'maxDailyNotionalMinor', 'maxDailyLossMinor', 'allowedInstruments'],
  properties: {
    currency: { enum: ['USDT', 'USDC', 'USD', 'INR'] },
    decimals: int(0, 18),
    maxOrderNotionalMinor: MINOR,
    maxDailyNotionalMinor: MINOR,
    maxDailyLossMinor: MINOR,
    maxLeverage: { type: 'string', pattern: '^(0|[1-9][0-9]*)(\\.[0-9]+)?$', 'x-decimal': { min: '1', max: '100', maxScale: 4 }, default: '1' },
    maxOpenPositions: int(0, 1000, 1),
    allowedInstruments: { type: 'array', maxItems: 200, uniqueItems: true, items: { type: 'string', pattern: '^([A-Z0-9]{2,15}-[A-Z0-9]{2,15}|[A-Z]{2,10}:[A-Z0-9&._-]{1,30})$' } },
    killSwitch: { type: 'boolean', default: true },
    limits: {
      type: 'object', additionalProperties: false, default: {},
      properties: {
        maxPositionNotionalMinor: { ...MINOR, default: '0' },
        maxPriceDeviationBps: int(1, 5000, 100),
        maxQuoteAgeMs: int(100, 600_000, 5000),
        maxOrdersPerMinute: int(1, 600, 10),
        maxOrdersPerDay: int(1, 100_000, 200),
        duplicateWindowMs: int(0, 3_600_000, 2000),
        allowShort: { type: 'boolean', default: false },
        breakers: {
          type: 'object', additionalProperties: false, default: {},
          properties: { maxConsecutiveLosses: int(1, 100, 5), maxConsecutiveRejects: int(1, 1000, 10), maxBrokerErrors: int(1, 1000, 5) },
        },
      },
    },
  },
});
assertSupportedSchema(POLICY_SCHEMA);

/** Platform hard caps: nobody, admins included, can exceed these. */
export const HARD_CAPS = Object.freeze({ maxLeverage: '10', maxOpenPositions: 100, maxOrdersPerMinute: 120, maxOrdersPerDay: 20_000 });

/** Validate + normalise (defaults) + hash a policy draft. */
export function definePolicy(draft) {
  const r = validateAgainst(POLICY_SCHEMA, draft);
  if (!r.ok) throw new RiskError('INVALID', r.errors.slice(0, 3).map((e) => `${e.path}: ${e.message}`).join('; '), { errors: r.errors });
  const policy = normalize(POLICY_SCHEMA, draft);
  return deepFreeze({ policy: deepFreeze(policy), hash: contentHash(canonicalJson(policy)) });
}

/** Every violated cap, as messages. Notional caps compare as bigints, leverage as decimals. */
export function capViolations(p, caps) {
  const out = [];
  const big = (k) => caps[k] !== undefined && BigInt(p[k]) > BigInt(caps[k]) && out.push(`${k} ${p[k]} > cap ${caps[k]}`);
  big('maxOrderNotionalMinor'); big('maxDailyNotionalMinor'); big('maxDailyLossMinor');
  if (caps.maxPositionNotionalMinor !== undefined && BigInt(p.limits.maxPositionNotionalMinor) > BigInt(caps.maxPositionNotionalMinor)) out.push(`limits.maxPositionNotionalMinor > cap ${caps.maxPositionNotionalMinor}`);
  if (caps.maxLeverage !== undefined && compareDecimal(p.maxLeverage, caps.maxLeverage) > 0) out.push(`maxLeverage ${p.maxLeverage} > cap ${caps.maxLeverage}`);
  for (const k of ['maxOpenPositions']) if (caps[k] !== undefined && p[k] > caps[k]) out.push(`${k} ${p[k]} > cap ${caps[k]}`);
  for (const k of ['maxOrdersPerMinute', 'maxOrdersPerDay']) if (caps[k] !== undefined && p.limits[k] > caps[k]) out.push(`limits.${k} ${p.limits[k]} > cap ${caps[k]}`);
  if (caps.allowShort === false && p.limits.allowShort) out.push('limits.allowShort not permitted by cap');
  if (caps.currency !== undefined && caps.currency !== p.currency) out.push(`currency ${p.currency} ≠ plan currency ${caps.currency}`);
  return out;
}

const PRN_RE = /^prn_[A-Za-z0-9_]{1,64}$/;

/**
 * @param {{store, planCaps: (principalId) => Promise<caps>, clock?, idFactory}} deps
 */
export class RiskPolicyService {
  #store; #planCaps; #clock; #ids;
  constructor({ store, planCaps, clock = () => new Date(), idFactory }) {
    if (!store || typeof planCaps !== 'function' || typeof idFactory !== 'function') throw new RiskError('CONFIG', 'RiskPolicyService needs store, planCaps and idFactory');
    this.#store = store; this.#planCaps = planCaps; this.#clock = clock; this.#ids = idFactory;
  }

  async createVersion({ actor, principalId, mandateId = null, draft }) {
    if (!actor || actor.kind !== 'human' || !PRN_RE.test(actor.principalId ?? '')) throw new RiskError('FORBIDDEN', 'risk policies can only be edited by a human user or admin; never by an agent');
    const isAdmin = actor.role === 'admin';
    if (!isAdmin && (actor.role !== 'user' || actor.principalId !== principalId)) throw new RiskError('FORBIDDEN', 'users may only edit their own risk policy');
    const { policy, hash } = definePolicy(draft);
    const hard = capViolations(policy, HARD_CAPS);
    if (hard.length) throw new RiskError('CAP_EXCEEDED', `above platform hard caps: ${hard.join('; ')}`, { violations: hard });
    if (!isAdmin) {
      const caps = await this.#planCaps(principalId);
      if (!caps) throw new RiskError('CAP_EXCEEDED', 'no plan caps for this principal (fail closed)');
      const v = capViolations(policy, caps);
      if (v.length) throw new RiskError('CAP_EXCEEDED', `above plan caps: ${v.join('; ')}`, { violations: v });
    }
    return this.#store.withPolicyLock(principalId, mandateId, async (tx) => {
      const latest = await tx.latestPolicy(principalId, mandateId);
      const row = {
        id: this.#ids('rsk'), principalId, mandateId, version: (latest?.version ?? 0) + 1, policy, policyHash: hash,
        createdBy: actor.principalId, createdByRole: isAdmin ? 'admin' : 'user', at: this.#clock(),
      };
      await tx.insertPolicy(row);
      return Object.freeze({ id: row.id, version: row.version, policyHash: hash });
    });
  }

  /** Mandate-specific policy if one exists, else the principal-level policy, else null (→ REJECT). */
  async activePolicy(principalId, mandateId) {
    return (mandateId ? await this.#store.latestPolicy(principalId, mandateId) : null) ?? this.#store.latestPolicy(principalId, null);
  }
}
