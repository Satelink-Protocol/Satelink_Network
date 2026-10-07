// Trading agent — agent tool layer (Stage 12). See ./README.md.
// Not mounted; not imported by app_factory.mjs. No public API.
export const DOMAIN = 'agent';
export const TABLES = Object.freeze(['agent_runs', 'tool_calls', 'model_traces']);
export const FLAGS = Object.freeze(['TRADING_AGENT', 'MCP_TRADING', 'AUTONOMOUS_MODE']);
export const STATUS = 'skeleton';

export { AgentError, ProviderError } from './errors.mjs';
export { validate, assertValid, assertSchema, DECIMAL_STRING } from './schema.mjs';
export { wrapUntrusted, renderUntrusted, UNTRUSTED_NOTICE } from './untrusted.mjs';
export { redact, redactString, REDACTED } from './redaction.mjs';
export { ToolRegistry, ToolTier, defineTool, isForbiddenToolName, FORBIDDEN_TOOL_PATTERNS } from './tool_registry.mjs';
export { createDefaultTools, MARKET_PURPOSE } from './tools.mjs';
export { AIProvider, ScriptedProvider, Task } from './provider.mjs';
export { GroqProvider, GROQ_DEFAULT_BASE_URL } from './providers/groq.mjs';
export { AnthropicProvider } from './providers/anthropic.mjs';
export { ModelRouter } from './router.mjs';
export { TieredModelRouter } from './tiered_router.mjs';
export { Tier, LLM_TIERS, TASK_TIER, tierFor, DEFAULT_TIER_ROUTES, TIER_OPTIONS, ROUTER_CONFIG_VERSION } from './tiers.mjs';
export { PRICES, PRICE_VERSION, costOf } from './pricing.mjs';
export { TraceRecorder, InMemoryTraceStore, PgTraceStore, COST_DIMENSIONS } from './trace.mjs';
export { AgentRunner, SYSTEM_PROMPT } from './runtime.mjs';
