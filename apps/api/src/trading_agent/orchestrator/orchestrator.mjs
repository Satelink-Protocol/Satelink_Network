// AI orchestrator (Phase 6 item 8). The reasoning backbone that routes a task to ONLY the agents it
// needs, feeds them READ-tool data as wrapped untrusted text, and turns their work into a proposal +
// a decision request to the scorecard. It NEVER produces an order and has no path to the OMS or a
// broker. Numbers come only from the deterministic engines; the scorecard decides.
//
//   challenger rule: for a NEW strategy a GO stands only if the challenger ran and did not raise a
//   blocking objection — otherwise the recommendation is WAIT. The challenger can only downgrade.
import { AGENTS, TASK_AGENTS, SHARED_RULES } from './agents.mjs';
import { renderUntrusted, wrapUntrusted } from '../agent/untrusted.mjs';
import { ToolTier } from '../agent/tool_registry.mjs';
import { AgentError } from '../agent/errors.mjs';

export class Orchestrator {
  #tools; #router; #recorder; #decisions; #build; #parseStrategy; #ids;

  /**
   * @param deps.tools            Stage 12 ToolRegistry (READ tools used; CONTROLLED never)
   * @param deps.router           TieredModelRouter (item 3)
   * @param deps.recorder         TraceRecorder (one run per task, one trace id)
   * @param deps.decisions        DecisionService (item 6) — the ONLY decider
   * @param deps.buildDecisionInput async (task, { strategy }) → scorecard input built by the deterministic engines
   * @param deps.parseStrategy    (dsl) → parsed strategy (Stage 13 parseStrategyDsl; throws on invalid)
   */
  constructor({ tools, router, recorder, decisions, buildDecisionInput, parseStrategy, idFactory }) {
    if (!tools || !router?.complete || !recorder || !decisions?.evaluate || typeof buildDecisionInput !== 'function' || typeof parseStrategy !== 'function' || typeof idFactory !== 'function') {
      throw new AgentError('CONFIG', 'Orchestrator needs tools, router, recorder, decisions, buildDecisionInput, parseStrategy and idFactory');
    }
    for (const [name, a] of Object.entries(AGENTS)) {
      for (const t of a.tools) {
        if (!tools.has(t)) throw new AgentError('CONFIG', `agent ${name}: unknown tool ${t}`);
        if (tools.tierOf(t) !== ToolTier.READ) throw new AgentError('BOUNDARY_VIOLATION', `agent ${name}: tool ${t} is not READ-tier`);
      }
    }
    this.#tools = tools; this.#router = router; this.#recorder = recorder; this.#decisions = decisions;
    this.#build = buildDecisionInput; this.#parseStrategy = parseStrategy; this.#ids = idFactory;
  }

  /** Pure routing: the agents a task needs, in order. */
  plan(task) {
    const agents = TASK_AGENTS[task?.kind];
    if (!agents) throw new AgentError('ROUTE_NOT_FOUND', `unknown task kind ${task?.kind}`);
    return Object.freeze({ kind: task.kind, agents });
  }

