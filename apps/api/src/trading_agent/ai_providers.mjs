// Composition root for LLM providers (Phase 6 item 3). Lives OUTSIDE agent/** on purpose: the agent
// layer may not import SDKs, env or credential loaders (Stage 12 import-boundary lint). The caller
// passes API keys obtained from its secret loader; nothing here reads process.env.
import Anthropic from '@anthropic-ai/sdk';
import { AnthropicProvider } from './agent/providers/anthropic.mjs';
import { GroqProvider } from './agent/providers/groq.mjs';
import { TieredModelRouter } from './agent/tiered_router.mjs';

/** @param {{ anthropicApiKey?: string, groqApiKey?: string, fetch?: typeof fetch, routes?: object }} keys */
export function createTieredRouter({ anthropicApiKey, groqApiKey, fetch = globalThis.fetch, routes } = {}) {
  const providers = {};
  if (anthropicApiKey) providers.anthropic = new AnthropicProvider({ apiKey: anthropicApiKey, Anthropic });
  if (groqApiKey) providers.groq = new GroqProvider({ apiKey: groqApiKey, fetch });
  return new TieredModelRouter({ providers, ...(routes ? { routes } : {}) });
}
