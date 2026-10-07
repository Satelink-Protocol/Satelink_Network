// Machine + AI-agent access (Phase 6 item 11). See README.md.
export const DOMAIN = 'access';
export const TABLES = Object.freeze(['trading_agent_keys', 'trading_agent_usage']);
export { Scope, scopeAllows, hashKey, KEY_PREFIX, AgentKeyService, InMemoryAgentKeyStore, PgAgentKeyStore } from './keys.mjs';
export { AgentAccessGuard, AccessError } from './guard.mjs';
export { MACHINE_PRICING } from './pricing.mjs';
export { createMachineInterface, decisionJson } from './interface.mjs';
export { createMachineTools } from './mcp_tools.mjs';