  async #toolData(agent, task, scope) {
    const out = [];
    for (const name of AGENTS[agent].tools) {
      const args = argsFor(name, task);
      if (!args) continue;
      const r = await this.#tools.invoke({ name, arguments: args }, scope);
      await this.#recorder.toolCall(scope.runId, r);
      out.push(r.wrapped);
    }
    return out;
  }

  async #runAgent(agent, task, scope, extra = []) {
    const a = AGENTS[agent];
    const data = [...await this.#toolData(agent, task, scope), ...extra];
    const messages = [
      { role: 'system', content: `${a.role}\n\n${SHARED_RULES}` },
      { role: 'user', content: [`Task: ${task.kind}`, `Intent: ${JSON.stringify(task.intent ?? {})}`, ...data.map(renderUntrusted)].join('\n\n') },
    ];
    try {
      const output = await this.#router.complete({ taskType: a.taskType, messages, schema: a.schema, runId: scope.runId, recorder: this.#recorder, attribution: { opportunityId: task.opportunityId ?? null, strategyId: task.strategyId ?? null, machineRequestId: task.machineRequestId ?? null } });
      return { agent, status: 'ok', output };
    } catch (e) {
      return { agent, status: 'failed', error: e.code ?? 'ERROR' };
    }
  }

  /**
   * @param task { kind, principalId, intent?, instrument?, opportunityId?, strategyId?, machineRequestId?, dsl? }
   * @returns { traceId, plan, proposal, decisionRequest, decision, recommendation, agents } — never an order
   */
  async run(task) {
    const plan = this.plan(task);
    const runId = await this.#recorder.startRun({ principalId: task.principalId, goal: `${task.kind}${task.instrument ? ` ${task.instrument}` : ''}` });
    const scope = { principalId: task.principalId, runId };
    const agents = {};
    let strategy = null;
    try {
      if (task.kind === 'propose_strategy') {
        const drafted = await this.#runAgent('strategy', task, scope);
        agents.strategy = drafted;
        if (drafted.status !== 'ok') return this.#finish(runId, { plan, agents, status: 'agent_failed', recommendation: 'WAIT' });
        try {
          strategy = this.#parseStrategy(drafted.output.dsl);
        } catch (e) {
          return this.#finish(runId, { plan, agents, status: 'invalid_strategy', recommendation: 'REJECT', detail: String(e.code ?? e.message).slice(0, 200) });
        }
      } else {
        for (const name of plan.agents) agents[name] = await this.#runAgent(name, task, scope);
      }

      const decisionRequest = await this.#build(task, { strategy });
      const decision = await this.#decisions.evaluate(decisionRequest);

      let recommendation = decision.decision;
      const notes = [];
      if (task.kind === 'propose_strategy') {
        const evidence = wrapUntrusted('scorecard', { decision: decision.decision, score: decision.score, confidence: decision.confidence, failed_gates: decision.failed_gates, dsl: drafted(agents) });
        agents.challenger = await this.#runAgent('challenger', task, scope, [evidence]);
        const ch = agents.challenger;
        const blocking = ch.status !== 'ok' || ch.output.verdict !== 'accept' || ch.output.objections.some((o) => o.severity === 'blocking');
        if (recommendation === 'GO' && blocking) { recommendation = 'WAIT'; notes.push(ch.status !== 'ok' ? 'challenger_unavailable' : 'challenger_objection'); }
      }
      return this.#finish(runId, {
        plan, agents, status: 'ok', recommendation, notes,
        proposal: Object.freeze({ kind: task.kind === 'propose_strategy' ? 'strategy' : 'opportunity', principalId: task.principalId, instrument: task.instrument ?? null, opportunityId: task.opportunityId ?? null, strategyDefinitionHash: strategy?.hash ?? null }),
        decisionRequest: Object.freeze({ decisionId: decision.id, inputHash: decision.input_hash }),
        decision,
      });
    } catch (e) {
      return this.#finish(runId, { plan, agents, status: 'failed', recommendation: 'REJECT', detail: String(e.code ?? e.message).slice(0, 200) });
    }
  }

  async #finish(runId, result) {
    const traceId = runId;
    await this.#recorder.finishRun(runId, { status: result.status === 'ok' ? 'completed' : 'failed', stepCount: Object.keys(result.agents ?? {}).length, finalOutput: result.recommendation });
    return Object.freeze({ traceId, ...result });
  }
}

const drafted = (agents) => (agents.strategy?.status === 'ok' ? agents.strategy.output.dsl : null);

/** READ-tool arguments derived from the task (never from model output). */
function argsFor(tool, task) {
  switch (tool) {
    case 'get_quote': return task.instrument ? { instrument: task.instrument } : null;
    case 'get_intelligence': return task.instrument ? { metric: 'market-microstructure', symbol: task.instrument.replace(/[^A-Z0-9]/g, '').slice(0, 20) } : null;
    case 'get_candles': return task.instrument ? { instrument: task.instrument, interval: '1h', limit: 100 } : null;
    case 'get_risk_policy': case 'get_account_summary': case 'list_positions': case 'list_orders': return {};
    case 'get_mandate': return task.mandateId ? { mandateId: task.mandateId } : null;
    default: return null;
  }
}
