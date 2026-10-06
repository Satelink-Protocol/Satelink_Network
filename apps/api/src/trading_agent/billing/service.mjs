// BillingService (Stage 27): subscription operations + verified, idempotent webhook application +
// dunning. Webhooks are the source of truth for status, plan and period; API calls only ask the
// gateway to act. Test mode posts captured payments to the simulated book; live mode refuses.
import { createHash } from 'node:crypto';
import { BillingError } from './errors.mjs';
import { CATALOG, assertCatalogUsable, entitlementsFor, planOf } from './plans.mjs';
import { assertGateway } from './gateway.mjs';
import { nextStatus, graceUntil, remindersDue, GRACE_DAYS } from './lifecycle.mjs';
import { buildInvoice } from './invoices.mjs';
import { prorationPreview } from './proration.mjs';
import { bookFor } from './books.mjs';

export class BillingService {
  #s; #g; #books; #clock; #ids; #catalog; #plans; #notifier;
  /**
   * @param deps.gatewayPlans { [catalogPlanId]: gatewayPlanId } created once per environment (ensurePlan)
   * @param deps.books        { sim: SimSubscriptionBook, real?: RealBookPosting }
   * @param deps.notifier     { send({ principalId, template, data, key }) } — dunning reminders
   */
  constructor({ store, gateway, books, clock = () => new Date(), idFactory, catalog = CATALOG, gatewayPlans = {}, notifier = { send: async () => {} } }) {
    if (!store || !books?.sim || typeof idFactory !== 'function') throw new BillingError('CONFIG', 'BillingService needs store, books.sim and idFactory');
    this.#s = store; this.#g = assertGateway(gateway); this.#books = books; this.#clock = clock; this.#ids = idFactory;
    this.#catalog = catalog; this.#plans = gatewayPlans; this.#notifier = notifier;
  }

