import { expect } from 'chai';
import express from 'express';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHmac } from 'node:crypto';
import {
  RazorpayGateway, BillingService, InMemoryBillingStore, SimSubscriptionBook, RealBookPosting, prorationPreview, buildInvoice, GST_REVIEW,
  GATEWAYS, assertGateway, CATALOG, entitlementsFor, mountBillingRoutes, BILLING_ROUTES, GRACE_DAYS,
} from '../src/trading_agent/billing/index.mjs';

// Stage 27 — subscriptions billing (Razorpay, test mode). Pure: fake gateway API, no network, no DB.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.resolve(HERE, '../src/trading_agent/billing');
const KEY_ID = 'rzp_test_FakeKey123456';
const WEBHOOK_SECRET = 'fake-webhook-secret-for-tests';
const T0 = Date.UTC(2026, 9, 6, 6, 0) / 1000; // unix seconds
const DAY = 86_400;
const PLANS = { ta_pro_test: 'plan_ProFake0001', ta_team_test: 'plan_TeamFake001' };
const errOf = async (p) => { try { await p; } catch (e) { return e; } throw new Error('expected a rejection'); };

/** Fake Razorpay REST API. */
function fakeRazorpay() {
  const calls = []; let n = 0;
  const fetch = async (url, init) => {
    const u = new URL(url); const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ method: init.method, path: u.pathname, body, auth: init.headers.Authorization });
    const ok = (j) => new Response(JSON.stringify(j), { status: 200 });
    if (init.method === 'POST' && u.pathname === '/v1/plans') return ok({ id: `plan_Fake${++n}`, entity: 'plan' });
    if (init.method === 'POST' && u.pathname === '/v1/subscriptions') return ok({ id: `sub_Fake${String(++n).padStart(4, '0')}`, status: 'created', short_url: 'https://rzp.io/i/fake' });
    if (init.method === 'PATCH') return ok({ id: u.pathname.split('/').pop(), status: 'active', has_scheduled_changes: body.schedule_change_at === 'cycle_end' });
    if (u.pathname.endsWith('/cancel')) return ok({ status: body.cancel_at_cycle_end ? 'active' : 'cancelled' });
    return new Response(JSON.stringify({ error: { description: 'not found' } }), { status: 400 });
  };
  return { fetch, calls };
}

const gatewayFor = (fx) => new RazorpayGateway({ keyId: KEY_ID, keySecret: async () => 'fake-key-secret', webhookSecret: async () => WEBHOOK_SECRET, fetch: fx.fetch });

function rig({ gateway, now = T0 } = {}) {
  const t = { now: now * 1000 };
  const fx = fakeRazorpay();
  const store = new InMemoryBillingStore();
  const sim = new SimSubscriptionBook();
  const sent = [];
  let n = 0;
  const svc = new BillingService({ store, gateway: gateway ?? gatewayFor(fx), books: { sim }, clock: () => new Date(t.now), idFactory: (p) => `${p}_${String(++n).padStart(6, '0')}`, gatewayPlans: PLANS, notifier: { send: async (m) => { sent.push(m); } } });
  return { svc, store, sim, fx, t, sent };
}

/** A signed Razorpay webhook delivery (raw body bytes exactly as sent). */
function event(type, { subId, status, planId = PLANS.ta_pro_test, at, payment = null, notes = {}, start = T0, end = T0 + 30 * DAY }) {
  const raw = JSON.stringify({
    entity: 'event', account_id: 'acc_Fake', event: type, contains: payment ? ['subscription', 'payment'] : ['subscription'], created_at: at,
    payload: {
      subscription: { entity: { id: subId, entity: 'subscription', plan_id: planId, status, current_start: start, current_end: end, notes, auth_attempts: status === 'halted' ? 4 : status === 'pending' ? 1 : 0 } },
      ...(payment ? { payment: { entity: { id: payment.id, entity: 'payment', amount: payment.amount, currency: 'INR', status: payment.status ?? 'captured', invoice_id: payment.invoice ?? null, method: 'card', created_at: at } } } : {}),
    },
  });
  return { raw, signature: createHmac('sha256', WEBHOOK_SECRET).update(raw).digest('hex') };
}
const deliver = (svc, ev, eventId) => svc.handleWebhook({ rawBody: Buffer.from(ev.raw), signature: ev.signature, eventId });

