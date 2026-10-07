// Service ports for the /v1/trading API (Stage 24) and adapters onto the real Stage 13–19
// services. The router only knows the port methods; the composition root builds them with
// createServicePorts(). Every adapter takes the AUTHENTICATED principal and enforces ownership
// itself (a foreign resource is NOT_FOUND — no cross-tenant existence leak). Ports whose backing
// read model does not exist yet answer 501 NOT_IMPLEMENTED (never guessed data):
//   orders.list (no OMS listing by principal), proposals.* (review queue = B-02).
import { ApiError, notImplemented } from './errors.mjs';
import { transition } from '../oms/transitions.mjs';
import { OmsState, stateOf, canTransition } from '../oms/states.mjs';

const actorOf = (p) => Object.freeze({ principalId: p.principalId, kind: 'human', role: 'user' });
const notFound = () => new ApiError(404, 'NOT_FOUND', 'not found');
const must = (cond) => { if (!cond) throw notFound(); };
const strOrNull = (v) => (typeof v === 'string' && v.length ? v : null);

/**
 * @param d.strategyService, d.strategyStore            Stage 13
 * @param d.backtestJobs, d.backtestStore                Stage 14
 * @param d.riskPolicyService, d.killSwitchService       Stage 15
 * @param d.mandateService, d.mandateStore               Stage 16
 * @param d.acceptance, d.omsStore                       Stage 17
 * @param d.portfolio                                    Stage 18 PortfolioReadService
 * @param d.receipts                                     Stage 19 TradeReceiptAssembler
 * @param d.proposals                                    optional review queue (B-02) { list, approve, reject }
 * @param d.machine                                      optional machine / agent interface (access/interface.mjs)
 */
