// Strategy-version lifecycle state machine with guarded transitions (Stage 13).
//
//   DRAFT → BACKTESTED → PAPER → LIVE_SMALL → LIVE
//   PAPER / LIVE_SMALL / LIVE → PAUSED → (resume to the paused-from state | demote to PAPER)
//   any state except RETIRED → RETIRED (terminal)
//
// Anything not in TRANSITIONS is ILLEGAL_TRANSITION (no skipping, no going back
// except via PAUSED, nothing leaves RETIRED). A legal edge must also pass its
// guard (GUARD_FAILED): who may act (agents never), evidence bound to the
// version's content hash, and trading flags. LIVE_SMALL and LIVE need
// LIVE_TRADING, which is LOCKED in ../flags.mjs, so today no strategy can reach
// a live state. The blocker register (docs/trading-agent/BLOCKERS.md) keeps it so.
import { StrategyError } from './errors.mjs';
import { validateAgainst } from './validator.mjs';
import { isTradingFlagEnabled } from '../flags.mjs';

export const LifecycleState = Object.freeze({
  DRAFT: 'DRAFT',
  BACKTESTED: 'BACKTESTED',
  PAPER: 'PAPER',
  LIVE_SMALL: 'LIVE_SMALL',
  LIVE: 'LIVE',
  PAUSED: 'PAUSED',
  RETIRED: 'RETIRED',
});
const S = LifecycleState;

/** States in which a version is deployed (at most one version per strategy). */
export const DEPLOYED_STATES = Object.freeze([S.PAPER, S.LIVE_SMALL, S.LIVE, S.PAUSED]);

export const TRANSITIONS = Object.freeze({
  [S.DRAFT]: Object.freeze([S.BACKTESTED, S.RETIRED]),
  [S.BACKTESTED]: Object.freeze([S.PAPER, S.RETIRED]),
  [S.PAPER]: Object.freeze([S.LIVE_SMALL, S.PAUSED, S.RETIRED]),
  [S.LIVE_SMALL]: Object.freeze([S.LIVE, S.PAUSED, S.RETIRED]),
  [S.LIVE]: Object.freeze([S.PAUSED, S.RETIRED]),
  [S.PAUSED]: Object.freeze([S.PAPER, S.LIVE_SMALL, S.LIVE, S.RETIRED]), // LIVE_SMALL/LIVE only back to pausedFrom
  [S.RETIRED]: Object.freeze([]),
});

/** Minimum evidence thresholds. Changing them is a reviewed code change. */
export const LIFECYCLE_POLICY = Object.freeze({
  minBacktestBars: 500,
  minPaperDays: 14,
  minPaperTrades: 10,
  minLiveSmallDays: 30,
  minLiveSmallTrades: 20,
});

const HASH = { type: 'string', pattern: '^sha256:[0-9a-f]{64}$' };
const NOTE = { type: 'string', minLength: 1, maxLength: 500 };
const EVIDENCE_SCHEMAS = Object.freeze({
  backtest: { type: 'object', additionalProperties: false, required: ['backtestId', 'definitionHash', 'bars', 'passed'],
    properties: { backtestId: { type: 'string', pattern: '^bkt_[A-Za-z0-9]{8,64}$' }, definitionHash: HASH, bars: { type: 'integer', minimum: 1, maximum: 100_000_000 }, passed: { type: 'boolean' } } },
  approval: { type: 'object', additionalProperties: false, required: ['approvedBy', 'note'],
    properties: { approvedBy: { type: 'string', pattern: '^prn_[A-Za-z0-9_]{1,64}$' }, note: NOTE } },
  paper: { type: 'object', additionalProperties: false, required: ['paperRunId', 'definitionHash', 'days', 'trades'],
    properties: { paperRunId: { type: 'string', pattern: '^ppr_[A-Za-z0-9]{8,64}$' }, definitionHash: HASH, days: { type: 'integer', minimum: 0, maximum: 100_000 }, trades: { type: 'integer', minimum: 0, maximum: 100_000_000 } } },
  liveSmall: { type: 'object', additionalProperties: false, required: ['liveRunId', 'definitionHash', 'days', 'trades'],
    properties: { liveRunId: { type: 'string', pattern: '^lsr_[A-Za-z0-9]{8,64}$' }, definitionHash: HASH, days: { type: 'integer', minimum: 0, maximum: 100_000 }, trades: { type: 'integer', minimum: 0, maximum: 100_000_000 } } },
  mandateId: { type: 'string', pattern: '^mdt_[A-Za-z0-9_]{1,64}$' },
  reason: NOTE,
});