async function activeSub(r, principalId = 'prn_alice') {
  const s = await r.svc.start(principalId, { planId: 'ta_pro_test' });
  const subId = r.fx.calls.find((c) => c.path === '/v1/subscriptions') && (await r.store.getSubscription(s.subscriptionId)).gatewaySubscriptionId;
  await deliver(r.svc, event('subscription.authenticated', { subId, status: 'authenticated', at: T0 }), 'evt_auth_1');
  await deliver(r.svc, event('subscription.activated', { subId, status: 'active', at: T0 + 1 }), 'evt_act_1');
  return { s, subId };
}

describe('billing: gateway abstraction and keys', () => {
  it('Razorpay is test-mode only: live keys are refused at construction; malformed keys too', () => {
    const fx = fakeRazorpay();
    expect(() => new RazorpayGateway({ keyId: 'rzp_live_RealKey123456', keySecret: async () => 'x', webhookSecret: async () => 'x', fetch: fx.fetch })).to.throw().with.property('code', 'FORBIDDEN');
    expect(() => new RazorpayGateway({ keyId: 'key_123', keySecret: async () => 'x', webhookSecret: async () => 'x', fetch: fx.fetch })).to.throw().with.property('code', 'CONFIG');
    const g = gatewayFor(fx);
    expect([g.id, g.mode]).to.deep.equal(['razorpay', 'test']);
    expect(() => assertGateway(g)).to.not.throw();
    expect(() => assertGateway({ mode: 'test' })).to.throw(/missing/);
  });

  it('the abstraction lists Dodo as the existing, untouched Pricing V2 path', () => {
    expect(GATEWAYS.razorpay).to.include({ status: 'implemented' });
    expect(GATEWAYS.dodo).to.include({ status: 'existing_external' });
  });

  it('REST calls use Basic auth with the test key and send the catalog amount in paise', async () => {
    const fx = fakeRazorpay();
    const g = gatewayFor(fx);
    await g.ensurePlan(CATALOG.plans.ta_pro_test);
    expect(fx.calls[0].body).to.deep.include({ period: 'monthly', interval: 1 });
    expect(fx.calls[0].body.item).to.deep.include({ amount: 49900, currency: 'INR' });
    expect(Buffer.from(fx.calls[0].auth.replace('Basic ', ''), 'base64').toString()).to.equal(`${KEY_ID}:fake-key-secret`);
    expect((await errOf(g.ensurePlan(CATALOG.plans.ta_free))).code).to.equal('INVALID');
  });
});

describe('billing: webhook signatures', () => {
  it('HMAC-SHA256 over the RAW body; tampering, a wrong secret or a re-serialised body all fail', async () => {
    const g = gatewayFor(fakeRazorpay());
    const ev = event('subscription.activated', { subId: 'sub_X', status: 'active', at: T0 });
    expect(await g.verifyWebhook(Buffer.from(ev.raw), ev.signature)).to.equal(true);
    expect(await g.verifyWebhook(Buffer.from(ev.raw.replace('active', 'halted')), ev.signature)).to.equal(false);
    expect(await g.verifyWebhook(Buffer.from(ev.raw), createHmac('sha256', 'other-secret').update(ev.raw).digest('hex'))).to.equal(false);
    expect(await g.verifyWebhook(Buffer.from(JSON.stringify(JSON.parse(ev.raw), null, 2)), ev.signature)).to.equal(false);
    for (const bad of [undefined, '', 'zz', ev.signature.toUpperCase()]) expect(await g.verifyWebhook(Buffer.from(ev.raw), bad), String(bad)).to.equal(false);
  });

  it('an invalid signature records nothing; a missing event id is refused', async () => {
    const r = rig();
    const ev = event('subscription.activated', { subId: 'sub_X', status: 'active', at: T0 });
    expect((await errOf(r.svc.handleWebhook({ rawBody: Buffer.from(ev.raw), signature: 'f'.repeat(64), eventId: 'evt_1' }))).code).to.equal('SIGNATURE_INVALID');
    expect(r.store.events.size).to.equal(0);
    expect((await errOf(r.svc.handleWebhook({ rawBody: Buffer.from(ev.raw), signature: ev.signature, eventId: undefined }))).code).to.equal('INVALID');
  });
});

