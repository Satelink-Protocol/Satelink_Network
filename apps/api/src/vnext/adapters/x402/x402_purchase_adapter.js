// x402 purchase adapter (WorkloadAdapter) — the first REAL routing adapter.
//
// Buys an x402-paywalled HTTP resource: QUOTE parses a real x402 402
// payment-requirements body; EXECUTE re-requests the resource carrying the
// real base64 `X-PAYMENT` header produced at SETTLE_IN. The HTTP transport is
// injectable (`fetchFn`, defaults to global fetch) so the ONLY mockable
// boundary is the network — all x402 parsing/quoting/execution logic is real.
// settlementMode = PRE (pay before execute); the kernel branches generically.

import { WorkloadAdapter, SettlementMode, ExecutionSafety } from '../../kernel/interfaces.js';
import { getX402Config } from '../../../payments/x402/config.js';
import { txIdOf } from './x402_context.js';

export class X402PurchaseAdapter extends WorkloadAdapter {
  constructor({ resources = [], ctx, fetchFn, config } = {}) {
    super();
    if (!ctx) throw new Error('X402PurchaseAdapter requires a shared X402Context');
    this.resources = resources; // real x402 resource descriptors {url, method, supplierId}
    this.ctx = ctx;
    this.fetchFn = fetchFn || globalThis.fetch;
    this.cfg = config || getX402Config();
  }

  capabilities() {
    return {
      key: 'x402-purchase',
      resourceTypes: ['http-402'],
      settlementMode: SettlementMode.PRE,
      executionSafety: ExecutionSafety.AT_MOST_ONCE,
    };
  }

  async discover(query) {
    if (query && query.resource) return this.resources.filter((r) => r.url === query.resource);
    return this.resources.slice();
  }

  async probe(supplier) { return { ok: !!(supplier && supplier.url) }; }

  async quote(_request, supplier) {
    const res = await this.fetchFn(supplier.url, { method: supplier.method || 'GET' });
    if (res.status === 402) {
      const body = await res.json();
      const accepts = body.accepts || {};
      return {
        cost: Number(accepts.maxAmountRequired ?? 0),
        unit: 'USDC',
        network: accepts.network || this.cfg.network,
        payTo: accepts.payTo || this.cfg.payTo,
        resource: accepts.resource || supplier.url,
        scheme: accepts.scheme || 'exact',
        supplierId: supplier.supplierId,
      };
    }
    return { cost: 0, unit: 'none', resource: supplier.url, supplierId: supplier.supplierId, free: true };
  }

  async execute(_request, supplier, execCtx) {
    const txId = txIdOf(execCtx.idemKey);
    const payment = this.ctx.payments.get(txId);
    const headers = payment ? { 'X-PAYMENT': payment.header } : {};
    const res = await this.fetchFn(supplier.url, { method: supplier.method || 'GET', headers });
    const body = await res.json();
    return { status: res.status, body, paidWith: payment ? payment.ref : null };
  }
}
