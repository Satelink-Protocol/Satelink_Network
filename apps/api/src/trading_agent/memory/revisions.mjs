// Strategy improvement (Phase 6 item 9). An improvement is ALWAYS a new version v(n+1) created
// through the Stage 13 StrategyService: it starts at DRAFT and must pass BACKTESTED → PAPER → … with
// evidence bound to its own content hash before it can trade. The running version is never edited
// (strategy_versions is append-only; StrategyService has no update path).
export async function proposeStrategyRevision({ strategies, memory, actor, strategyId, fromVersionId, dsl, reason }) {
  const from = await strategies.getVersion(fromVersionId);
  if (!from || from.strategyId !== strategyId) throw Object.assign(new Error('unknown version for this strategy'), { code: 'NOT_FOUND' });
  const v = await strategies.createVersion({ actor, strategyId, dsl });
  if (!v.created) throw Object.assign(new Error('the revision is identical to an existing version'), { code: 'NO_CHANGE' });
  await memory.recordStrategyEvidence({ strategyVersionId: v.id, kind: 'revision', metrics: { revisionOf: fromVersionId, reason: String(reason ?? '').slice(0, 300) } });
  return Object.freeze({ versionId: v.id, version: v.version, definitionHash: v.definitionHash, state: 'DRAFT', revisionOf: fromVersionId, mustRevalidate: true });
}
