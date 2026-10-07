import { expect } from 'chai';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AnthropicProvider, ScriptedProvider, ProviderError, TieredModelRouter, Tier, TASK_TIER, tierFor, DEFAULT_TIER_ROUTES,
  PRICES, costOf, TraceRecorder, InMemoryTraceStore, COST_DIMENSIONS,
} from '../src/trading_agent/agent/index.mjs';

// Phase 6 item 3 — Anthropic provider, tiered router, per-call cost metering. No network.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');

/** Fake of the SDK default export: same constructor contract and typed error classes. */
function fakeSdk(handler) {
  class APIError extends Error { constructor(status, m) { super(m); this.status = status; } }
  class RateLimitError extends APIError { constructor() { super(429, 'rl'); } }
  class InternalServerError extends APIError { constructor(s = 500) { super(s, 'ise'); } }
  class BadRequestError extends APIError { constructor() { super(400, 'bad'); } }
  class AuthenticationError extends APIError { constructor() { super(401, 'auth'); } }
  class APIConnectionError extends Error {}
  class APIConnectionTimeoutError extends APIConnectionError {}
  const calls = [];
  class Anthropic {
    static APIError = APIError; static RateLimitError = RateLimitError; static InternalServerError = InternalServerError;
    static BadRequestError = BadRequestError; static AuthenticationError = AuthenticationError;
    static APIConnectionError = APIConnectionError; static APIConnectionTimeoutError = APIConnectionTimeoutError;
    constructor(opts) { this.opts = opts; Anthropic.last = opts; }
    messages = { create: async (p) => { calls.push({ beta: false, p }); return handler(p, Anthropic); } };
    beta = { messages: { create: async (p) => { calls.push({ beta: true, p }); return handler(p, Anthropic); } } };
  }
  return { Anthropic, calls };
}
const msg = (content, o = {}) => ({ id: 'msg', model: o.model ?? 'claude-sonnet-5', content, stop_reason: o.stop ?? 'end_turn', stop_details: o.details ?? null, usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: o.cacheRead ?? 0, cache_creation_input_tokens: 0 } });
const code = async (fn) => { try { await fn(); } catch (e) { return e.code; } return null; };