describe('billing: acceptance — a test-mode subscription posts to the sim book', () => {
  it('start → authenticated → activated → charged: invoice with GST metadata (RPrC), balanced sim posting, Pro entitlements', async () => {
    const r = rig();
    const s = await r.svc.start('prn_alice', { planId: 'ta_pro_test' });
    expect(s).to.include({ status: 'pending_authentication', authenticateUrl: 'https://rzp.io/i/fake' });
    expect(r.fx.calls.find((c) => c.path === '/v1/subscriptions').body).to.deep.include({ plan_id: PLANS.ta_pro_test, quantity: 1, customer_notify: 1, notes: { satelink_subscription: s.subscriptionId, satelink_principal: 'prn_alice' } });
    const subId = (await r.store.getSubscription(s.subscriptionId)).gatewaySubscriptionId;
    expect((await r.svc.current('prn_alice')).entitlements.maxStrategies).to.equal(1); // still Free until paid

    await deliver(r.svc, event('subscription.authenticated', { subId, status: 'authenticated', at: T0 }), 'evt_a');
    await deliver(r.svc, event('subscription.activated', { subId, status: 'active', at: T0 + 1 }), 'evt_b');
    const out = await deliver(r.svc, event('subscription.charged', { subId, status: 'active', at: T0 + 2, payment: { id: 'pay_Fake0001', amount: 49900, invoice: 'inv_RzpFake01' } }), 'evt_c');
    expect(out).to.include({ status: 'applied', posted: true });

    const cur = await r.svc.current('prn_alice');
    expect(cur.subscription).to.include({ status: 'active', planId: 'ta_pro_test', mode: 'test', currentPeriodStart: new Date(T0 * 1000).toISOString() });
    expect(cur.entitlements).to.include({ maxStrategies: 5, liveTrading: false });

    const [inv] = await r.svc.listInvoices('prn_alice');
    expect(inv).to.include({ id: out.invoiceId, kind: 'invoice', mode: 'test', currency: 'INR', totalMinor: 49900n, gatewayPaymentId: 'pay_Fake0001' });
    expect(inv.gst).to.deep.include({ sacCode: null, taxBreakdown: null, reviewStatus: 'rprc_pending', note: GST_REVIEW });
    expect(inv.lines).to.deep.equal([{ lineNo: 1, description: 'Pro (test fixture) — Trading Agent subscription', quantity: 1, unitMinor: 49900n, amountMinor: 49900n, ledgerTxnId: null }]);

    expect(r.sim.balanced()).to.equal(true);
    expect(r.sim.balance('sim:platform:subscription_revenue')).to.equal(49900n);
    expect(r.sim.balance('sim:gateway:razorpay:clearing')).to.equal(-49900n);
    expect(r.sim.entries().every((e) => e.simulated && e.currency === 'INR')).to.equal(true);
  });

  it('a webhook that beats the API response still finds the subscription through its notes', async () => {
    const r = rig();
    const s = await r.svc.start('prn_alice', { planId: 'ta_pro_test' });
    await r.store.updateSubscription(s.subscriptionId, { gatewaySubscriptionId: null });
    const out = await deliver(r.svc, event('subscription.authenticated', { subId: 'sub_Early01', status: 'authenticated', at: T0, notes: { satelink_subscription: s.subscriptionId } }), 'evt_early');
    expect(out.status).to.equal('applied');
    expect((await r.store.getSubscription(s.subscriptionId)).gatewaySubscriptionId).to.equal('sub_Early01');
  });

  it('one open subscription per principal; the Free plan needs none; unknown plans refused', async () => {
    const r = rig();
    await r.svc.start('prn_alice', { planId: 'ta_pro_test' });
    expect((await errOf(r.svc.start('prn_alice', { planId: 'ta_team_test' }))).code).to.equal('CONFLICT');
    expect((await errOf(r.svc.start('prn_bob', { planId: 'ta_free' }))).code).to.equal('INVALID');
    expect((await errOf(r.svc.start('prn_bob', { planId: 'ta_gold' }))).code).to.equal('INVALID');
  });
});

