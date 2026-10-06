// Razorpay subscriptions gateway (Stage 27) — TEST MODE ONLY.
//   * key ids must start with rzp_test_ (rzp_live_ is refused at construction: no live keys);
//   * secrets come from injected loaders (KMS in production, B-08; local env in dev via the test
//     harness); nothing here reads process.env;
//   * webhooks: HMAC-SHA256(raw body, webhook secret) hex in X-Razorpay-Signature, compared in
//     constant time; x-razorpay-event-id is the idempotency key (Razorpay docs);
//   * REST: Basic auth key_id:key_secret against https://api.razorpay.com/v1 (same host for test).
import { createHmac, timingSafeEqual } from 'node:crypto';
import { BillingError } from './errors.mjs';

const BASE = 'https://api.razorpay.com/v1';

export class RazorpayGateway {
  #keyId; #secret; #webhookSecret; #fetch;
  /**
   * @param keyId          rzp_test_… (live keys are refused)
   * @param keySecret      async () → API key secret
   * @param webhookSecret  async () → webhook secret
   */
  constructor({ keyId, keySecret, webhookSecret, fetch }) {
    if (typeof keyId !== 'string' || keyId.startsWith('rzp_live_')) throw new BillingError('FORBIDDEN', 'live Razorpay keys are refused: test mode only');
    if (!/^rzp_test_[A-Za-z0-9]{6,}$/.test(keyId)) throw new BillingError('CONFIG', 'a Razorpay TEST key id (rzp_test_…) is required');
    if (typeof keySecret !== 'function' || typeof webhookSecret !== 'function' || typeof fetch !== 'function') throw new BillingError('CONFIG', 'RazorpayGateway needs keySecret(), webhookSecret() and fetch');
    this.#keyId = keyId; this.#secret = keySecret; this.#webhookSecret = webhookSecret; this.#fetch = fetch;
  }

  get id() { return 'razorpay'; }
  get mode() { return 'test'; }

  async #call(method, path, body) {
    const auth = Buffer.from(`${this.#keyId}:${await this.#secret()}`).toString('base64');
    let res;
    try {
      res = await this.#fetch(`${BASE}${path}`, { method, headers: { Authorization: `Basic ${auth}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(10_000) });
    } catch (e) {
      throw new BillingError(method === 'GET' ? 'GATEWAY_UNAVAILABLE' : 'GATEWAY_AMBIGUOUS', `razorpay ${method} ${path}: ${e?.name ?? 'network error'}`);
    }
    const json = await res.json().catch(() => null);
    if (res.ok) return json;
    const code = res.status >= 500 ? (method === 'GET' ? 'GATEWAY_UNAVAILABLE' : 'GATEWAY_AMBIGUOUS') : res.status === 401 ? 'GATEWAY_AUTH' : 'GATEWAY_REJECTED';
    throw new BillingError(code, `razorpay ${res.status}: ${json?.error?.description ?? 'error'}`);
  }

  /** Create the gateway plan for a catalog plan (idempotency: the caller stores and reuses the id). */
  async ensurePlan(plan) {
    if (plan.amountMinor <= 0n) throw new BillingError('INVALID', 'free plans are not gateway plans');
    const r = await this.#call('POST', '/plans', { period: plan.period, interval: plan.interval, item: { name: plan.name, amount: Number(plan.amountMinor), currency: 'INR', description: plan.id }, notes: { satelink_plan: plan.id } });
    return { gatewayPlanId: r.id };
  }

  async createSubscription({ gatewayPlanId, subscriptionId, principalId, totalCount = 120 }) {
    const r = await this.#call('POST', '/subscriptions', { plan_id: gatewayPlanId, total_count: totalCount, quantity: 1, customer_notify: 1, notes: { satelink_subscription: subscriptionId, satelink_principal: principalId } });
    return { gatewaySubscriptionId: r.id, status: r.status, authenticateUrl: r.short_url ?? null };
  }

  /** Change plan: 'now' (Razorpay prorates and invoices/credits the difference) or 'cycle_end'. */
  async changePlan({ gatewaySubscriptionId, gatewayPlanId, scheduleChangeAt }) {
    if (!['now', 'cycle_end'].includes(scheduleChangeAt)) throw new BillingError('INVALID', 'scheduleChangeAt must be now or cycle_end');
    const r = await this.#call('PATCH', `/subscriptions/${encodeURIComponent(gatewaySubscriptionId)}`, { plan_id: gatewayPlanId, schedule_change_at: scheduleChangeAt });
    return { status: r.status, hasScheduledChanges: Boolean(r.has_scheduled_changes) };
  }

  async cancelSubscription({ gatewaySubscriptionId, atCycleEnd = true }) {
    const r = await this.#call('POST', `/subscriptions/${encodeURIComponent(gatewaySubscriptionId)}/cancel`, { cancel_at_cycle_end: atCycleEnd ? 1 : 0 });
    return { status: r.status };
  }

  /** Constant-time HMAC check over the RAW body (never a re-serialised object). */
  async verifyWebhook(rawBody, signature) {
    if (!Buffer.isBuffer(rawBody) && typeof rawBody !== 'string') throw new BillingError('INVALID', 'raw webhook body required');
    if (typeof signature !== 'string' || !/^[0-9a-f]{64}$/.test(signature)) return false;
    const want = Buffer.from(createHmac('sha256', await this.#webhookSecret()).update(rawBody).digest('hex'), 'utf8');
    const got = Buffer.from(signature, 'utf8');
    return want.length === got.length && timingSafeEqual(want, got);
  }

  /** Verified raw body → normalised event. */
  parseWebhook(rawBody, eventId) {
    const e = JSON.parse(Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : rawBody);
    const sub = e?.payload?.subscription?.entity ?? null;
    const pay = e?.payload?.payment?.entity ?? null;
    return Object.freeze({
      eventId, type: String(e?.event ?? ''), createdAt: Number(e?.created_at ?? 0),
      subscription: sub && { gatewaySubscriptionId: sub.id, status: sub.status, gatewayPlanId: sub.plan_id, currentStart: sub.current_start ?? null, currentEnd: sub.current_end ?? null, notes: sub.notes ?? {}, authAttempts: sub.auth_attempts ?? 0 },
      payment: pay && { gatewayPaymentId: pay.id, amountMinor: BigInt(pay.amount), currency: pay.currency, status: pay.status, gatewayInvoiceId: pay.invoice_id ?? null, createdAt: pay.created_at },
    });
  }
}