/** Who may make each kind of move. Principal kinds come from the principals table. */
const ACTORS = Object.freeze({
  record_backtest: ['human', 'platform'],
  promote: ['human'],
  pause: ['human', 'platform'],
  retire: ['human'],
});

/** Guard spec per edge: actor rule, required evidence keys, required flags. */
function guardFor(from, to, pausedFrom) {
  if (to === S.RETIRED) return { actors: ACTORS.retire, evidence: ['reason'], flags: [] };
  if (to === S.PAUSED) return { actors: ACTORS.pause, evidence: ['reason'], flags: [] };
  if (from === S.DRAFT && to === S.BACKTESTED) return { actors: ACTORS.record_backtest, evidence: ['backtest'], flags: [] };
  if (from === S.BACKTESTED && to === S.PAPER) return { actors: ACTORS.promote, evidence: ['approval'], flags: ['TRADING_AGENT'] };
  if (from === S.PAPER && to === S.LIVE_SMALL) return { actors: ACTORS.promote, evidence: ['approval', 'paper', 'mandateId'], flags: ['TRADING_AGENT', 'LIVE_SMALL', 'LIVE_TRADING'] };
  if (from === S.LIVE_SMALL && to === S.LIVE) return { actors: ACTORS.promote, evidence: ['approval', 'liveSmall', 'mandateId'], flags: ['TRADING_AGENT', 'LIVE_TRADING'] };
  if (from === S.PAUSED) {
    if (to === S.PAPER) return { actors: ACTORS.promote, evidence: ['approval'], flags: ['TRADING_AGENT'] };
    if (to !== pausedFrom) return null; // resume only to where it was paused from
    const flags = to === S.LIVE_SMALL ? ['TRADING_AGENT', 'LIVE_SMALL', 'LIVE_TRADING'] : ['TRADING_AGENT', 'LIVE_TRADING'];
    return { actors: ACTORS.promote, evidence: ['approval', 'mandateId'], flags };
  }
  return null;
}

export function isLegalTransition(from, to, pausedFrom = null) {
  return Boolean(TRANSITIONS[from]?.includes(to) && guardFor(from, to, pausedFrom));
}

/**
 * Check one transition. Throws ILLEGAL_TRANSITION or GUARD_FAILED (with every
 * failed condition in details.failures); returns the frozen event payload otherwise.
 * @param {{from, to, actor: {principalId, kind}, evidence, definitionHash, pausedFrom?, env?}} t
 */