describe('billing: webhook replay and idempotency', () => {
  it('the same event delivered twice is applied once (one invoice, one posting)', async () => {
    const r = rig();
    const { subId } = await activeSub(r);
    const charged = event('subscription.charged', { subId, status: 'active', at: T0 + 5, payment: { id: 'pay_Rep01', amount: 49900 } });
    const a = await deliver(r.svc, charged, 'evt_rep');
    const b = await deliver(r.svc, charged, 'evt_rep');
    expect([a.status, b.status]).to.deep.equal(['applied', 'duplicate']);
    expect(await r.svc.listInvoices('prn_alice')).to.have.length(1);
    expect(r.sim.balance('sim:platform:subscription_revenue')).to.equal(49900n);
  });

  it('5 concurrent deliveries of one event: exactly one applied', async () => {
    const r = rig();
    const { subId } = await activeSub(r);
    const ev = event('subscription.charged', { subId, status: 'active', at: T0 + 5, payment: { id: 'pay_Conc01', amount: 49900 } });
    const outs = await Promise.all(Array.from({ length: 5 }, () => deliver(r.svc, ev, 'evt_conc')));
    expect(outs.map((o) => o.status).sort()).to.deep.equal(['applied', 'duplicate', 'duplicate', 'duplicate', 'duplicate']);
    expect(await r.svc.listInvoices('prn_alice')).to.have.length(1);
  });

  it('a re-sent payment under a NEW event id is still counted once (payment id is unique)', async () => {
    const r = rig();
    const { subId } = await activeSub(r);
    await deliver(r.svc, event('subscription.charged', { subId, status: 'active', at: T0 + 5, payment: { id: 'pay_Same01', amount: 49900 } }), 'evt_x1');
    const second = await deliver(r.svc, event('subscription.charged', { subId, status: 'active', at: T0 + 6, payment: { id: 'pay_Same01', amount: 49900 } }), 'evt_x2');
    expect(second).to.include({ status: 'applied', posted: false, invoiceId: null });
    expect(r.sim.balance('sim:platform:subscription_revenue')).to.equal(49900n);
  });

  it('out-of-order events never move state backwards, but a late payment is still recorded once', async () => {
    const r = rig();
    const { subId } = await activeSub(r);
    await deliver(r.svc, event('subscription.charged', { subId, status: 'active', at: T0 + 100, payment: { id: 'pay_New01', amount: 49900 } }), 'evt_new');
    const stale = await deliver(r.svc, event('subscription.pending', { subId, status: 'pending', at: T0 + 50 }), 'evt_old');
    expect(stale).to.include({ stale: true });
    expect((await r.svc.current('prn_alice')).subscription.status).to.equal('active');
    const lateMoney = await deliver(r.svc, event('subscription.charged', { subId, status: 'active', at: T0 + 60, payment: { id: 'pay_Late01', amount: 49900 } }), 'evt_late');
    expect(lateMoney).to.include({ stale: true, posted: true });
    expect(await r.svc.listInvoices('prn_alice')).to.have.length(2);
  });

  it('events for unknown subscriptions are recorded and ignored', async () => {
    const r = rig();
    const out = await deliver(r.svc, event('subscription.activated', { subId: 'sub_Unknown', status: 'active', at: T0 }), 'evt_unk');
    expect(out).to.include({ status: 'ignored', reason: 'ignored_unknown_subscription' });
    expect((await deliver(r.svc, event('subscription.activated', { subId: 'sub_Unknown', status: 'active', at: T0 }), 'evt_unk')).status).to.equal('duplicate');
  });
});

