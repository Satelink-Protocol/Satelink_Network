// TEST-mode checkout allowlist (founder gate 2026-09-28): unit rules.
import assert from 'node:assert/strict';
import { checkoutAllowed, testCheckoutAllowlist } from '../src/pricing_v2/test_checkout_guard.mjs';
import { publicCatalog, loadCatalog } from '../src/pricing_v2/catalog.mjs';

describe('TEST-mode checkout allowlist', () => {
  const env = (v) => ({ DODO_TEST_CHECKOUT_ALLOWLIST: v });
  it('default (unset or empty) allows nobody in TEST mode', () => {
    assert.equal(checkoutAllowed('founder@satelink.network', 'test', {}), false);
    assert.equal(checkoutAllowed('founder@satelink.network', 'test', env('')), false);
    assert.equal(checkoutAllowed('founder@satelink.network', 'test', env(' , ')), false);
  });
  it('exact emails and @domain entries, case- and space-insensitive', () => {
    const e = env(' Founder@Satelink.network , @jakuraa.com ');
    assert.deepEqual(testCheckoutAllowlist(e), ['founder@satelink.network', '@jakuraa.com']);
    assert.equal(checkoutAllowed('founder@satelink.NETWORK', 'test', e), true);
    assert.equal(checkoutAllowed('anyone@jakuraa.com', 'test', e), true);
    assert.equal(checkoutAllowed('other@satelink.network', 'test', e), false);
    assert.equal(checkoutAllowed('x@notjakuraa.com', 'test', e), false, 'a domain entry never matches a suffix');
    assert.equal(checkoutAllowed('', 'test', e), false);
    assert.equal(checkoutAllowed(null, 'test', e), false);
  });
  it('LIVE mode is not restricted by this guard', () => {
    assert.equal(checkoutAllowed('anyone@example.com', 'live', {}), true);
  });
  it('publicCatalog(checkoutAllowed:false) marks every paid item "soon" and nothing purchasable', () => {
    const c = publicCatalog(loadCatalog(), { mode: 'test', checkoutAllowed: false });
    assert.equal(c.checkoutAvailable, false);
    for (const i of [...c.plans.filter((p) => p.kind !== 'free'), ...c.packs]) assert.deepEqual([i.id, i.purchasable, i.availability], [i.id, false, 'soon']);
    assert.equal(c.plans.find((p) => p.id === 'free').availability, 'free');
  });
});