export function createServicePorts(d) {
  const ownStrategy = async (p, strategyId) => { const s = await d.strategyStore.getStrategy(strategyId); must(s && s.principalId === p.principalId); return s; };
  const ownVersion = async (p, versionId) => { const v = await d.strategyStore.getVersion(versionId); must(v); await ownStrategy(p, v.strategyId); return v; };

  return Object.freeze({
    strategies: {
      create: async (p, b) => d.strategyService.createStrategy({ actor: actorOf(p), name: b?.name, description: strOrNull(b?.description) }),
      addVersion: async (p, strategyId, b) => { await ownStrategy(p, strategyId); return d.strategyService.createVersion({ actor: actorOf(p), strategyId, dsl: b?.dsl }); },
      getVersion: async (p, versionId) => { await ownVersion(p, versionId); return d.strategyService.getVersion(versionId); },
      transition: async (p, versionId, b) => { await ownVersion(p, versionId); return d.strategyService.transition({ actor: actorOf(p), versionId, to: b?.to, expectedFrom: b?.expectedFrom, evidence: b?.evidence ?? {} }); },
    },
    backtests: {
      enqueue: async (p, b) => { await ownVersion(p, b?.strategyVersionId); return d.backtestJobs.enqueue({ principalId: p.principalId, strategyVersionId: b.strategyVersionId, fromMs: b.fromMs, toMs: b.toMs, params: b.params }); },
      get: async (p, id) => { const r = await d.backtestStore.get(id); must(r && r.principalId === p.principalId); return r; },
    },
    risk: {
      activePolicy: async (p) => d.riskPolicyService.activePolicy(p.principalId, null),
      createVersion: async (p, b) => d.riskPolicyService.createVersion({ actor: actorOf(p), principalId: p.principalId, mandateId: strOrNull(b?.mandateId), draft: b?.draft }),
    },
    killSwitch: {
      engaged: async (p) => d.killSwitchService.engaged(p.principalId),
      // Users act on their own scopes only (principal / broker_account / mandate / strategy); the
      // Stage 15 permission check refuses anything else (global is admin-only).
      engage: async (p, b) => d.killSwitchService.engage({ actor: actorOf(p), scopeType: b?.scopeType ?? 'principal', scopeId: b?.scopeType && b.scopeType !== 'principal' ? strOrNull(b.scopeId) : p.principalId, principalId: p.principalId, reason: b?.reason }),
      release: async (p, b) => d.killSwitchService.release({ actor: actorOf(p), scopeType: b?.scopeType ?? 'principal', scopeId: b?.scopeType && b.scopeType !== 'principal' ? strOrNull(b.scopeId) : p.principalId, principalId: p.principalId, reason: b?.reason }),
    },
    mandates: {
      propose: async (p, b) => d.mandateService.propose({ actor: actorOf(p), principalId: p.principalId, draft: b?.draft, supersedes: strOrNull(b?.supersedes) }),
      get: async (p, id) => { const m = await d.mandateStore.getMandate(id); must(m && m.principalId === p.principalId); return m; },
      sign: async (p, id, b, code, request) => d.mandateService.sign({ actor: actorOf(p), mandateId: id, termsHash: b?.termsHash, nonce: b?.nonce, code, request }),
      revoke: async (p, id, b) => { const m = await d.mandateStore.getMandate(id); must(m && m.principalId === p.principalId); return d.mandateService.revoke({ actor: actorOf(p), mandateId: id, reason: b?.reason }); },
    },
    orders: {
      list: async () => { throw notImplemented('listing orders'); },
      // Manual order intent → the Stage 17 acceptance path (mandate + risk checks). The OMS
      // idempotency key is derived from the HTTP Idempotency-Key, scoped to the principal.
      accept: async (p, b, idempotencyKey) => d.acceptance.accept({
        idempotencyKey: `api_${p.principalId}_${idempotencyKey}`.slice(0, 128), principalId: p.principalId, origin: 'manual', approvedBy: p.principalId,
        brokerAccountId: b?.brokerAccountId, mandateId: b?.mandateId, mode: b?.mode, venue: b?.venue, instrument: b?.instrument, side: b?.side, type: b?.type,
        timeInForce: b?.timeInForce, quantity: b?.quantity, limitPrice: b?.limitPrice,
      }),
      get: async (p, id) => { const o = await d.omsStore.getOrder(id); must(o && o.principalId === p.principalId); return o; },
      // Cancelling moves the order to CANCEL_REQUESTED through the Stage 17 transition (CAS +
      // order_events row naming the user); the reconciler performs the venue cancel.
      requestCancel: async (p, id) => {
        const o = await d.omsStore.getOrder(id);
        must(o && o.principalId === p.principalId);
        if (!canTransition(stateOf(o.status), OmsState.CANCEL_REQUESTED)) throw new ApiError(409, 'CONFLICT', `order in status ${o.status} cannot be cancelled`);
        const next = await transition(d.omsStore, o, OmsState.CANCEL_REQUESTED, { actor: `user:${p.principalId}`, at: d.clock ? d.clock().getTime() : Date.now(), eventType: 'cancel_requested', payload: { via: 'api' } });
        if (!next) throw new ApiError(409, 'CONFLICT', 'order changed concurrently; retry');
        return d.omsStore.getOrder(id);
      },
    },
    receipts: { explain: async (p, orderId) => d.receipts.explainOrder({ principalId: p.principalId, orderId }) },
    portfolio: {
      positions: async (p, q) => d.portfolio.positions(p.principalId, { brokerAccountId: strOrNull(q?.brokerAccountId), mode: strOrNull(q?.mode) }),
      snapshots: async (p, q) => d.portfolio.snapshots(p.principalId, { brokerAccountId: strOrNull(q?.brokerAccountId), limit: Math.min(Number(q?.limit ?? 50) || 50, 200) }),
    },
    proposals: d.proposals ?? {
      list: async () => { throw notImplemented('the proposal review queue (B-02)'); },
      approve: async () => { throw notImplemented('the proposal review queue (B-02)'); },
      reject: async () => { throw notImplemented('the proposal review queue (B-02)'); },
    },
    agent: d.machine ?? {
      evaluate: async () => { throw notImplemented('the machine / agent interface'); },
      propose: async () => { throw notImplemented('the machine / agent interface'); },
      receipt: async () => { throw notImplemented('the machine / agent interface'); },
    },
  });
}
