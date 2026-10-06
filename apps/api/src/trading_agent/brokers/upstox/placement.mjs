// Placement policy (Stage 22, U8). Upstox requires API order traffic to originate from the
// customer's registered static IP, and "a Static IP can be linked to only one customer … cannot be
// shared or registered by any other customer". So API placement for a customer is allowed only
// from an egress IP dedicated to THAT customer and registered on THEIR Upstox account. No such
// per-customer egress exists (B-08), so production resolves to PREPARE_ONLY: Satelink prepares
// the order ticket and the customer places it in Upstox themselves. Sharing one IP across
// customers is never a valid configuration here (it resolves to PREPARE_ONLY, never to API).
import { createHash } from 'node:crypto';

export const PlacementMode = Object.freeze({ API: 'api', PREPARE_ONLY: 'prepare_only' });

/**
 * @param environment  resolved environment ({ name, paper })
 * @param egress       { ip, principalId, exclusive, sharedWith: [] } | null — the customer's dedicated egress
 * @param principalId  the customer the order is for
 * @param registeredIps { primaryIp, secondaryIp } from GET /v2/user/ip | null
 */
export function resolvePlacementMode({ environment, egress, principalId, registeredIps }) {
  if (environment?.paper) return Object.freeze({ mode: PlacementMode.API, reasons: ['sandbox orders are simulated; no customer IP is involved'] });
  const reasons = [];
  if (!egress?.ip) reasons.push('no dedicated egress IP is provisioned for this customer (B-08)');
  else {
    if (egress.principalId !== principalId) reasons.push('the egress IP is assigned to a different customer');
    if (egress.exclusive !== true || (egress.sharedWith ?? []).length > 0) reasons.push('the egress IP is shared across customers — forbidden (one static IP per customer)');
    const reg = [registeredIps?.primaryIp, registeredIps?.secondaryIp].filter(Boolean);
    if (!reg.includes(egress.ip)) reasons.push('the egress IP is not registered on the customer\'s Upstox account');
  }
  return Object.freeze(reasons.length ? { mode: PlacementMode.PREPARE_ONLY, reasons } : { mode: PlacementMode.API, reasons: ['dedicated, exclusive, registered egress IP'] });
}

/** The prepare-order fallback: everything a human needs to place the order in Upstox. Nothing is sent. */
export function prepareOrderTicket(order, instrument, { product = 'D' } = {}) {
  const ticket = {
    kind: 'satelink.upstox.prepared-order/1',
    instrument: instrument.canonical, instrumentKey: instrument.venueSymbol, side: order.side.toUpperCase(), orderType: 'LIMIT',
    quantity: order.quantity, price: order.limitPrice, validity: (order.timeInForce ?? 'day').toUpperCase(), product,
    tag: order.clientOrderId,
    note: 'Prepared by Satelink. NOT sent: place it yourself in the Upstox app or web; enter the tag if offered so it can be reconciled.',
  };
  return Object.freeze({ ...ticket, ticketHash: `sha256:${createHash('sha256').update(JSON.stringify(ticket)).digest('hex')}` });
}