describe('billing: failed payment, grace and dunning', () => {
  it('pending → past_due with a grace period (paid features kept); reminders on days 0/3/6 once each; suspended after grace', async () => {
    const r = rig();
    const { subId } = await activeSub(r);
    const failAt = T0 + 10 * DAY;
    await deliver(r.svc, event('subscription.pending', { subId, status: 'pending', at: failAt }), 'evt_fail');
    let cur = await r.svc.current('prn_alice');
    expect(cur.subscription).to.include({ status: 'past_due', graceUntil: new Date((failAt + GRACE_DAYS * DAY) * 1000).toISOString() });
    expect(cur.entitlements.maxStrategies).to.equal(5); // grace keeps the paid plan

    // a second failure during grace does not extend it
    await deliver(r.svc, event('subscription.pending', { subId, status: 'pending', at: failAt + DAY }), 'evt_fail2');
    expect((await r.svc.current('prn_alice')).subscription.graceUntil).to.equal(cur.subscription.graceUntil);

    r.t.now = failAt * 1000; expect(await r.svc.runDunning()).to.deep.equal({ reminded: 1, suspended: 0 });
    expect(await r.svc.runDunning()).to.deep.equal({ reminded: 0, suspended: 0 }); // same day: no repeat
    r.t.now = (failAt + 3 * DAY) * 1000; expect((await r.svc.runDunning()).reminded).to.equal(1);
    r.t.now = (failAt + 6 * DAY) * 1000; expect((await r.svc.runDunning()).reminded).to.equal(1);
    expect(r.sent.map((m) => m.data.day)).to.deep.equal([0, 3, 6]);
    r.t.now = (failAt + 7 * DAY) * 1000; expect((await r.svc.runDunning()).suspended).to.equal(1);
    cur = await r.svc.current('prn_alice');
    expect(cur.subscription).to.include({ status: 'suspended', graceUntil: null });
    expect(cur.entitlements.maxStrategies).to.equal(1); // back to Free
  });

  it('halted (all retries failed) suspends at once; a later successful charge restores active and clears grace', async () => {
    const r = rig();
    const { subId } = await activeSub(r);
    await deliver(r.svc, event('subscription.pending', { subId, status: 'pending', at: T0 + 10 * DAY }), 'evt_p');
    await deliver(r.svc, event('subscription.halted', { subId, status: 'halted', at: T0 + 12 * DAY }), 'evt_h');
    expect((await r.svc.current('prn_alice')).subscription).to.include({ status: 'suspended', graceUntil: null });
    await deliver(r.svc, event('subscription.charged', { subId, status: 'active', at: T0 + 13 * DAY, payment: { id: 'pay_Recover', amount: 49900 } }), 'evt_r');
    expect((await r.svc.current('prn_alice')).subscription).to.include({ status: 'active', graceUntil: null });
  });

  it('cancellation goes through the gateway; the state changes only when the webhook says so', async () => {
    const r = rig();
    const { subId } = await activeSub(r);
    expect(await r.svc.cancel('prn_alice', { atCycleEnd: false })).to.include({ gatewayStatus: 'cancelled' });
    expect(r.fx.calls.at(-1)).to.deep.include({ path: `/v1/subscriptions/${subId}/cancel`, body: { cancel_at_cycle_end: 0 } });
    expect((await r.svc.current('prn_alice')).subscription.status).to.equal('active');
    await deliver(r.svc, event('subscription.cancelled', { subId, status: 'cancelled', at: T0 + 3 }), 'evt_cx');
    expect((await r.svc.current('prn_alice')).subscription).to.equal(null); // ended ⇒ no open subscription
    expect((await r.svc.current('prn_alice')).entitlements.maxStrategies).to.equal(1);
  });
});

