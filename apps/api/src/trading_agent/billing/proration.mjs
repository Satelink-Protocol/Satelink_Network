// Proration preview (Stage 27), mirroring Razorpay's documented rule for an IMMEDIATE plan change:
//   daily rate = plan amount × quantity ÷ billing-cycle days; the difference between what the
//   remaining days cost on the new plan and what was already paid for them on the old plan is
//   invoiced (upgrade) or credited (downgrade); a difference under 50 subunits is refused.
// 'cycle_end' changes have no proration. Integer minor units, half-even; Razorpay's own invoice /
// credit note is authoritative — this is the preview the customer sees before confirming.
import { BillingError } from './errors.mjs';

const DAY = 86_400_000;
const MIN_DIFF = 50n;

function divHalfEven(n, d) {
  const q = n / d; const r = n % d;
  const twice = 2n * (r < 0n ? -r : r);
  if (twice < d) return q;
  if (twice > d) return q + (n < 0n ? -1n : 1n);
  return q % 2n === 0n ? q : q + (n < 0n ? -1n : 1n);
}

export function prorationPreview({ oldAmountMinor, newAmountMinor, quantity = 1, cycleStart, cycleEnd, now, scheduleChangeAt = 'now' }) {
  if (scheduleChangeAt === 'cycle_end') return Object.freeze({ kind: 'none', amountMinor: 0n, effectiveAt: new Date(cycleEnd).toISOString() });
  const start = new Date(cycleStart).getTime(); const end = new Date(cycleEnd).getTime(); const t = new Date(now).getTime();
  if (!(start < end) || t < start || t >= end) throw new BillingError('INVALID', 'now must be inside the current billing cycle');
  const cycleDays = BigInt(Math.round((end - start) / DAY));
  const remainingDays = BigInt(Math.ceil((end - t) / DAY));
  const q = BigInt(quantity);
  // remaining × amount × qty ÷ cycleDays, done once on the difference to avoid double rounding
  const diff = divHalfEven((BigInt(newAmountMinor) - BigInt(oldAmountMinor)) * q * remainingDays, cycleDays);
  const abs = diff < 0n ? -diff : diff;
  if (abs === 0n) return Object.freeze({ kind: 'none', amountMinor: 0n, effectiveAt: new Date(t).toISOString(), remainingDays: Number(remainingDays), cycleDays: Number(cycleDays) });
  if (abs < MIN_DIFF) throw new BillingError('INVALID', 'prorated difference is under 50 subunits; schedule the change for the end of the cycle');
  return Object.freeze({ kind: diff > 0n ? 'charge' : 'credit', amountMinor: abs, effectiveAt: new Date(t).toISOString(), remainingDays: Number(remainingDays), cycleDays: Number(cycleDays) });
}
