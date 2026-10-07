// Automation bot runner (Phase 6 item 10). Library used by the separate worker process
// workers/trading-bots — never mounted in, or scheduled by, the API process.
export const DOMAIN = 'bots';
export { BOTS } from './registry.mjs';
export { BotRunner, Outcome, createBotMetrics } from './runner.mjs';
export { activeGlobal } from './kill.mjs';
