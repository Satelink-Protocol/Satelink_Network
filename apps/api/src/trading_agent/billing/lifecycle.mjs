// Subscription lifecycle + dunning/grace (Stage 27).
// Razorpay state → Satelink state (Razorpay docs, "Subscription states"):
//   created → pending_authentication · authenticated → authenticated · active → active
//   pending (auto-charge failed, Razorpay retrying) → past_due WITH a grace period (paid features kept)
//   halted (all retries exhausted) → suspended (back to Free) · paused → paused
//   cancelled / completed / expired → ended
// Grace: past_due keeps the paid entitlements until grace_until; the dunning job moves it to
// suspended after that and sends reminders on the schedule below. A later successful charge
// (subscription.charged / activated) restores active.
export const GATEWAY_TO_STATUS = Object.freeze({
  created: 'pending_authentication', authenticated: 'authenticated', active: 'active', pending: 'past_due',
  halted: 'suspended', paused: 'paused', cancelled: 'ended', completed: 'ended', expired: 'ended',
});

export const GRACE_DAYS = 7;
export const REMINDER_DAYS = Object.freeze([0, 3, 6]);
const DAY = 86_400_000;

export function nextStatus(gatewayStatus) { return GATEWAY_TO_STATUS[gatewayStatus] ?? null; }

export function graceUntil(failedAtMs, days = GRACE_DAYS) { return new Date(failedAtMs + days * DAY); }

/** Reminders due in (fromMs, toMs] for a subscription that went past_due at failedAtMs. */
export function remindersDue(failedAtMs, fromMs, toMs, days = REMINDER_DAYS) {
  return days.map((d) => failedAtMs + d * DAY).filter((t) => t > fromMs && t <= toMs).map((t) => ({ dueAt: new Date(t).toISOString(), day: Math.round((t - failedAtMs) / DAY) }));
}
