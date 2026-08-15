// apps/api/src/capacity/capacity_enforcement.js
//
// M8 capacity enforcement cutover. The RPC gateway's authorize-and-meter call
// site is wrapped by enforceCapacity(), which dispatches on the request-time
// env CAPACITY_ENFORCEMENT_PATH so a Railway env flip reverts instantly with NO
// redeploy:
//
//   legacy (default) — api_credits authorizeAndMeter, unchanged.
//   dual             — evaluate BOTH paths, SERVE LEGACY, record both, log
//                      disagreements. The new-path eval here is READ-ONLY: it
//                      never decrements. This is the safety property that makes
//                      the cutover reversible.
//   new              — the atomic consumed_amount decrement IS the decision.
//
// Denial reasons are distinct and machine-readable and never conflated:
//   no_authorization | insufficient_capacity | authorization_expired
//
// Nonces are settlement events, never call events (see libs/CLAUDE.md M8 frozen
// decision): per-call metering compares consumed_amount + cost against
// cap_amount and touches no nonce. This module mirrors the tested TS domain
// (services/financial getCapacity) in raw SQL, the same pattern as
// shadow_ledger_write.js — it does NOT import apps/api/src/payments/.

import { authorizeAndMeter } from '../billing/credit_service.mjs';
import { parityRecorder } from './parity_recorder.js';

const CAPACITY_CURRENCY = 'USDC';

/** Per-call capacity cost in USDC minor units (6 decimals). Default 30 = the
 * $0.00003 flat RPC price. Read at request time. */
function callCostMinor() {
  const raw = Number(process.env.CAPACITY_CALL_COST_MINOR || '30');
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 30;
}

export function enforcementPath() {
  const v = (process.env.CAPACITY_ENFORCEMENT_PATH || 'legacy').toLowerCase();
  return v === 'dual' || v === 'new' ? v : 'legacy';
}

/** Resolve the principal id for the request identity via external_ref. A
 * wallet-signed authorization stores external_ref = lower(wallet); an api-key
 * principal stores external_ref = the key. Wallet takes precedence. */
async function resolvePrincipalId(db, { apiKey, wallet }) {
  const candidates = [];
  if (wallet) candidates.push(String(wallet).toLowerCase());
  if (apiKey) candidates.push(String(apiKey));
  if (candidates.length === 0) return null;
  const { rows } = await db.query(
    `SELECT id FROM principals WHERE external_ref = ANY($1::text[]) LIMIT 1`,
    [candidates],
  );
  return rows[0]?.id ?? null;
}

/**
 * Classify a principal's capacity for `cost` at `nowMs` WITHOUT mutating
 * anything. Returns a distinct decision + reason.
 */
async function classifyCapacity(db, principalId, cost, nowMs) {
  if (!principalId) return { decision: 'deny', reason: 'no_authorization' };
  const { rows } = await db.query(
    `SELECT
       count(*) FILTER (WHERE state='active')                                          AS active_count,
       count(*) FILTER (WHERE state='active'
                        AND valid_after <= $2 AND valid_before >= $2
                        AND currency = $3)                                             AS in_window_count,
       COALESCE(sum(cap_amount - consumed_amount) FILTER (
                        WHERE state='active'
                        AND valid_after <= $2 AND valid_before >= $2
                        AND currency = $3), 0)::numeric                                AS available_minor
     FROM authorizations
     WHERE principal_id = $1`,
    [principalId, nowMs, CAPACITY_CURRENCY],
  );
  const r = rows[0];
  const activeCount = Number(r.active_count);
  const inWindowCount = Number(r.in_window_count);
  const availableMinor = BigInt(r.available_minor);
  if (activeCount === 0) return { decision: 'deny', reason: 'no_authorization' };
  if (inWindowCount === 0) return { decision: 'deny', reason: 'authorization_expired' };
  if (availableMinor >= BigInt(cost)) {
    return { decision: 'allow', availableMinor, capReadMinor: availableMinor };
  }
  return { decision: 'deny', reason: 'insufficient_capacity', availableMinor };
}

/** Read-only new-path evaluation used in `dual` mode (never decrements). */
async function evaluateNewReadOnly(db, { apiKey, wallet, cost }) {
  const principalId = await resolvePrincipalId(db, { apiKey, wallet });
  return classifyCapacity(db, principalId, cost, Date.now());
}

