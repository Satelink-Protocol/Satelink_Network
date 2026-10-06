// Engage / release kill switches (Stage 15). Append-only; the permission rules live in
// kill_switch.mjs (agents never; releases narrower than engages; admin-engaged → admin-only release).
import { RiskError } from './errors.mjs';
import { assertKillSwitchPermission, engagedSwitches } from './kill_switch.mjs';

export class KillSwitchService {
  #store; #clock;
  constructor({ store, clock = () => new Date() }) {
    if (!store) throw new RiskError('CONFIG', 'KillSwitchService needs a store');
    this.#store = store; this.#clock = clock;
  }

  async engage(req) { return this.#append('engage', req); }
  async release(req) { return this.#append('release', req); }

  async #append(action, { actor, scopeType, scopeId = null, principalId = null, reason }) {
    if (typeof reason !== 'string' || reason.trim().length === 0 || reason.length > 500) throw new RiskError('INVALID', 'reason (1–500 chars) required');
    const target = { scopeType, scopeId, principalId };
    const events = await this.#store.killSwitchEvents({ principalId });
    const current = [...events].filter((e) => e.scopeType === scopeType && (e.scopeId ?? null) === scopeId && (e.principalId ?? null) === principalId).sort((a, b) => a.seq - b.seq).at(-1) ?? null;
    const source = assertKillSwitchPermission(actor, action, target, current);
    if (action === 'release' && current?.action !== 'engage') throw new RiskError('CONFLICT', 'that kill switch is not engaged');
    const event = { scopeType, scopeId, principalId, action, source, actorId: actor.principalId, reason, at: this.#clock().toISOString() };
    await this.#store.appendKillSwitchEvent(event);
    return Object.freeze({ ...event });
  }

  /** Engaged switches visible to a principal (theirs + platform-wide). */
  async engaged(principalId) {
    return engagedSwitches(await this.#store.killSwitchEvents({ principalId }));
  }
}
