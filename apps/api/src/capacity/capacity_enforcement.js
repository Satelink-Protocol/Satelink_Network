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
//   no_authorization | insufficient_capacity | authorization_expired | authorization_revoked
//
// Nonces are settlement events, never call events (see libs/CLAUDE.md M8 frozen
// decision): per-call metering compares consumed_amount + cost against
// cap_amount and touches no nonce. This module mirrors the tested TS domain
// (services/financial getCapacity) in raw SQL, the same pattern as
// shadow_ledger_write.js — it does NOT import apps/api/src/payments/.

import { authorizeAndMeter } from '../billing/credit_service.mjs';
import { parityRecorder } from './parity_recorder.js';
import { getCapacityPath } from '../lib/flags.js';

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
 *
 * `authorizationId`, if given, restricts the aggregate to that one
 * authorization — so a targeted enforceNew() draw (see authorizationId
 * there) gets a denial reason scoped to the row it actually tried to draw
 * from, not the principal's other, untargeted authorizations.
 */
async function classifyCapacity(db, principalId, cost, nowMs, authorizationId = null) {
  if (!principalId) return { decision: 'deny', reason: 'no_authorization' };
  const { rows } = await db.query(
    `SELECT
       count(*) FILTER (WHERE state='active')                                          AS active_count,
       count(*) FILTER (WHERE state <> 'active')                                        AS nonactive_count,
       count(*) FILTER (WHERE state='active'
                        AND valid_after <= $2 AND valid_before >= $2
                        AND currency = $3)                                             AS in_window_count,
       COALESCE(sum(cap_amount - consumed_amount) FILTER (
                        WHERE state='active'
                        AND valid_after <= $2 AND valid_before >= $2
                        AND currency = $3), 0)::numeric                                AS available_minor
     FROM authorizations
     WHERE principal_id = $1 AND ($4::text IS NULL OR id = $4)`,
    [principalId, nowMs, CAPACITY_CURRENCY, authorizationId],
  );
  const r = rows[0];
  const activeCount = Number(r.active_count);
  const inWindowCount = Number(r.in_window_count);
  const availableMinor = BigInt(r.available_minor);
  if (activeCount === 0) {
    // Distinguish a REVOKED authorization from a never-authorized identity.
    // Both have zero active authorizations, but only the never-authorized case
    // may fall through to api_credits under 'new' mode. A principal whose
    // authorization was revoked (abuse response) must be a terminal deny — its
    // distinct code keeps it out of enforceCapacity's fallback, which triggers
    // ONLY on 'no_authorization'. Widening this to 'authorization_revoked' is
    // what closes the bypass (#333 exit-gate finding).
    if (Number(r.nonactive_count) > 0) {
      return { decision: 'deny', reason: 'authorization_revoked' };
    }
    return { decision: 'deny', reason: 'no_authorization' };
  }
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

const DENY_HTTP = {
  no_authorization: 402,
  insufficient_capacity: 402,
  authorization_expired: 402,
  authorization_revoked: 402,
};
const DENY_MSG = {
  no_authorization:
    'No active capacity authorization for this identity. Sign an EIP-3009 authorization to fund capacity.',
  insufficient_capacity:
    'Capacity exhausted for this authorization. Sign a new authorization or increase the cap.',
  authorization_expired:
    'Your capacity authorization is outside its validity window. Sign a new authorization.',
  authorization_revoked:
    'Your capacity authorization has been revoked. This identity cannot draw capacity.',
};

/**
 * Authoritative new-path enforcement (`new` mode). Atomically draws `cost`
 * against one active, in-window authorization with sufficient remaining
 * capacity. The UPDATE is the decision; on 0 rows we classify the precise
 * denial reason. Returns a verdict shaped like authorizeAndMeter's.
 *
 * Selection order: soonest-expiring first (valid_before ASC), same primary
 * key as CapacitySelector's nonce selection (libs/financial-domain/src/
 * authorization/capacity-selector.ts). Ties on valid_before — which M9's
 * multi-authorization-per-principal designs can produce — break on id ASC,
 * mirroring both CapacitySelector's lexicographic-by-identifier nonce
 * tiebreak and postgres-authorization-repository.ts's existing
 * `ORDER BY id`. This makes selection fully deterministic for a given
 * clock and authorization set (issue #322).
 *
 * `authorizationId`, if given, constrains the draw to that one row —
 * for tests and diagnostics that need to target a specific authorization
 * without hand-writing SQL (previously done ad hoc during the M8 exit
 * gate). Production callers never pass it; enforceCapacity's public
 * signature is unchanged.
 */
async function enforceNew(db, { apiKey, wallet, cost, authorizationId = null }) {
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
           AND ($5::text IS NULL OR id = $5)
         ORDER BY valid_before ASC, id ASC
         LIMIT 1
         FOR UPDATE SKIP LOCKED
      )
      RETURNING id, cap_amount, consumed_amount`,
    [principalId, String(cost), nowMs, CAPACITY_CURRENCY, authorizationId],
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
  const cls = await classifyCapacity(db, principalId, cost, nowMs, authorizationId);
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
  // Kill-switch source: the path is read from platform_flags (DB) via
  // getCapacityPath, not the CAPACITY_ENFORCEMENT_PATH env var, so an operator
  // can flip legacy⇄dual⇄new with a single row UPDATE and no redeploy
  // (≤10s propagation). getCapacityPath fails closed to 'legacy' on any DB
  // error and never throws, so the served decision is never made more
  // permissive by an infra fault. (enforcementPath() still reflects the env var
  // and is retained only for the /internal capacity_parity diagnostic report.)
  const path = await getCapacityPath(db);

  if (path === 'legacy') {
    return authorizeAndMeter(db, { apiKey, wallet });
  }

  if (path === 'new') {
    const verdict = await enforceNew(db, { apiKey, wallet, cost: callCostMinor() });
    // api_credits fallback: an identity with NO capacity authorization at all
    // (code 'no_authorization' — either no matching principal, or a principal
    // with zero active authorizations) is not an authorization-backed account,
    // so it falls through to the legacy api_credits path. Without this, a global
    // 'new' flip 402s every existing api_credits account (M9 exit-gate finding,
    // 2026-08-21). enforceNew's UPDATE matches 0 rows in this case, so nothing
    // was drawn — there is no double-charge before authorizeAndMeter runs.
    //
    // Genuine capacity denials on an authorization-backed account
    // (insufficient_capacity / authorization_expired) are REAL and returned
    // as-is — they must never silently draw api_credits instead.
    if (!verdict.ok && verdict.code === 'no_authorization') {
      return authorizeAndMeter(db, { apiKey, wallet });
    }
    return verdict;
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