export function checkTransition({ from, to, actor, evidence = {}, definitionHash, pausedFrom = null, env = {} }) {
  if (!Object.hasOwn(TRANSITIONS, from) || !Object.hasOwn(TRANSITIONS, to)) {
    throw new StrategyError('ILLEGAL_TRANSITION', `unknown lifecycle state ${!Object.hasOwn(TRANSITIONS, from) ? from : to}`);
  }
  const guard = TRANSITIONS[from].includes(to) ? guardFor(from, to, pausedFrom) : null;
  if (!guard) throw new StrategyError('ILLEGAL_TRANSITION', `${from} → ${to} is not a lifecycle transition${from === S.PAUSED ? ` (paused from ${pausedFrom})` : ''}`);

  const failures = [];
  if (!actor || typeof actor.principalId !== 'string' || !guard.actors.includes(actor.kind)) {
    failures.push(`actor kind ${JSON.stringify(actor?.kind ?? null)} may not move ${from} → ${to} (allowed: ${guard.actors.join(', ')})`);
  }
  if (evidence === null || typeof evidence !== 'object' || Array.isArray(evidence)) {
    throw new StrategyError('GUARD_FAILED', 'evidence must be an object', { failures: ['evidence must be an object'] });
  }
  for (const k of Object.keys(evidence)) if (!guard.evidence.includes(k)) failures.push(`unexpected evidence "${k}"`);
  for (const k of guard.evidence) {
    if (!Object.hasOwn(evidence, k)) { failures.push(`missing evidence "${k}"`); continue; }
    const r = validateAgainst(EVIDENCE_SCHEMAS[k], evidence[k]);
    if (!r.ok) failures.push(...r.errors.map((e) => `evidence.${k}${e.path.slice(1)}: ${e.message}`));
  }
  if (!failures.length) {
    const e = evidence;
    if (e.backtest) {
      if (e.backtest.definitionHash !== definitionHash) failures.push('backtest is for a different definition hash');
      if (e.backtest.passed !== true) failures.push('backtest did not pass');
      if (e.backtest.bars < LIFECYCLE_POLICY.minBacktestBars) failures.push(`backtest covers ${e.backtest.bars} bars (< ${LIFECYCLE_POLICY.minBacktestBars})`);
    }
    if (e.approval && e.approval.approvedBy !== actor.principalId) failures.push('approval must be given by the acting principal');
    if (e.paper) {
      if (e.paper.definitionHash !== definitionHash) failures.push('paper run is for a different definition hash');
      if (e.paper.days < LIFECYCLE_POLICY.minPaperDays) failures.push(`paper ran ${e.paper.days} days (< ${LIFECYCLE_POLICY.minPaperDays})`);
      if (e.paper.trades < LIFECYCLE_POLICY.minPaperTrades) failures.push(`paper made ${e.paper.trades} trades (< ${LIFECYCLE_POLICY.minPaperTrades})`);
    }
    if (e.liveSmall) {
      if (e.liveSmall.definitionHash !== definitionHash) failures.push('live-small run is for a different definition hash');
      if (e.liveSmall.days < LIFECYCLE_POLICY.minLiveSmallDays) failures.push(`live-small ran ${e.liveSmall.days} days (< ${LIFECYCLE_POLICY.minLiveSmallDays})`);
      if (e.liveSmall.trades < LIFECYCLE_POLICY.minLiveSmallTrades) failures.push(`live-small made ${e.liveSmall.trades} trades (< ${LIFECYCLE_POLICY.minLiveSmallTrades})`);
    }
  }
  for (const flag of guard.flags) if (!isTradingFlagEnabled(flag, env)) failures.push(`flag ${flag} is not enabled${flag === 'LIVE_TRADING' ? ' (LOCKED)' : ''}`);

  if (failures.length) throw new StrategyError('GUARD_FAILED', `${from} → ${to} refused: ${failures[0]}${failures.length > 1 ? ` (+${failures.length - 1} more)` : ''}`, { failures });
  return Object.freeze({
    from, to, definitionHash,
    pausedFrom: to === S.PAUSED ? from : null,
    evidence: JSON.parse(JSON.stringify(evidence)),
  });
}

/** Coarse projection onto strategies.status (021 CHECK: draft | active | paused | archived). */
export function statusProjection(versionStates) {
  if (versionStates.some((s) => s === S.PAPER || s === S.LIVE_SMALL || s === S.LIVE)) return 'active';
  if (versionStates.includes(S.PAUSED)) return 'paused';
  if (versionStates.length > 0 && versionStates.every((s) => s === S.RETIRED)) return 'archived';
  return 'draft';
}
