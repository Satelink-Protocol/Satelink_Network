// Kill switches (Stage 15): scoped, append-only events; latest event per scope wins.
//
// Scopes, broadest first (also the order in which an active switch is reported):
//   global · principal · broker_account · mandate · strategy · venue · instrument
// An event with principalId = null is platform-wide (admin / system only); otherwise it
// applies to that principal's orders only. A narrower release never overrides a broader
// engage: every scope that matches the order is checked independently.
import { RiskError } from './errors.mjs';

export const KILL_SWITCH_SCOPES = Object.freeze(['global', 'principal', 'broker_account', 'mandate', 'strategy', 'venue', 'instrument']);
export const KillSwitchSource = Object.freeze({ USER: 'user', ADMIN: 'admin', CIRCUIT_BREAKER: 'circuit_breaker', SYSTEM: 'system' });

const keyOf = (e) => `${e.scopeType}|${e.scopeId ?? ''}|${e.principalId ?? ''}`;

/** Latest event per (scope, id, principal) → the engaged ones. Events need a monotonically ordered `seq`. */
export function engagedSwitches(events) {
  const latest = new Map();
  for (const e of [...events].sort((a, b) => a.seq - b.seq)) latest.set(keyOf(e), e);
  return [...latest.values()].filter((e) => e.action === 'engage');
}

/** The value of the order field each scope compares against. */
function orderValue(scopeType, order) {
  switch (scopeType) {
    case 'principal': return order.principalId;
    case 'broker_account': return order.brokerAccountId;
    case 'mandate': return order.mandateId;
    case 'strategy': return order.strategyId;
    case 'venue': return order.venue;
    case 'instrument': return order.instrument;
    default: return undefined;
  }
}

/**
 * Engaged switches that stop this order, broadest scope first.
 * @param order { principalId, brokerAccountId, mandateId, strategyId|null, venue, instrument }
 */
export function activeKillSwitchesFor(events, order) {
  return engagedSwitches(events)
    .filter((e) => e.principalId === null || e.principalId === order.principalId)
    .filter((e) => e.scopeType === 'global' || (e.scopeId !== null && e.scopeId === orderValue(e.scopeType, order)))
    .sort((a, b) => KILL_SWITCH_SCOPES.indexOf(a.scopeType) - KILL_SWITCH_SCOPES.indexOf(b.scopeType));
}

/**
 * Who may engage / release. Engaging is a safety action (any human, admin or the system);
 * releasing re-enables trading and is narrower. Agents can do neither.
 * @param actor { principalId, kind: 'human'|'agent'|'platform'|…, role?: 'user'|'admin' }
 */
export function assertKillSwitchPermission(actor, action, target, current = null) {
  const deny = (why) => { throw new RiskError('FORBIDDEN', why); };
  if (!actor || typeof actor.principalId !== 'string') deny('actor required');
  if (!KILL_SWITCH_SCOPES.includes(target.scopeType)) throw new RiskError('INVALID', `unknown scope ${target.scopeType}`);
  if (target.scopeType === 'global' && target.principalId !== null) throw new RiskError('INVALID', 'a global switch is platform-wide (principalId must be null)');
  if (target.scopeType !== 'global' && !target.scopeId) throw new RiskError('INVALID', `${target.scopeType} switch needs a scopeId`);
  if (target.scopeType === 'principal' && target.principalId !== null && target.scopeId !== target.principalId) throw new RiskError('INVALID', 'principal scope must match its principal');
  const admin = actor.kind === 'human' && actor.role === 'admin';
  const owner = actor.kind === 'human' && actor.role === 'user' && target.principalId !== null && actor.principalId === target.principalId;
  if (actor.kind === 'agent') deny('agents can never engage or release kill switches');
  if (action === 'engage') {
    if (admin || owner) return admin ? KillSwitchSource.ADMIN : KillSwitchSource.USER;
    if (actor.kind === 'platform') return KillSwitchSource.SYSTEM;
    return deny('only the owner, an admin or the system may engage this switch');
  }
  if (action === 'release') {
    if (admin) return KillSwitchSource.ADMIN;
    if (!owner) return deny('only the owner or an admin may release this switch');
    if (current && current.source === KillSwitchSource.ADMIN) return deny('a switch engaged by an admin can only be released by an admin');
    return KillSwitchSource.USER;
  }
  throw new RiskError('INVALID', `unknown action ${action}`);
}