  get mode() { return this.#g.mode; }

  plans() {
    return { catalogVersion: this.#catalog.version, status: this.#catalog.status, currency: this.#catalog.currency,
      plans: Object.values(this.#catalog.plans).map((p) => ({ id: p.id, name: p.name, amountMinor: String(p.amountMinor), period: p.period, entitlements: p.entitlements })) };
  }

  async current(principalId) {
    const sub = await this.#s.openFor(principalId, this.#g.mode);
    return { subscription: sub, entitlements: entitlementsFor(sub, this.#catalog) };
  }

  async start(principalId, { planId }) {
    assertCatalogUsable(this.#g.mode, this.#catalog);
    const plan = planOf(planId, this.#catalog);
    if (plan.amountMinor === 0n) throw new BillingError('INVALID', 'the Free plan needs no subscription');
    const gatewayPlanId = this.#plans[planId];
    if (!gatewayPlanId) throw new BillingError('CONFIG', `no gateway plan for ${planId}`);
    const id = this.#ids('bsub');
    await this.#s.insertSubscription({ id, principalId, gateway: this.#g.id, gatewaySubscriptionId: null, mode: this.#g.mode, planId, catalogVersion: this.#catalog.version, status: 'pending_authentication', gatewayStatus: null, lastEventAt: 0 });
    // The row exists first, so a webhook that beats this response still finds it (notes carry our id).
    const r = await this.#g.createSubscription({ gatewayPlanId, subscriptionId: id, principalId });
    await this.#s.updateSubscription(id, { gatewaySubscriptionId: r.gatewaySubscriptionId, gatewayStatus: r.status });
    return { subscriptionId: id, authenticateUrl: r.authenticateUrl, status: 'pending_authentication' };
  }

  async #ownedOpen(principalId) {
    const sub = await this.#s.openFor(principalId, this.#g.mode);
    if (!sub) throw new BillingError('NOT_FOUND', 'no open subscription');
    return sub;
  }

  async previewChange(principalId, { planId, scheduleChangeAt = 'now' }) {
    const sub = await this.#ownedOpen(principalId);
    if (sub.status !== 'active') throw new BillingError('CONFLICT', 'only an active subscription can change plan');
    const from = planOf(sub.planId, this.#catalog); const to = planOf(planId, this.#catalog);
    if (from.id === to.id) throw new BillingError('INVALID', 'already on that plan');
    return prorationPreview({ oldAmountMinor: from.amountMinor, newAmountMinor: to.amountMinor, cycleStart: sub.currentPeriodStart, cycleEnd: sub.currentPeriodEnd, now: this.#clock(), scheduleChangeAt });
  }

  /** Ask the gateway to change plan; the plan itself changes when subscription.updated arrives. */
  async changePlan(principalId, { planId, scheduleChangeAt = 'now' }) {
    const preview = await this.previewChange(principalId, { planId, scheduleChangeAt });
    const sub = await this.#ownedOpen(principalId);
    const gatewayPlanId = this.#plans[planId];
    if (!gatewayPlanId) throw new BillingError('CONFIG', `no gateway plan for ${planId}`);
    const r = await this.#g.changePlan({ gatewaySubscriptionId: sub.gatewaySubscriptionId, gatewayPlanId, scheduleChangeAt });
    return { preview, gatewayStatus: r.status, scheduled: r.hasScheduledChanges };
  }

  async cancel(principalId, { atCycleEnd = true } = {}) {
    const sub = await this.#ownedOpen(principalId);
    if (!sub.gatewaySubscriptionId) throw new BillingError('CONFLICT', 'subscription not linked to the gateway yet');
    const r = await this.#g.cancelSubscription({ gatewaySubscriptionId: sub.gatewaySubscriptionId, atCycleEnd });
    return { gatewayStatus: r.status, atCycleEnd };
  }

  async listInvoices(principalId) { return this.#s.listInvoices(principalId); }

  /**
   * Verified + idempotent webhook application. Returns { status: 'applied'|'duplicate'|'ignored', … }.
   * Throws SIGNATURE_INVALID (nothing recorded) or LEDGER_NOT_APPROVED (whole transaction rolled back).
   */
  async handleWebhook({ rawBody, signature, eventId }) {
    if (!(await this.#g.verifyWebhook(rawBody, signature))) throw new BillingError('SIGNATURE_INVALID', 'webhook signature invalid');
    if (typeof eventId !== 'string' || !eventId || eventId.length > 128) throw new BillingError('INVALID', 'event id header required');
    const ev = this.#g.parseWebhook(rawBody, eventId);
    const payloadHash = `sha256:${createHash('sha256').update(rawBody).digest('hex')}`;
    return this.#s.transaction(async (tx) => {
      const sub = ev.subscription
        ? (await tx.getByGatewayId(this.#g.id, ev.subscription.gatewaySubscriptionId)) ?? (ev.subscription.notes?.satelink_subscription ? await tx.getSubscription(ev.subscription.notes.satelink_subscription) : null)
        : null;
      let outcome = 'applied';
      if (!sub) outcome = 'ignored_unknown_subscription';
      if (!(await tx.recordEvent({ gateway: this.#g.id, eventId, eventType: ev.type, payloadHash, outcome }))) return { status: 'duplicate', eventId };
      if (!sub) return { status: 'ignored', eventId, reason: outcome };

      const result = { status: 'applied', eventId, type: ev.type, stateChanged: false, invoiceId: null, posted: false };
      // 1) state (never backwards in time)
      if (ev.subscription && ev.createdAt >= sub.lastEventAt) {
        const to = nextStatus(ev.subscription.status);
        const patch = { lastEventAt: ev.createdAt, gatewayStatus: ev.subscription.status };
        if (!sub.gatewaySubscriptionId) patch.gatewaySubscriptionId = ev.subscription.gatewaySubscriptionId;
        if (ev.subscription.currentStart) patch.currentPeriodStart = new Date(ev.subscription.currentStart * 1000).toISOString();
        if (ev.subscription.currentEnd) patch.currentPeriodEnd = new Date(ev.subscription.currentEnd * 1000).toISOString();
        const planId = Object.keys(this.#plans).find((k) => this.#plans[k] === ev.subscription.gatewayPlanId);
        if (planId && planId !== sub.planId) patch.planId = planId;
        if (to) {
          patch.status = to;
          patch.graceUntil = to === 'past_due' ? (sub.status === 'past_due' ? sub.graceUntil : graceUntil(ev.createdAt * 1000).toISOString()) : null;
        }
        await tx.updateSubscription(sub.id, patch);
        result.stateChanged = Boolean(to && to !== sub.status);
      } else if (ev.subscription) {
        result.stale = true;
      }
      // 2) money: a captured payment is recorded, invoiced and booked exactly once
      if (ev.payment && ev.payment.status === 'captured') {
        const fresh = await tx.getSubscription(sub.id);
        const isNew = await tx.insertPayment({ gateway: this.#g.id, gatewayPaymentId: ev.payment.gatewayPaymentId, subscriptionId: sub.id, mode: sub.mode, status: 'captured', amountMinor: ev.payment.amountMinor, currency: ev.payment.currency, gatewayInvoiceId: ev.payment.gatewayInvoiceId, occurredAt: new Date(ev.payment.createdAt * 1000).toISOString() });
        if (isNew) {
          const inv = buildInvoice({ id: this.#ids('inv'), subscription: fresh, plan: planOf(fresh.planId, this.#catalog), payment: ev.payment, issuedAt: new Date(ev.payment.createdAt * 1000).toISOString() });
          await tx.insertInvoice(inv);
          bookFor(sub.mode, this.#books).post({ postingKey: `${this.#g.id}:${ev.payment.gatewayPaymentId}`, principalId: sub.principalId, currency: ev.payment.currency, amountMinor: ev.payment.amountMinor, at: inv.issuedAt });
          result.invoiceId = inv.id; result.posted = true;
        }
      }
      return result;
    });
  }

  /** Dunning: reminders on days 0/3/6 of past_due; after the grace period → suspended (Free). */
  async runDunning() {
    const now = this.#clock().getTime();
    const out = { reminded: 0, suspended: 0 };
    for (const sub of await this.#s.listPastDue()) {
      const until = new Date(sub.graceUntil).getTime();
      const failedAt = until - GRACE_DAYS * 86_400_000;
      for (const r of remindersDue(failedAt, failedAt - 1, now)) {
        if (await this.#s.markNotice(`${sub.id}:${r.day}`)) {
          await this.#notifier.send({ principalId: sub.principalId, template: 'payment_failed', data: { day: r.day, graceUntil: sub.graceUntil }, key: `${sub.id}:${r.day}` });
          out.reminded += 1;
        }
      }
      if (now >= until) { await this.#s.updateSubscription(sub.id, { status: 'suspended', graceUntil: null }); out.suspended += 1; }
    }
    return out;
  }
}