describe('trading: AI provider + tiered model router + cost metering', () => {
  describe('AnthropicProvider', () => {
    it('needs an injected key and the SDK class; passes the key explicitly (never env)', async () => {
      const { Anthropic } = fakeSdk(() => msg([]));
      expect(await code(() => new AnthropicProvider({ Anthropic }))).to.equal('PROVIDER_ERROR');
      expect(await code(() => new AnthropicProvider({ apiKey: 'sk-test-12345678' }))).to.equal('PROVIDER_ERROR');
      new AnthropicProvider({ apiKey: 'sk-test-12345678', Anthropic });
      expect(Anthropic.last.apiKey).to.equal('sk-test-12345678');
      const src = fs.readFileSync(path.join(ROOT, 'apps/api/src/trading_agent/agent/providers/anthropic.mjs'), 'utf8');
      expect(src).to.not.match(/process\.env|import\(/);
    });

    it('translates OpenAI-style runtime messages: system, tool calls, tool results (merged into one user turn)', () => {
      const { Anthropic } = fakeSdk(() => msg([]));
      const p = new AnthropicProvider({ apiKey: 'sk-test-12345678', Anthropic });
      const out = p.toMessagesApi([
        { role: 'system', content: 'rules' }, { role: 'user', content: 'q' },
        { role: 'assistant', content: 'checking', tool_calls: [{ id: 't1', function: { name: 'get_quote', arguments: '{"s":"BTC"}' } }, { id: 't2', function: { name: 'list_positions', arguments: '{}' } }] },
        { role: 'tool', tool_call_id: 't1', content: 'a' }, { role: 'tool', tool_call_id: 't2', content: 'b' },
      ]);
      expect(out.system).to.equal('rules');
      expect(out.messages.map((m) => [m.role, m.content.map((b) => b.type)])).to.deep.equal([
        ['user', ['text']], ['assistant', ['text', 'tool_use', 'tool_use']], ['user', ['tool_result', 'tool_result']],
      ]);
      expect(out.messages[1].content[1].input).to.deep.equal({ s: 'BTC' });
    });

    it('replays a produced assistant turn verbatim (thinking blocks included)', async () => {
      const { Anthropic, calls } = fakeSdk((p) => (p.messages.length === 1
        ? msg([{ type: 'thinking', thinking: '', signature: 's1' }, { type: 'tool_use', id: 'tu1', name: 'get_quote', input: { s: 'ETH' } }], { stop: 'tool_use' })
        : msg([{ type: 'text', text: 'done' }])));
      const p = new AnthropicProvider({ apiKey: 'sk-test-12345678', Anthropic });
      const r1 = await p.chat([{ role: 'user', content: 'q' }], { model: 'claude-sonnet-5' });
      expect(r1.toolCalls).to.deep.equal([{ id: 'tu1', name: 'get_quote', arguments: '{"s":"ETH"}' }]);
      await p.chat([{ role: 'user', content: 'q' }, { role: 'assistant', content: '', tool_calls: [{ id: 'tu1', function: { name: 'get_quote', arguments: '{"s":"ETH"}' } }] }, { role: 'tool', tool_call_id: 'tu1', content: 'x' }], { model: 'claude-sonnet-5' });
      expect(calls[1].p.messages[1].content.map((b) => b.type)).to.deep.equal(['thinking', 'tool_use']);
      expect(calls[1].p.messages[1].content[0].signature).to.equal('s1');
    });

    it('claude-opus-5 opts into server-side refusal fallbacks; other models use the plain endpoint', async () => {
      const { Anthropic, calls } = fakeSdk((p) => msg([{ type: 'text', text: 'ok' }], { model: p.model }));
      const p = new AnthropicProvider({ apiKey: 'sk-test-12345678', Anthropic });
      await p.chat([{ role: 'user', content: 'x' }], { model: 'claude-opus-5', effort: 'high' });
      await p.chat([{ role: 'user', content: 'x' }], { model: 'claude-haiku-4-5' });
      expect(calls[0]).to.deep.include({ beta: true });
      expect(calls[0].p).to.include({ fallbacks: 'default' });
      expect(calls[0].p.betas).to.deep.equal(['server-side-fallback-2026-07-01']);
      expect(calls[0].p.output_config).to.deep.equal({ effort: 'high' });
      expect(calls[1].beta).to.equal(false);
    });

    it('a refusal is a non-retryable REFUSED error, never an empty answer', async () => {
      const { Anthropic } = fakeSdk(() => msg([], { stop: 'refusal', details: { category: 'cyber' } }));
      const p = new AnthropicProvider({ apiKey: 'sk-test-12345678', Anthropic });
      try { await p.chat([{ role: 'user', content: 'x' }], { model: 'claude-sonnet-5' }); expect.fail('should throw'); } catch (e) {
        expect(e).to.be.instanceOf(ProviderError); expect(e.code).to.equal('REFUSED'); expect(e.retryable).to.equal(false);
      }
    });

    for (const [name, mk, retryable] of [
      ['429', (A) => new A.RateLimitError(), true], ['500', (A) => new A.InternalServerError(500), true], ['529 overloaded', (A) => new A.APIError(529, 'o'), true],
      ['connection', (A) => new A.APIConnectionError('c'), true], ['timeout', (A) => new A.APIConnectionTimeoutError('t'), true],
      ['400', (A) => new A.BadRequestError(), false], ['401', (A) => new A.AuthenticationError(), false],
    ]) {
      it(`maps SDK ${name} → retryable=${retryable} via typed classes`, async () => {
        const { Anthropic } = fakeSdk((_p, A) => { throw mk(A); });
        const p = new AnthropicProvider({ apiKey: 'sk-test-12345678', Anthropic });
        try { await p.chat([{ role: 'user', content: 'x' }], { model: 'claude-sonnet-5' }); expect.fail('should throw'); } catch (e) {
          expect(e).to.be.instanceOf(ProviderError); expect(e.retryable).to.equal(retryable);
        }
      });
    }

    it('structured output uses native json_schema AND is re-validated with Satelink\'s schema', async () => {
      const schema = { type: 'object', properties: { decision: { type: 'string', enum: ['GO', 'WAIT', 'REJECT'] } }, required: ['decision'], additionalProperties: false };
      let text = '{"decision":"WAIT"}';
      const { Anthropic, calls } = fakeSdk(() => msg([{ type: 'text', text }]));
      const p = new AnthropicProvider({ apiKey: 'sk-test-12345678', Anthropic });
      expect(await p.structuredOutput([{ role: 'user', content: 'x' }], schema, { model: 'claude-sonnet-5' })).to.deep.equal({ decision: 'WAIT' });
      expect(calls[0].p.output_config.format).to.deep.equal({ type: 'json_schema', schema });
      text = '{"decision":"BUY"}';
      expect(await code(() => p.structuredOutput([{ role: 'user', content: 'x' }], schema, { model: 'claude-sonnet-5' }))).to.equal('SCHEMA_INVALID');
      text = 'not json';
      expect(await code(() => p.structuredOutput([{ role: 'user', content: 'x' }], schema, { model: 'claude-sonnet-5' }))).to.equal('SCHEMA_INVALID');
    });
  });

  describe('tiers (routing by task type)', () => {
    it('every task type maps to a known tier; prices/balances/P&L/risk/order state are deterministic', () => {
      for (const t of Object.values(TASK_TIER)) expect(Object.values(Tier)).to.include(t);
      for (const t of ['price_lookup', 'balance_lookup', 'pnl_lookup', 'risk_check', 'order_state']) expect(tierFor(t)).to.equal(Tier.DETERMINISTIC);
      expect(tierFor('challenger_review')).to.equal(Tier.DEEP);
      expect(() => tierFor('nope')).to.throw(/unknown task type/);
    });

    it('a deterministic task is refused and NO provider is called', async () => {
      const prov = new ScriptedProvider({ id: 'anthropic', script: [{ content: '42' }] });
      const r = new TieredModelRouter({ providers: { anthropic: prov, groq: prov } });
      expect(await code(() => r.complete({ taskType: 'pnl_lookup', messages: [{ role: 'user', content: 'what is my P&L' }] }))).to.equal('DETERMINISTIC_ONLY');
      expect(prov.calls).to.have.length(0);
      expect(r.plan('pnl_lookup')).to.deep.equal({ taskType: 'pnl_lookup', tier: 'deterministic', chain: null });
    });

    it('the route depends on the task type only (attribution / user never changes it)', () => {
      const prov = new ScriptedProvider({ id: 'x' });
      const r = new TieredModelRouter({ providers: { anthropic: prov, groq: prov } });
      expect(r.plan('draft_strategy').chain).to.deep.equal(DEFAULT_TIER_ROUTES.standard);
      expect(r.plan('classify_intent').chain[0]).to.deep.equal({ provider: 'anthropic', model: 'claude-haiku-4-5' });
      expect(r.plan('challenger_review').chain[0]).to.deep.equal({ provider: 'anthropic', model: 'claude-opus-5' });
      expect(() => new TieredModelRouter({ providers: { anthropic: prov }, routes: { chat: [{ provider: 'anthropic', model: 'm' }] } })).to.throw(/not an LLM tier/);
    });
  });

  describe('cost', () => {
    it('micro-USD is exact integer arithmetic from the versioned price table', () => {
      expect(costOf('claude-opus-5', { inputTokens: 1_000_000, outputTokens: 0 })).to.deep.include({ priced: true, costUsdMicro: 5_000_000n });
      expect(costOf('claude-sonnet-5', { inputTokens: 100, outputTokens: 20 }).costUsdMicro).to.equal(400n); // 100×2 + 20×10
      expect(costOf('claude-haiku-4-5', { cacheReadInputTokens: 1000 }).costUsdMicro).to.equal(100n); // 0.1 × 1000 × 1
      expect(costOf('claude-haiku-4-5', { cacheCreationInputTokens: 1000 }).costUsdMicro).to.equal(1250n); // 1.25×
      expect(costOf('claude-haiku-4-5', { cacheReadInputTokens: 1 }).costUsdMicro).to.equal(1n); // rounds UP, never under-reports
      expect(costOf('llama-3.3-70b-versatile', { inputTokens: 5 })).to.deep.equal({ priced: false, costUsdMicro: null, priceVersion: null });
      expect(Object.isFrozen(PRICES)).to.equal(true);
    });
  });

  describe('TieredModelRouter end to end (scripted providers, in-memory traces)', () => {
    let n = 0;
    const recorder = (store) => new TraceRecorder({ store, clock: () => new Date('2026-10-07T00:00:00Z'), idFactory: (p) => `${p}_${++n}` });

    it('falls back ONLY on retryable errors and meters every attempt with tier, task type and attribution', async () => {
      const anth = new ScriptedProvider({ id: 'anthropic', script: [new ProviderError('rl', { retryable: true, provider: 'anthropic' })] });
      const groq = new ScriptedProvider({ id: 'groq', script: [{ content: 'ok', model: 'llama-3.3-70b-versatile', usage: { inputTokens: 50, outputTokens: 5 } }] });
      const store = new InMemoryTraceStore(); const rec = recorder(store);
      const runId = await rec.startRun({ principalId: 'prn_alice', goal: 'g' });
      const res = await new TieredModelRouter({ providers: { anthropic: anth, groq } }).complete({ taskType: 'draft_strategy', messages: [{ role: 'user', content: 'x' }], runId, recorder: rec, attribution: { strategyId: 'stg_1', opportunityId: 'opp_9' } });
      expect(res.content).to.equal('ok');
      expect(store.modelTraces.map((t) => [t.provider, t.model, t.status, t.tier, t.taskType, t.strategyId, t.opportunityId, t.costPriced])).to.deep.equal([
        ['anthropic', 'claude-sonnet-5', 'error', 'standard', 'draft_strategy', 'stg_1', 'opp_9', false],
        ['groq', 'llama-3.3-70b-versatile', 'fallback', 'standard', 'draft_strategy', 'stg_1', 'opp_9', false],
      ]);
    });

    it('a non-retryable error stops the chain (no fallback)', async () => {
      const anth = new ScriptedProvider({ id: 'anthropic', script: [new ProviderError('bad', { retryable: false })] });
      const groq = new ScriptedProvider({ id: 'groq', script: [{ content: 'never' }] });
      expect(await code(() => new TieredModelRouter({ providers: { anthropic: anth, groq } }).complete({ taskType: 'classify_intent', messages: [{ role: 'user', content: 'x' }] }))).to.equal('PROVIDER_ERROR');
      expect(groq.calls).to.have.length(0);
    });

    it('structured results are re-validated by the router as well', async () => {
      const schema = { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false };
      const prov = new ScriptedProvider({ id: 'anthropic', script: [{ content: '{"ok":"yes"}', model: 'claude-haiku-4-5' }] });
      expect(await code(() => new TieredModelRouter({ providers: { anthropic: prov, groq: prov } }).complete({ taskType: 'extract_parameters', messages: [{ role: 'user', content: 'x' }], schema }))).to.equal('SCHEMA_INVALID');
    });

    it('a provider that skips validation is still caught by the router\'s own re-validation', async () => {
      const schema = { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false };
      class Sloppy extends ScriptedProvider { async structuredOutput() { return { ok: 'yes' }; } }
      const prov = new Sloppy({ id: 'anthropic' });
      expect(await code(() => new TieredModelRouter({ providers: { anthropic: prov, groq: prov } }).complete({ taskType: 'extract_parameters', messages: [{ role: 'user', content: 'x' }], schema }))).to.equal('SCHEMA_INVALID');
    });

    it('aggregates cost per user, strategy, opportunity and machine request', async () => {
      const usage = { inputTokens: 1000, outputTokens: 100 };
      const anth = new ScriptedProvider({ id: 'anthropic', script: [0, 1, 2].map(() => ({ content: 'ok', model: 'claude-sonnet-5', usage })) });
      const store = new InMemoryTraceStore(); const rec = recorder(store);
      const router = new TieredModelRouter({ providers: { anthropic: anth, groq: anth } });
      const a = await rec.startRun({ principalId: 'prn_alice', goal: 'g' });
      const b = await rec.startRun({ principalId: 'prn_bot', goal: 'g' });
      await router.complete({ taskType: 'explain_risk', messages: [{ role: 'user', content: 'x' }], runId: a, recorder: rec, attribution: { strategyId: 'stg_1' } });
      await router.complete({ taskType: 'explain_risk', messages: [{ role: 'user', content: 'x' }], runId: a, recorder: rec, attribution: { strategyId: 'stg_1', opportunityId: 'opp_1' } });
      await router.complete({ taskType: 'explain_risk', messages: [{ role: 'user', content: 'x' }], runId: b, recorder: rec, attribution: { machineRequestId: 'mreq_7' } });
      const each = '3000'; // 1000×2 + 100×10 micro-USD
      expect(await store.costBy('principal')).to.deep.equal([
        { key: 'prn_alice', calls: 2, pricedCalls: 2, unpricedCalls: 0, costUsdMicro: '6000', inputTokens: 2000, outputTokens: 200 },
        { key: 'prn_bot', calls: 1, pricedCalls: 1, unpricedCalls: 0, costUsdMicro: each, inputTokens: 1000, outputTokens: 100 },
      ]);
      expect((await store.costBy('strategy')).map((x) => [x.key, x.costUsdMicro])).to.deep.equal([['stg_1', '6000']]);
      expect((await store.costBy('opportunity')).map((x) => [x.key, x.costUsdMicro])).to.deep.equal([['opp_1', each]]);
      expect((await store.costBy('machine_request')).map((x) => [x.key, x.costUsdMicro])).to.deep.equal([['mreq_7', each]]);
      expect(await code(() => store.costBy('model'))).to.equal('CONFIG');
      expect(Object.keys(COST_DIMENSIONS)).to.deep.equal(['principal', 'strategy', 'opportunity', 'machine_request']);
    });
  });

  it('the SDK is imported only by the composition root outside agent/**, and nothing is mounted', () => {
    const hits = [];
    const walk = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) walk(p); else if (/\.mjs$/.test(f.name) && fs.readFileSync(p, 'utf8').includes("'@anthropic-ai/sdk'")) hits.push(path.relative(ROOT, p)); } };
    walk(path.join(ROOT, 'apps/api/src'));
    expect(hits).to.deep.equal(['apps/api/src/trading_agent/ai_providers.mjs']);
    for (const f of ['apps/api/app_factory.mjs', 'apps/api/server.js']) expect(fs.readFileSync(path.join(ROOT, f), 'utf8')).to.not.match(/ai_providers|tiered_router/);
  });
});