describe('billing: proration', () => {
  const cycle = { cycleStart: (T0) * 1000, cycleEnd: (T0 + 30 * DAY) * 1000 };

  it('upgrade mid-cycle is charged, downgrade is credited, exactly in paise (Razorpay daily-rate rule)', () => {
    const mid = (T0 + 15 * DAY) * 1000;
    expect(prorationPreview({ oldAmountMinor: 49900n, newAmountMinor: 149900n, ...cycle, now: mid })).to.include({ kind: 'charge', amountMinor: 50000n, remainingDays: 15, cycleDays: 30 });
    expect(prorationPreview({ oldAmountMinor: 149900n, newAmountMinor: 49900n, ...cycle, now: mid })).to.include({ kind: 'credit', amountMinor: 50000n });
    expect(prorationPreview({ oldAmountMinor: 49900n, newAmountMinor: 149900n, quantity: 2, ...cycle, now: mid }).amountMinor).to.equal(100000n);
    // 100000 × 1 ÷ 30 = 3333.33 → 3333 (half-even)
    expect(prorationPreview({ oldAmountMinor: 49900n, newAmountMinor: 149900n, ...cycle, now: (T0 + 29 * DAY) * 1000 }).amountMinor).to.equal(3333n);
    // 100000 × 2 ÷ 30 = 6666.67 → 6667 (rounds to nearest, never truncates)
    expect(prorationPreview({ oldAmountMinor: 49900n, newAmountMinor: 149900n, ...cycle, now: (T0 + 28 * DAY) * 1000 }).amountMinor).to.equal(6667n);
  });

  it('end-of-cycle changes have no proration; tiny differences and times outside the cycle are refused', async () => {
    expect(prorationPreview({ oldAmountMinor: 49900n, newAmountMinor: 149900n, ...cycle, now: (T0 + 3 * DAY) * 1000, scheduleChangeAt: 'cycle_end' })).to.include({ kind: 'none', amountMinor: 0n });
    expect(() => prorationPreview({ oldAmountMinor: 1000n, newAmountMinor: 1030n, ...cycle, now: (T0 + 15 * DAY) * 1000 })).to.throw(/under 50 subunits/);
    expect(() => prorationPreview({ oldAmountMinor: 1n, newAmountMinor: 2n, ...cycle, now: (T0 + 31 * DAY) * 1000 })).to.throw(/inside the current billing cycle/);
  });

  it('a plan change returns the preview, asks the gateway, and the plan switches only on subscription.updated', async () => {
    const r = rig({ now: T0 + 15 * DAY });
    const { subId } = await activeSub(r);
    const out = await r.svc.changePlan('prn_alice', { planId: 'ta_team_test', scheduleChangeAt: 'now' });
    expect(out.preview).to.include({ kind: 'charge', amountMinor: 50000n });
    expect(r.fx.calls.at(-1)).to.deep.include({ method: 'PATCH', path: `/v1/subscriptions/${subId}`, body: { plan_id: PLANS.ta_team_test, schedule_change_at: 'now' } });
    expect((await r.svc.current('prn_alice')).subscription.planId).to.equal('ta_pro_test');
    await deliver(r.svc, event('subscription.updated', { subId, status: 'active', planId: PLANS.ta_team_test, at: T0 + 15 * DAY }), 'evt_upd');
    expect((await r.svc.current('prn_alice')).subscription.planId).to.equal('ta_team_test');
    expect((await errOf(r.svc.changePlan('prn_alice', { planId: 'ta_team_test' }))).code).to.equal('INVALID'); // already on it
  });
});

