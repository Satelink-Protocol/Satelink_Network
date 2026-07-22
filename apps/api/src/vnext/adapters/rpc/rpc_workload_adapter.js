// RPC workload adapter (self-supply) — makes Satelink's OWN RPC gateway a vNext
// resale supplier (row #1, per ADR-002). settlementMode = POST: Satelink IS the
// supplier, so there is no upstream payment leg — the kernel executes the call
// directly and the inbound revenue is collected by the /resell inbound leg
// (M7 verifier -> treasury). The upstream node URLs are REUSED from the live
// rpc_gateway providers so metered traffic hits the exact same endpoints.
//
// Kernel is untouched: this is a plain WorkloadAdapter. The HTTP transport is
// injected (`fetchFn`) so execution is testable without a live node.

import { WorkloadAdapter, SettlementMode, ExecutionSafety } from '../../kernel/interfaces.js';
import { getPrimaryProvider, getSupportedChains } from '../../../workloads/rpc_gateway/providers.js';

const SUPPLIER_PREFIX = 'satelink-rpc';

// JSON-RPC methods that mutate chain state — never safe to auto-retry.
const NON_IDEMPOTENT = new Set(['eth_sendRawTransaction', 'eth_sendTransaction']);

export class RpcWorkloadAdapter extends WorkloadAdapter {
  /**
   * @param {object} o
   *  - chains: chain keys to self-supply (default: all supported)
   *  - unitPriceMinor: Satelink's internal cost per call in minor units (self
   *    supply cost, > 0 for honest internal transfer pricing). Default 3 (=$0.00003 at 1e5).
   *  - currency: pricing unit (default 'USDC')
   *  - fetchFn: injected HTTP transport (default global fetch)
   *  - providerFor: (chain) -> { url } override for tests
   */
  constructor({ chains, unitPriceMinor = 3, currency = 'USDC', fetchFn, providerFor } = {}) {
    super();
    this.chains = Array.isArray(chains) && chains.length ? chains : safeSupportedChains();
    this.unitPriceMinor = unitPriceMinor;
    this.currency = currency;
    this.fetchFn = fetchFn || globalThis.fetch;
    this.providerFor = providerFor || ((chain) => getPrimaryProvider(chain));
  }

  capabilities() {
    return {
      key: 'rpc',
      resourceTypes: ['json-rpc'],
      settlementMode: SettlementMode.POST, // self-supply: no upstream payment
      executionSafety: ExecutionSafety.AT_MOST_ONCE, // may carry writes; never auto-retry
    };
  }

  // Self-supply: one routable candidate per supported chain. `query.chain`
  // filters. Candidates carry the routing shape the DecisionEngine reads.
  async discover(query = {}) {
    const wanted = query.chain ? [String(query.chain)] : this.chains;
    return wanted
      .filter((c) => this.chains.includes(c))
      .map((chain) => ({ supplierId: `${SUPPLIER_PREFIX}:${chain}`, adapterId: 'rpc', chain, self: true }));
  }

  async probe(supplier) {
    const p = this.providerFor(supplier.chain);
    return { ok: !!(p && p.url) };
  }

  // Self-supply cost is Satelink's internal per-call cost (honest, non-zero, so
  // the router never treats self-supply as free vs external RPC suppliers).
  async quote(_request, supplier) {
    return { cost: this.unitPriceMinor, unit: this.currency, supplierId: supplier.supplierId, chain: supplier.chain };
  }

  // Proxy the caller's JSON-RPC request to the upstream node for the chain.
  // The RPC body arrives on request.payload (or request.query.body).
  async execute(request, supplier, _ctx) {
    const provider = this.providerFor(supplier.chain);
    if (!provider || !provider.url) return { status: 502, error: 'no_upstream_provider', chain: supplier.chain };
    const body = (request && (request.payload || (request.query && request.query.body))) || null;
    if (!body || typeof body !== 'object') return { status: 400, error: 'missing_json_rpc_body' };
    if (NON_IDEMPOTENT.has(body.method) && request && request.allowWrites !== true) {
      return { status: 403, error: 'write_method_disabled', method: body.method };
    }
    const res = await this.fetchFn(provider.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    let json = null;
    try { json = await res.json(); } catch { /* upstream returned non-JSON */ }
    return { status: res.status, body: json, method: body.method, servedBy: supplier.supplierId };
  }
}

function safeSupportedChains() {
  try { const c = getSupportedChains(); return Array.isArray(c) && c.length ? c : ['polygon']; }
  catch { return ['polygon']; }
}
