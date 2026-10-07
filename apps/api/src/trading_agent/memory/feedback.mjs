// Feedback + calibration (Phase 6 item 9).
//
//   labels       decisions whose outcome is profit or loss (flat / not_executed / pending are excluded)
//   report       per scorecard dimension: mean score on wins vs losses, separation, sample sizes
//   proposal     a NEW scorecard config version whose weights blend the current weights with the
//                observed separation — stored append-only as 'pending'; it changes NOTHING by itself
//   approval     only a server-verified staff human with a fresh step-up can approve; agents, machines
//                and the system cannot. Approval returns the new frozen config; applying it is a
//                separate, explicit deployment step.
import { SCORECARD_CONFIG } from '../decision/config.mjs';
import { DIMENSIONS } from '../decision/dimensions.mjs';

export const FEEDBACK_CONFIG = Object.freeze({ version: 'feedback/1.0', minLabeled: 30, blend: 0.5 });

/** Per-dimension predictiveness from memory rows (pure). */
export function predictivenessReport(decisionRows, cfg = FEEDBACK_CONFIG) {
  const outcome = new Map(decisionRows.filter((r) => r.entryKind === 'outcome').map((r) => [r.decisionId, r.outcome]));
  const labeled = decisionRows.filter((r) => r.entryKind === 'decision' && r.decision === 'GO' && ['profit', 'loss'].includes(outcome.get(r.decisionId)));
  const wins = labeled.filter((r) => outcome.get(r.decisionId) === 'profit');
  const losses = labeled.filter((r) => outcome.get(r.decisionId) === 'loss');
  const mean = (rows, k) => { const v = rows.map((r) => r.dimensionScores?.[k]).filter((x) => Number.isInteger(x)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  const dimensions = {};
  for (const k of DIMENSIONS) {
    const mw = mean(wins, k); const ml = mean(losses, k);
    dimensions[k] = { meanOnWins: mw == null ? null : Math.round(mw * 100) / 100, meanOnLosses: ml == null ? null : Math.round(ml * 100) / 100, separation: mw == null || ml == null ? null : Math.round((mw - ml) * 100) / 100 };
  }
  return Object.freeze({
    configVersion: cfg.version, labeled: labeled.length, wins: wins.length, losses: losses.length,
    sufficient: labeled.length >= cfg.minLabeled && wins.length > 0 && losses.length > 0, dimensions,
  });
}

/** Proposed weights: blend current weights with positive separation, integers summing to 100. */
export function proposeWeights(report, current = SCORECARD_CONFIG.weights, blend = FEEDBACK_CONFIG.blend) {
  const pos = Object.fromEntries(DIMENSIONS.map((k) => [k, Math.max(0, report.dimensions[k]?.separation ?? 0)]));
  const total = Object.values(pos).reduce((a, b) => a + b, 0);
  if (total === 0) return null; // no dimension separated wins from losses: no signal, no proposal
  const raw = Object.fromEntries(DIMENSIONS.map((k) => [k, (1 - blend) * current[k] + blend * (100 * pos[k]) / total]));
  const floor = Object.fromEntries(DIMENSIONS.map((k) => [k, Math.floor(raw[k])]));
  let rest = 100 - Object.values(floor).reduce((a, b) => a + b, 0);
  for (const k of [...DIMENSIONS].sort((a, b) => (raw[b] - floor[b]) - (raw[a] - floor[a]) || a.localeCompare(b))) { if (rest <= 0) break; floor[k] += 1; rest -= 1; }
  return Object.freeze(floor);
}

const nextVersion = (v) => { const m = /^scorecard\/(\d+)\.(\d+)$/.exec(v); return m ? `scorecard/${m[1]}.${Number(m[2]) + 1}` : `${v}+1`; };

/**
 * The feedback job: report → (maybe) a stored proposal. Never changes the live config.
 * @returns {{ status: 'insufficient_data'|'no_signal'|'proposed', report, proposal? }}
 */
export async function runFeedback({ store, idFactory, clock = () => new Date(), current = SCORECARD_CONFIG, cfg = FEEDBACK_CONFIG }) {
  const report = predictivenessReport(await store.all('decision_memory'), cfg);
  if (!report.sufficient) return Object.freeze({ status: 'insufficient_data', report });
  const weights = proposeWeights(report, current.weights, cfg.blend);
  if (!weights) return Object.freeze({ status: 'no_signal', report });
  const proposal = { id: idFactory('cal'), fromVersion: current.version, toVersion: nextVersion(current.version), weights, report, createdAt: clock().toISOString() };
  await store.append('calibration_proposals', proposal);
  return Object.freeze({ status: 'proposed', report, proposal: Object.freeze({ ...proposal, status: 'pending_human_approval' }) });
}

/**
 * Human decision on a proposal. Approval needs a staff human + a verified step-up.
 * @returns the NEW frozen scorecard config when approved (not applied anywhere by this function)
 */
export async function decideCalibration({ store, proposal, decision, actor, isStaff, stepUp, code, request, clock = () => new Date(), current = SCORECARD_CONFIG }) {
  if (!['approved', 'rejected'].includes(decision)) throw Object.assign(new Error('decision must be approved | rejected'), { code: 'INVALID' });
  if (actor?.kind !== 'human') throw Object.assign(new Error('only a human can decide a calibration'), { code: 'FORBIDDEN' });
  if (!(await isStaff(actor.principalId))) throw Object.assign(new Error('staff only'), { code: 'FORBIDDEN' });
  const v = await stepUp.verify({ principalId: actor.principalId, code, request });
  if (!v?.ok) throw Object.assign(new Error('step-up failed'), { code: 'STEP_UP_FAILED' });
  if (proposal.fromVersion !== current.version) throw Object.assign(new Error(`proposal is against ${proposal.fromVersion}, live is ${current.version}`), { code: 'CONFLICT' });
  await store.append('calibration_decisions', { proposalId: proposal.id, decision, decidedBy: actor.principalId, stepUpMethod: v.method, decidedAt: clock().toISOString() });
  if (decision === 'rejected') return null;
  if (Object.values(proposal.weights).reduce((a, b) => a + b, 0) !== 100) throw Object.assign(new Error('weights must sum to 100'), { code: 'INVALID' });
  return Object.freeze({ ...current, version: proposal.toVersion, weights: Object.freeze({ ...proposal.weights }) });
}