describe('billing: live mode and the real book', () => {
  /** A stand-in for a live-mode gateway (no real live gateway can be constructed). */
  const liveGateway = (g) => ({ id: 'razorpay', mode: 'live', ensurePlan: g.ensurePlan.bind(g), createSubscription: g.createSubscription.bind(g), changePlan: g.changePlan.bind(g), cancelSubscription: g.cancelSubscription.bind(g), verifyWebhook: g.verifyWebhook.bind(g), parseWebhook: g.parseWebhook.bind(g) });

  it('the draft catalog cannot start a live subscription', async () => {
    const fx = fakeRazorpay();
    const r = rig({ gateway: liveGateway(gatewayFor(fx)) });
    expect((await errOf(r.svc.start('prn_alice', { planId: 'ta_pro_test' }))).code).to.equal('FORBIDDEN');
    expect(fx.calls).to.have.length(0);
  });

  it('a live-mode captured payment is REFUSED by the real book and nothing is recorded (Razorpay will retry)', async () => {
    const fx = fakeRazorpay();
    const r = rig({ gateway: liveGateway(gatewayFor(fx)) });
    await r.store.insertSubscription({ id: 'bsub_live01', principalId: 'prn_alice', gateway: 'razorpay', gatewaySubscriptionId: 'sub_Live01', mode: 'live', planId: 'ta_pro_test', catalogVersion: CATALOG.version, status: 'active', lastEventAt: 0 });
    const e = await errOf(deliver(r.svc, event('subscription.charged', { subId: 'sub_Live01', status: 'active', at: T0, payment: { id: 'pay_Live01', amount: 49900 } }), 'evt_live'));
    expect(e.code).to.equal('LEDGER_NOT_APPROVED');
    expect(r.store.events.size).to.equal(0);
    expect(r.store.payments.size).to.equal(0);
    expect(r.store.invoices.size).to.equal(0);
    expect(r.sim.entries()).to.have.length(0);
    expect(() => new RealBookPosting().post({})).to.throw(/Stage 20/);
  });

  it('invoices are only for captured INR payments and compute no tax', () => {
    const sub = { id: 'bsub_x', principalId: 'prn_a', mode: 'test', gateway: 'razorpay' };
    expect(() => buildInvoice({ id: 'inv_x', subscription: sub, plan: CATALOG.plans.ta_pro_test, payment: { status: 'failed', currency: 'INR', amountMinor: 1n }, issuedAt: 'x' })).to.throw(/captured/);
    expect(() => buildInvoice({ id: 'inv_x', subscription: sub, plan: CATALOG.plans.ta_pro_test, payment: { status: 'captured', currency: 'USD', amountMinor: 1n }, issuedAt: 'x' })).to.throw(/currency/);
    const inv = buildInvoice({ id: 'inv_x', subscription: sub, plan: CATALOG.plans.ta_pro_test, payment: { status: 'captured', currency: 'INR', amountMinor: 49900n, gatewayPaymentId: 'pay_1' }, gst: { customerGstin: '27AAAAA0000A1Z5', placeOfSupply: '27' }, issuedAt: 'x' });
    expect(inv.gst).to.deep.include({ customerGstin: '27AAAAA0000A1Z5', placeOfSupply: '27', sacCode: null, taxBreakdown: null });
    expect(inv.totalMinor).to.equal(49900n);
    expect(entitlementsFor(null).liveTrading).to.equal(false);
  });
});

