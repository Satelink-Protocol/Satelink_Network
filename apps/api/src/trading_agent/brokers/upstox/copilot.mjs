// COPILOT confirmation (Stage 22): every Upstox order and modification needs a fresh, explicit
// confirmation by a HUMAN for exactly these terms. The confirmation store is a port (the approval UI
// writes it, B-02); the adapter only verifies. A confirmation is bound to the account, client order
// id, action and a digest of the terms, so it cannot be replayed for another order or other terms.
import { createHash } from 'node:crypto';
import { BrokerError, BrokerErrorCode } from '../errors.mjs';

export const CONFIRMATION_MAX_AGE_MS = 10 * 60_000;

export function orderDigest({ action, brokerAccountId, clientOrderId, instrument, side, type, quantity, limitPrice, timeInForce }) {
  const terms = { action, brokerAccountId, clientOrderId, instrument, side, type, quantity, limitPrice: limitPrice ?? null, timeInForce: timeInForce ?? null };
  const canonical = JSON.stringify(Object.keys(terms).sort().reduce((o, k) => ((o[k] = terms[k]), o), {}));
  return `sha256:${createHash('sha256').update(canonical, 'utf8').digest('hex')}`;
}

const refuse = (m) => new BrokerError(BrokerErrorCode.PERMISSION_DENIED, { venue: 'upstox', message: `COPILOT confirmation required: ${m}` });

/**
 * @param port  { lookup({ brokerAccountId, clientOrderId, action }) → { digest, confirmedBy:{principalId, kind}, confirmedAt } | null }
 */
export async function requireConfirmation(port, { action, brokerAccountId, clientOrderId, digest, now, maxAgeMs = CONFIRMATION_MAX_AGE_MS }) {
  if (!port || typeof port.lookup !== 'function') throw refuse('no confirmation port configured');
  const c = await port.lookup({ brokerAccountId, clientOrderId, action });
  if (!c) throw refuse('no confirmation for this order');
  if (c.digest !== digest) throw refuse('confirmed terms differ from the order');
  if (c.confirmedBy?.kind !== 'human' || !c.confirmedBy?.principalId) throw refuse('only a human can confirm a COPILOT order');
  const at = new Date(c.confirmedAt).getTime();
  if (!Number.isFinite(at) || at > now || now - at > maxAgeMs) throw refuse('confirmation expired');
  return Object.freeze({ confirmedBy: c.confirmedBy.principalId, confirmedAt: new Date(at).toISOString(), digest });
}
