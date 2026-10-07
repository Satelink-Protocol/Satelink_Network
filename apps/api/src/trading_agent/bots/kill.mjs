// Kill-switch helpers for bots: a GLOBAL engaged switch stops every acting bot.
import { engagedSwitches } from '../risk/kill_switch.mjs';

export function activeGlobal(events) {
  return engagedSwitches(events ?? []).find((e) => e.scopeType === 'global') ?? null;
}