describe('billing: HTTP surface (/billing/*, /webhooks/razorpay)', function () {
  this.timeout(20_000);
  const ON = { TRADING_FLAG_SUBSCRIPTIONS: 'true' };
  function app(env = ON) {
    const r = rig();
    const a = express();
    const mounted = mountBillingRoutes(a, { env, service: r.svc, resolvePrincipal: async (req) => ({ 'alice': { principalId: 'prn_alice', kind: 'human', via: 'api_key' }, 'agent': { principalId: 'prn_alice', kind: 'agent', via: 'api_key' } })[req.get('x-test-user')] ?? null });
    return { a, r, mounted };
  }

  it('flag off ⇒ nothing is mounted; mounted but flipped off ⇒ every route 404', async () => {
    expect(app({}).mounted).to.deep.equal({ mounted: false, reason: 'SUBSCRIPTIONS flag is off' });
    const env = { ...ON };
    const { a } = app(env);
    delete env.TRADING_FLAG_SUBSCRIPTIONS;
    for (const [m, p] of BILLING_ROUTES) expect((await request(a)[m.toLowerCase()](p).set('x-test-user', 'alice').send({})).status, `${m} ${p}`).to.equal(404);
  });

  it('plans and subscription start (Idempotency-Key replay ⇒ one gateway subscription); agents cannot subscribe', async () => {
    const { a, r } = app();
    const plans = await request(a).get('/billing/plans').set('x-test-user', 'alice');
    expect(plans.body.data).to.include({ catalogVersion: CATALOG.version, status: 'draft' });
    expect(plans.body.data.plans.map((p) => p.amountMinor)).to.deep.equal(['0', '49900', '149900']);
    const go = () => request(a).post('/billing/subscriptions').set('x-test-user', 'alice').set('Idempotency-Key', 'idem-sub-0001').send({ planId: 'ta_pro_test' });
    const one = await go(); const two = await go();
    expect([one.status, two.status]).to.deep.equal([201, 201]);
    expect(two.body).to.deep.equal(one.body);
    expect(r.fx.calls.filter((c) => c.path === '/v1/subscriptions')).to.have.length(1);
    expect((await request(a).post('/billing/subscriptions').set('x-test-user', 'agent').set('Idempotency-Key', 'idem-sub-0002').send({ planId: 'ta_pro_test' })).status).to.equal(403);
    expect((await request(a).post('/billing/subscriptions').set('x-test-user', 'alice').send({ planId: 'ta_pro_test' })).status).to.equal(400); // no key
  });

  it('webhook route: raw bytes are verified (401 on a bad signature, 200 applied, 200 duplicate)', async () => {
    const { a, r } = app();
    const s = await r.svc.start('prn_alice', { planId: 'ta_pro_test' });
    const subId = (await r.store.getSubscription(s.subscriptionId)).gatewaySubscriptionId;
    const ev = event('subscription.activated', { subId, status: 'active', at: T0 });
    const post = (sig) => request(a).post('/webhooks/razorpay').set('Content-Type', 'application/json').set('X-Razorpay-Signature', sig).set('x-razorpay-event-id', 'evt_http').send(ev.raw);
    expect((await post('0'.repeat(64))).status).to.equal(401);
    const ok = await post(ev.signature);
    expect([ok.status, ok.body.data.status]).to.deep.equal([200, 'applied']);
    expect((await post(ev.signature)).body.data.status).to.equal('duplicate');
  });
});

describe('billing: static guarantees', () => {
  const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.mjs'));
  const code = (f) => fs.readFileSync(path.join(DIR, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  it('no env reads, no ledger / existing-billing imports, no live-key use', () => {
    for (const f of files) {
      const c = code(f);
      expect(c, f).to.not.match(/process\.env/);
      expect(c, f).to.not.match(/from ['"][^'"]*(pricing_v2|dodo|ledger|credit_service|api_credits|revenue)[^'"]*['"]/i);
      if (f !== 'razorpay.mjs') expect(c, f).to.not.match(/rzp_live_/);
      expect(c, f).to.not.match(/parseFloat|toFixed\(/);
    }
  });
});
