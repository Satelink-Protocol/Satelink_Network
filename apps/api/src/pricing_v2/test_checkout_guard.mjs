// While Dodo runs in TEST mode, checkout and plan purchase are open ONLY to an
// allowlist of founder emails (founder gate, 2026-09-28). Everyone else sees
// plans marked "Available soon". LIVE mode is not restricted by this guard.
//
// DODO_TEST_CHECKOUT_ALLOWLIST: comma-separated emails; an entry starting with
// "@" allows a whole domain. Unset or empty = nobody (the safe default).

export function testCheckoutAllowlist(env = process.env) {
  return String(env.DODO_TEST_CHECKOUT_ALLOWLIST || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/** May this email start a Dodo checkout in this mode? */
export function checkoutAllowed(email, mode, env = process.env) {
  if (mode !== 'test') return true;
  const e = String(email || '').trim().toLowerCase();
  if (!e || !e.includes('@')) return false;
  const domain = e.slice(e.lastIndexOf('@'));
  return testCheckoutAllowlist(env).some((entry) => entry === e || (entry.startsWith('@') && entry === domain));
}

export const AVAILABLE_SOON = 'Available soon';