const DENY_HTTP = { no_authorization: 402, insufficient_capacity: 402, authorization_expired: 402 };
const DENY_MSG = {
  no_authorization:
    'No active capacity authorization for this identity. Sign an EIP-3009 authorization to fund capacity.',
  insufficient_capacity:
    'Capacity exhausted for this authorization. Sign a new authorization or increase the cap.',
  authorization_expired:
    'Your capacity authorization is outside its validity window. Sign a new authorization.',
};

/**
 * Authoritative new-path enforcement (`new` mode). Atomically draws `cost`
 * against one active, in-window authorization with sufficient remaining
 * capacity. The UPDATE is the decision; on 0 rows we classify the precise
 * denial reason. Returns a verdict shaped like authorizeAndMeter's.
 */
async function enforceNew(db, { apiKey, wallet, cost }) {
  const principalId = await resolvePrincipalId(db, { apiKey, wallet });
  if (!principalId) {
    return { ok: false, code: 'no_authorization', http: 402, message: DENY_MSG.no_authorization };
  }
  const nowMs = Date.now();
  const upd = await db.query(
    `UPDATE authorizations
        SET consumed_amount = consumed_amount + $2
      WHERE id = (
        SELECT id FROM authorizations
         WHERE principal_id = $1 AND state = 'active' AND currency = $4
           AND valid_after <= $3 AND valid_before >= $3
           AND cap_amount - consumed_amount >= $2
         ORDER BY valid_before ASC
         LIMIT 1
         FOR UPDATE SKIP LOCKED
      )
      RETURNING id, cap_amount, consumed_amount`,
    [principalId, String(cost), nowMs, CAPACITY_CURRENCY],
  );

  if ((upd.rowCount ?? 0) > 0) {
    const row = upd.rows[0];
    const availableAfter = BigInt(row.cap_amount) - BigInt(row.consumed_amount);
    return {
      ok: true,
      tier: 'capacity',
      cost: 0, // capacity draw is recorded on the authorization, not as USDT revenue (M8)
      limit: row.cap_amount,
      remaining: availableAfter.toString(),
      balanceAfter: availableAfter.toString(),
      creditSource: 'authorization',
      authorizationId: row.id,
    };
  }

  // 0 rows updated — classify why, so the reason is never conflated.
  const cls = await classifyCapacity(db, principalId, cost, nowMs);
  const reason = cls.reason || 'insufficient_capacity';
  return { ok: false, code: reason, http: DENY_HTTP[reason] || 402, message: DENY_MSG[reason] };
}

function verdictToDecision(verdict) {
  if (verdict.ok) return { decision: 'allow' };
  return { decision: 'deny', reason: verdict.code };
}

function hrMs() {
  return Number(process.hrtime.bigint() / 1000n) / 1000; // microseconds → ms, 3dp
}

/**
 * Drop-in replacement for `authorizeAndMeter(db, { apiKey, wallet })` at the RPC
 * gateway call site. Behaviour depends on CAPACITY_ENFORCEMENT_PATH, read here
 * so a Railway env change reverts with no redeploy.
 */
export async function enforceCapacity(db, { apiKey, wallet }) {
  const path = enforcementPath();

  if (path === 'legacy') {
    return authorizeAndMeter(db, { apiKey, wallet });
  }

  if (path === 'new') {
    return enforceNew(db, { apiKey, wallet, cost: callCostMinor() });
  }

  // dual: evaluate both, time both, SERVE LEGACY, record parity.
  const cost = callCostMinor();
  const t0 = hrMs();
  const legacy = await authorizeAndMeter(db, { apiKey, wallet });
  const legacyMs = hrMs() - t0;

  const t1 = hrMs();
  let neu;
  try {
    neu = await evaluateNewReadOnly(db, { apiKey, wallet, cost });
  } catch (err) {
    // A new-path evaluation failure must never affect the served (legacy)
    // decision. Record it as a distinct disagreement bucket and move on.
    neu = { decision: 'deny', reason: `eval_error:${err.message}` };
  }
  const newMs = hrMs() - t1;

  try {
    parityRecorder.record(verdictToDecision(legacy), neu, legacyMs, newMs);
  } catch {
    /* recorder must never break serving */
  }

  return legacy; // always serve the legacy decision in dual mode
}

// Exposed for tests / diagnostics.
export const __internal = { resolvePrincipalId, classifyCapacity, enforceNew, callCostMinor };
