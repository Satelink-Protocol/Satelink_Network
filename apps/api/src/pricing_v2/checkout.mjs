// V2 checkout: a Dodo checkout session for a PlanCatalog plan or pack, bound to
// the signed-in account. Flag SATELINK_PLAN_BILLING_V2_ENABLED.
// Refuses anything not purchasable: no Dodo product id in this mode, or a
// failing worst-case economics gate (catalog.publicCatalog().purchasable).
import { loadCatalog, getPlan, getPack, publicCatalog } from './catalog.mjs';
import { dodoRequest } from './dodo_client.mjs';
import { dodoMode } from './webhooks.mjs';
import { AccountError } from '../console_accounts/keys.mjs';

export function isPlanBillingV2Enabled() {
  return process.env.SATELINK_PLAN_BILLING_V2_ENABLED === 'true';
}

export async function createCheckout({ accountId, email, itemId, returnUrl, mode = dodoMode(), catalog = loadCatalog(), request = dodoRequest }) {
  const item = getPlan(itemId, catalog) || getPack(itemId, catalog);
  if (!item || item.kind === 'free') throw new AccountError('unknown_item', 404, 'No such plan or pack');
  const pub = publicCatalog(catalog, { mode });
  const listed = [...pub.plans, ...pub.packs].find((x) => x.id === itemId);
  if (!listed?.purchasable) throw new AccountError('not_purchasable', 409, 'This plan is not available to buy yet');
  const session = await request(mode, 'POST', '/checkouts', {
    product_cart: [{ product_id: item.dodo[mode], quantity: 1 }],
    customer: email ? { email } : undefined,
    metadata: {
      satelink_checkout: 'v2',
      satelink_user_id: accountId,
      satelink_product_id: item.id,
      satelink_plan_version: catalog.version,
    },
    return_url: returnUrl,
  });
  return { checkoutUrl: session.checkout_url, sessionId: session.session_id, itemId: item.id, mode };
}
