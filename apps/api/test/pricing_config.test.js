/**
 * apps/api/test/pricing_config.test.js
 *
 * Tests for centralized pricing configuration — verifies pricing consistency,
 * plan configuration, and billing waterfall order.
 */

import { describe, it } from 'mocha';
import assert from 'assert';
import {
  SUBSCRIPTION_PLANS,
  CREDIT_PRICING,
  INTELLIGENCE_PRICES,
  X402_PRICING,
  BILLING_WATERFALL,
  resolvePlanFromProductId,
  getPlanConfig,
} from '../src/billing/pricing_config.mjs';

describe('Centralized Pricing Configuration', function () {
  describe('Subscription Plans', () => {
    it('has all 4 required plans', () => {
      assert.ok(SUBSCRIPTION_PLANS.free, 'free plan exists');
      assert.ok(SUBSCRIPTION_PLANS.starter, 'starter plan exists');
      assert.ok(SUBSCRIPTION_PLANS.pro, 'pro plan exists');
      assert.ok(SUBSCRIPTION_PLANS.professional, 'professional plan exists');
    });

    it('plans have correct INR pricing', () => {
      assert.strictEqual(SUBSCRIPTION_PLANS.free.price_inr, 0);
      assert.strictEqual(SUBSCRIPTION_PLANS.starter.price_inr, 49900);  // ₹499
      assert.strictEqual(SUBSCRIPTION_PLANS.pro.price_inr, 199900);     // ₹1,999
      assert.strictEqual(SUBSCRIPTION_PLANS.professional.price_inr, 499900); // ₹4,999
    });

    it('plans have ascending daily limits', () => {
      assert.ok(SUBSCRIPTION_PLANS.free.daily_limit < SUBSCRIPTION_PLANS.starter.daily_limit);
      assert.ok(SUBSCRIPTION_PLANS.starter.daily_limit < SUBSCRIPTION_PLANS.pro.daily_limit);
      assert.ok(SUBSCRIPTION_PLANS.pro.daily_limit < SUBSCRIPTION_PLANS.professional.daily_limit);
    });

    it('plans have ascending credits', () => {
      assert.ok(SUBSCRIPTION_PLANS.free.credits_usdt <= SUBSCRIPTION_PLANS.starter.credits_usdt);
      assert.ok(SUBSCRIPTION_PLANS.starter.credits_usdt < SUBSCRIPTION_PLANS.pro.credits_usdt);
      assert.ok(SUBSCRIPTION_PLANS.pro.credits_usdt < SUBSCRIPTION_PLANS.professional.credits_usdt);
    });
  });

  describe('Credit Pricing', () => {
    it('RPC calls are cheaper than intelligence', () => {
      assert.ok(CREDIT_PRICING.rpc_call < CREDIT_PRICING.intelligence_derived);
    });

    it('intelligence pricing follows tiered structure', () => {
      assert.ok(CREDIT_PRICING.intelligence_lookup <= CREDIT_PRICING.intelligence_derived);
      assert.ok(CREDIT_PRICING.intelligence_derived <= CREDIT_PRICING.intelligence_premium);
    });
  });

  describe('Intelligence Prices', () => {
    it('all metrics have valid prices', () => {
      for (const [name, price] of Object.entries(INTELLIGENCE_PRICES)) {
        assert.ok(typeof price === 'number' && price > 0, `${name} has valid price`);
      }
    });

    it('derived intelligence priced at $0.01', () => {
      assert.strictEqual(INTELLIGENCE_PRICES['funding-rate-heatmap'], 0.01);
    });
  });

  describe('Billing Waterfall', () => {
    it('has correct order', () => {
      assert.deepStrictEqual(BILLING_WATERFALL, [
        'promotional_grant',
        'subscription_included',
        'prepaid_credits',
        'authorized_overage',
        'x402_payment',
        'hard_stop',
      ]);
    });
  });

  describe('resolvePlanFromProductId', () => {
    it('defaults to starter for unknown product ID', () => {
      assert.strictEqual(resolvePlanFromProductId('unknown_id'), 'starter');
      assert.strictEqual(resolvePlanFromProductId(null), 'starter');
      assert.strictEqual(resolvePlanFromProductId(undefined), 'starter');
    });

    it('resolves pro when env matches', () => {
      process.env.DODO_PRODUCT_PRO_ID = 'prod_test_pro';
      assert.strictEqual(resolvePlanFromProductId('prod_test_pro'), 'pro');
      delete process.env.DODO_PRODUCT_PRO_ID;
    });
  });

  describe('getPlanConfig', () => {
    it('returns plan config for valid name', () => {
      const config = getPlanConfig('pro');
      assert.strictEqual(config.name, 'Pro');
      assert.strictEqual(config.tier, 'pro');
    });

    it('defaults to starter for unknown name', () => {
      const config = getPlanConfig('unknown');
      assert.strictEqual(config.name, 'Starter');
    });
  });
});
