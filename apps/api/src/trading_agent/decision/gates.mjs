// Hard gates (Phase 6 item 6). ANY failed gate → REJECT, whatever the score. Gates:
//   risk:<check>          — the Stage 15 risk engine's 20 checks, reused unchanged (evaluateChecks)
//   kill_switch           — any engaged switch that covers the order (also check 1, stated explicitly)
//   stale_data            — data confidence freshness lost, or regime 'uncertain' from low confidence
//   broker_unavailable    — broker health not 'ok'
//   insufficient_liquidity / abnormal_spread — liquidity engine flags
//   mandate_expired       — mandate missing, not active, or past expiry
//   validation_expired    — walk-forward / stress missing or older than validationMaxAgeMs
//   concentration         — portfolio-fit engine verdict (Phase 6 item 7); fails CLOSED when no assessment
import { evaluateChecks, Decision } from '../risk/evaluate.mjs';
import { activeKillSwitchesFor } from '../risk/kill_switch.mjs';

export const GATES = Object.freeze(['risk', 'kill_switch', 'stale_data', 'broker_unavailable', 'insufficient_liquidity', 'abnormal_spread', 'mandate_expired', 'validation_expired', 'concentration']);

export function evaluateGates(i, cfg, now) {
  const failed = [];
  const fail = (gate, detail) => failed.push(Object.freeze({ gate, detail }));
  let riskResult = null;
  if (!i.order || !i.riskContext) fail('risk', 'no order intent / risk context: the risk engine cannot run');
  else {
    riskResult = evaluateChecks(i.order, i.riskContext);
    if (riskResult.decision !== Decision.APPROVE) fail(`risk:${riskResult.failed?.id ?? 'unknown'}`, `${riskResult.failed?.code ?? 'REJECT'}: ${riskResult.failed?.detail ?? ''}`.slice(0, 300));
  }
  const ks = i.order && Array.isArray(i.riskContext?.killSwitchEvents)
    ? activeKillSwitchesFor(i.riskContext.killSwitchEvents, { ...i.order, strategyId: i.riskContext.strategy?.strategyId ?? null })
    : null;
  if (ks === null) fail('kill_switch', 'kill-switch state unknown (fail closed)');
  else if (ks.length > 0) fail('kill_switch', `${ks[0].scopeType} kill switch engaged`);
  if (!i.dataConfidence || i.dataConfidence.parts?.freshness === 0) fail('stale_data', 'newest market data is stale or missing');
  if (i.broker?.status !== 'ok') fail('broker_unavailable', `broker status ${i.broker?.status ?? 'unknown'}`);
  const lf = i.liquidity?.flags ?? null;
  if (!lf) fail('insufficient_liquidity', 'no liquidity assessment');
  else {
    if (lf.includes('insufficient_liquidity')) fail('insufficient_liquidity', 'book cannot absorb the order within limits');
    if (lf.includes('abnormal_spread')) fail('abnormal_spread', `spread ${i.liquidity.spreadBps} bps`);
  }
  const m = i.riskContext?.mandate; // the SAME mandate object the risk engine checks (validUntil: epoch ms)
  const until = typeof m?.validUntil === 'number' ? m.validUntil : Date.parse(m?.validUntil ?? '');
  if (!m || m.status !== 'active' || !Number.isFinite(until) || until <= now.getTime()) fail('mandate_expired', m ? `mandate ${m.status}, valid until ${Number.isFinite(until) ? new Date(until).toISOString() : 'unknown'}` : 'no mandate');
  for (const [name, v] of [['walk_forward', i.walkForward], ['stress', i.stress]]) {
    const at = i.validationTimes?.[name];
    if (!v || !at) fail('validation_expired', `${name} missing`);
    else if (now.getTime() - Date.parse(at) > cfg.validationMaxAgeMs) fail('validation_expired', `${name} computed ${at}`);
  }
  const conc = i.portfolioFit?.concentration;
  if (!conc) fail('concentration', 'no portfolio-fit assessment (the portfolio check cannot be skipped)');
  else if (conc.verdict !== 'pass') fail('concentration', `${conc.flags.join(', ')}: instrument ${conc.instrumentPct}% / gross ${conc.grossExposurePct}% of equity`);
  return Object.freeze({ failed: Object.freeze(failed), riskResult });
}
