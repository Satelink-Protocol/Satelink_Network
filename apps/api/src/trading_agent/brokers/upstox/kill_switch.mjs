// Upstox kill switch mapping (Stage 22): /v2/user/kill-switch.
//   GET  → per segment { segment, segment_status ACTIVE|INACTIVE, kill_switch_enabled }
//   POST [{ segment, action: 'DISABLE'|'ENABLE' }] — all-or-nothing per request.
// Venue semantics (docs): disabling a segment cancels its open orders and blocks new ones; it is
// refused while positions are open (UDAPI1184); after disabling, re-enabling is refused for 12 hours
// (UDAPI1185); the access token must be regenerated after any change.
//
// Satelink's own kill switch (Stage 15) is always enforced first and is the source of truth. The
// venue switch is defence in depth for a USER's account-wide stop only (scope principal or
// broker_account). Global, venue, mandate, strategy and instrument stops are enforced by Satelink
// alone: disabling Upstox segments would also block that user's own manual trading for 12 hours,
// and a platform-wide stop must never do that to every customer. The result is a proposal; the
// user confirms it (COPILOT) before engage() is called.
// Nothing here closes positions: COPILOT means a human does that.
import { BrokerError, BrokerErrorCode } from '../errors.mjs';
import { UPSTOX_SEGMENTS, KILL_SWITCH_COOLING_MS } from './config.mjs';

const USER_ACCOUNT_WIDE = new Set(['principal', 'broker_account']);

/** Stage 15 kill-switch event → the venue action to propose (never executed automatically on release). */
export function venueActionFor(event, { segments = ['NSE_EQ', 'BSE_EQ'] } = {}) {
  if (event?.action === 'release') return Object.freeze({ venueAction: null, segments: [], reason: 'releases are manual at the venue (12-hour cooling, token regeneration)' });
  if (!USER_ACCOUNT_WIDE.has(event?.scopeType)) return Object.freeze({ venueAction: null, segments: [], reason: `${event?.scopeType ?? 'unknown'}-scoped stop is enforced by Satelink only` });
  return Object.freeze({ venueAction: 'DISABLE', segments: [...segments], reason: `${event.scopeType} stop: propose disabling the user's segments at Upstox too (needs the user's confirmation)` });
}

export class UpstoxKillSwitch {
  #rest; #base; #clock;
  constructor({ rest, apiBase, clock = () => new Date() }) { this.#rest = rest; this.#base = apiBase; this.#clock = clock; }

  async status(token) {
    const r = await this.#rest.request('GET', `${this.#base}/v2/user/kill-switch`, { token });
    return (r?.data ?? []).map((s) => Object.freeze({ segment: s.segment, segmentStatus: s.segment_status, killSwitchEnabled: s.kill_switch_enabled === true }));
  }

  /**
   * Disable segments. Refused locally (no call) if a segment still has open positions.
   * @returns { segments, engagedAt, releasableAt, tokenInvalidated: true }
   */
  async engage(token, segments, { openPositions = {} } = {}) {
    assertSegments(segments);
    const blocked = segments.filter((s) => Number(openPositions[s] ?? 0) > 0);
    if (blocked.length) throw new BrokerError(BrokerErrorCode.REJECTED, { venue: 'upstox', message: `close open positions first in ${blocked.join(', ')} (Upstox refuses to disable a segment with open positions)` });
    const r = await this.#rest.request('POST', `${this.#base}/v2/user/kill-switch`, { token, body: segments.map((segment) => ({ segment, action: 'DISABLE' })) });
    const at = this.#clock().getTime();
    return Object.freeze({ result: r?.data ?? [], segments: [...segments], engagedAt: new Date(at).toISOString(), releasableAt: new Date(at + KILL_SWITCH_COOLING_MS).toISOString(), tokenInvalidated: true });
  }

  /** Re-enable segments: refused locally inside the 12-hour cooling period. */
  async release(token, segments, { engagedAt }) {
    assertSegments(segments);
    const since = new Date(engagedAt).getTime();
    if (!Number.isFinite(since)) throw new BrokerError(BrokerErrorCode.INVALID_REQUEST, { venue: 'upstox', message: 'engagedAt required to check the cooling period' });
    const releasableAt = since + KILL_SWITCH_COOLING_MS;
    if (this.#clock().getTime() < releasableAt) throw new BrokerError(BrokerErrorCode.REJECTED, { venue: 'upstox', message: `cooling period: segments can be re-enabled after ${new Date(releasableAt).toISOString()}` });
    const r = await this.#rest.request('POST', `${this.#base}/v2/user/kill-switch`, { token, body: segments.map((segment) => ({ segment, action: 'ENABLE' })) });
    return Object.freeze({ result: r?.data ?? [], segments: [...segments], tokenInvalidated: true });
  }
}

function assertSegments(segments) {
  if (!Array.isArray(segments) || segments.length === 0 || segments.some((s) => !UPSTOX_SEGMENTS.includes(s))) {
    throw new BrokerError(BrokerErrorCode.INVALID_REQUEST, { venue: 'upstox', message: `segments must be a non-empty subset of ${UPSTOX_SEGMENTS.join(', ')}` });
  }
}
