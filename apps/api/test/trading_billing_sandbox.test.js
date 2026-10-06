import { expect } from 'chai';
import { RazorpayGateway, CATALOG } from '../src/trading_agent/billing/index.mjs';

// Stage 27 — Razorpay TEST MODE sandbox check (opt-in). Creates one test plan and one test
// subscription, prints the authentication link, then cancels the subscription. The webhook half
// (authenticate → charged) needs a person to complete the test checkout and a webhook endpoint,
// so it is exercised by the unit and Postgres suites with signed fixture events.
//
// Skipped unless the founder supplies TEST keys in the local shell (never committed):
//   RAZORPAY_TEST_KEY_ID (rzp_test_…), RAZORPAY_TEST_KEY_SECRET
// Live keys are refused by the gateway itself.
const env = process.env;
const ready = env.RAZORPAY_TEST_KEY_ID && env.RAZORPAY_TEST_KEY_SECRET;

describe('billing: Razorpay test-mode sandbox (opt-in)', function () {
  this.timeout(60_000);
  before(function () { if (!ready) this.skip(); });

  it('creates a test plan and subscription, then cancels it', async () => {
    const g = new RazorpayGateway({ keyId: env.RAZORPAY_TEST_KEY_ID, keySecret: async () => env.RAZORPAY_TEST_KEY_SECRET, webhookSecret: async () => 'unused-in-this-test', fetch: globalThis.fetch });
    const { gatewayPlanId } = await g.ensurePlan(CATALOG.plans.ta_pro_test);
    const sub = await g.createSubscription({ gatewayPlanId, subscriptionId: `bsub_sandbox_${Date.now()}`, principalId: 'prn_founder', totalCount: 1 });
    expect(sub.status).to.equal('created');
    const cancelled = await g.cancelSubscription({ gatewaySubscriptionId: sub.gatewaySubscriptionId, atCycleEnd: false });
    console.log('[razorpay test mode]', JSON.stringify({ gatewayPlanId, subscription: sub.gatewaySubscriptionId, authenticateUrl: sub.authenticateUrl, afterCancel: cancelled.status })); // eslint-disable-line no-console
  });
});
