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

import crypto from 'crypto';
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
/**
 * G13: entitlement is a DISTINCT question from capacity (funds) — "is this
 * identity allowed to draw AT ALL right now" vs "does it have enough left".
 * A principal with zero authorizations, a revoked one, or one outside its
 * validity window is not entitled — checked and denied BEFORE any capacity/
 * funds arithmetic runs, with its own failure codes (no_authorization /
 * authorization_revoked / authorization_expired), never conflated with
 * insufficient_capacity (a capacity-layer code, see checkCapacity below).
 *
 * `authorizationId`, if given, restricts the check to that one row (see
 * enforceNew's own doc comment for why).
 */
async function checkEntitlement(db, principalId, nowMs, authorizationId = null) {
  if (!principalId) return { entitled: false, reason: 'no_authorization' };
  const { rows } = await db.query(
    `SELECT
       count(*) FILTER (WHERE state='active')                                          AS active_count,
       count(*) FILTER (WHERE state <> 'active')                                        AS nonactive_count,
       count(*) FILTER (WHERE state='active'
                        AND valid_after <= $2 AND valid_before >= $2
                        AND currency = $3)                                             AS in_window_count
     FROM authorizations
     WHERE principal_id = $1 AND ($4::text IS NULL OR id = $4)`,
    [principalId, nowMs, CAPACITY_CURRENCY, authorizationId],
  );
  const r = rows[0];
  const activeCount = Number(r.active_count);
  const inWindowCount = Number(r.in_window_count);
  if (activeCount === 0) {
    // Distinguish a REVOKED authorization from a never-authorized identity.
    // Both have zero active authorizations, but only the never-authorized case
    // may fall through to api_credits under 'new' mode. A principal whose
    // authorization was revoked (abuse response) must be a terminal deny — its
    // distinct code keeps it out of enforceCapacity's fallback, which triggers
    // ONLY on 'no_authorization'. Widening this to 'authorization_revoked' is
    // what closes the bypass (#333 exit-gate finding).
    if (Number(r.nonactive_count) > 0) {
      return { entitled: false, reason: 'authorization_revoked' };
    }
    return { entitled: false, reason: 'no_authorization' };
  }
  if (inWindowCount === 0) return { entitled: false, reason: 'authorization_expired' };
  return { entitled: true };
}

/**
 * The capacity (funds) layer — assumes entitlement was already checked (or,
 * for a caller like classifyCapacity/dual-mode that wants one combined
 * read, re-derives it from the same query it already ran). Distinct failure
 * code: insufficient_capacity, never conflated with an entitlement denial.
 */
function checkCapacity(availableMinor, cost) {
  if (availableMinor >= BigInt(cost)) {
    return { decision: 'allow', availableMinor, capReadMinor: availableMinor };
  }
  return { decision: 'deny', reason: 'insufficient_capacity', availableMinor };
}

/** Combined read-only classification (dual-mode evaluator + enforceNew's own
 * post-hoc "why did 0 rows update" diagnosis) — entitlement THEN capacity,
 * G13-separated internally even though this helper returns one decision. */
async function classifyCapacity(db, principalId, cost, nowMs, authorizationId = null) {
  const entitlement = await checkEntitlement(db, principalId, nowMs, authorizationId);
  if (!entitlement.entitled) return { decision: 'deny', reason: entitlement.reason };

  const { rows } = await db.query(
    `SELECT COALESCE(sum(cap_amount - consumed_amount) FILTER (
              WHERE state='active' AND valid_after <= $2 AND valid_before >= $2 AND currency = $3
            ), 0)::numeric AS available_minor
     FROM authorizations
     WHERE principal_id = $1 AND ($4::text IS NULL OR id = $4)`,
    [principalId, nowMs, CAPACITY_CURRENCY, authorizationId],
  );
  return checkCapacity(BigInt(rows[0].available_minor), cost);
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
// Default confirmations required before a settlement is CONFIRMED (gate M6
// clause 3 reads confirmed settlements only, never cap_amount or a pending
// one). Provisional pending the real settlement design (M6-b, deferred) —
// override with CAPACITY_SETTLEMENT_REQUIRED_CONFIRMATIONS once the actual
// settlement rail/chain is finalized.
function requiredConfirmations() {
  const raw = Number(process.env.CAPACITY_SETTLEMENT_REQUIRED_CONFIRMATIONS || '12');
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 12;
}

/**
 * M6 (a): capacity consumption must create a Draw — mirrors
 * libs/financial-domain/src/draw/draw.ts's requested→authorized→settling
 * transitions (Settlement created as a pending entity at beginSettlement)
 * collapsed into one synchronous write, the same raw-SQL-mirrors-the-TS-
 * domain pattern this module already follows for authorizations. The actual
 * on-chain settlement submission (M6-b) is a SEPARATE, later process (the
 * settlement-poller) that advances settling → submitted → confirming →
 * confirmed; creating the draw here does NOT submit anything on-chain.
 *
 * Best-effort, never breaks serving: the authorization UPDATE above is the
 * real, already-committed capacity decision (within the SAME transaction as
 * this insert, so if IT fails the whole draw is rolled back — no consumed
 * capacity without a Draw row, closing the M6 "draws=0" gap) — but if the
 * capacity account is missing (data-integrity gap, principal never
 * provisioned one), this throws and the caller rolls back and classifies it
 * as a hard failure rather than silently serving an untracked draw.
 */
async function insertDraw(client, { principalId, authorizationId, fundingSourceId, amountMinor, idempotencyKey, nowMs }) {
  const acct = await client.query(
    `SELECT id FROM accounts WHERE principal_id = $1 AND kind = 'capacity' AND currency = $2`,
    [principalId, CAPACITY_CURRENCY],
  );
  const accountId = acct.rows[0]?.id;
  if (!accountId) {
    throw new Error(`no capacity account for principal ${principalId} currency ${CAPACITY_CURRENCY}`);
  }
  const drawId = `draw_${idempotencyKey}`;
  await client.query(
    `INSERT INTO draws (id, principal_id, authorization_id, funding_source_id, account_id, amount, currency, idempotency_key, state, version, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'settling', 0, $9)
     ON CONFLICT (idempotency_key) DO NOTHING`,
    // draws.created_at is TIMESTAMPTZ since 009_ledger_txn_header (was BIGINT
    // epoch ms in 008); pass a Date, as shadow_draw_write.js already does.
    [drawId, principalId, authorizationId, fundingSourceId, accountId, String(amountMinor), CAPACITY_CURRENCY, idempotencyKey, new Date(nowMs)],
  );
  await client.query(
    `INSERT INTO settlements (draw_id, state, required_confirmations, confirmations, attempt_count)
     VALUES ($1, 'pending', $2, 0, 0)
     ON CONFLICT (draw_id) DO NOTHING`,
    [drawId, requiredConfirmations()],
  );
  return drawId;
}

async function enforceNew(db, { apiKey, wallet, cost, authorizationId = null, requestId = null }) {
  const principalId = await resolvePrincipalId(db, { apiKey, wallet });
  if (!principalId) {
    return { ok: false, code: 'no_authorization', http: 402, message: DENY_MSG.no_authorization };
  }
  const nowMs = Date.now();

  // G13: entitlement (is this identity allowed to draw at all) runs BEFORE
  // capacity (does it have enough left) — a distinct function, checked
  // first, on its own failure codes. The atomic UPDATE below re-validates
  // state/window in its WHERE clause regardless (defense in depth against
  // a revoke racing this check), so this is not a TOCTOU gap — it is a
  // fast, clean rejection for the common case (never entitled at all)
  // before spending a row-lock on a capacity arithmetic attempt.
  const entitlement = await checkEntitlement(db, principalId, nowMs, authorizationId);
  if (!entitlement.entitled) {
    const reason = entitlement.reason;
    return { ok: false, code: reason, http: DENY_HTTP[reason] || 402, message: DENY_MSG[reason] };
  }
  const client = await db.connect();
  let upd;
  try {
    await client.query('BEGIN');
    upd = await client.query(
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
        RETURNING id, cap_amount, consumed_amount, funding_source_id`,
      [principalId, String(cost), nowMs, CAPACITY_CURRENCY, authorizationId],
    );

    if ((upd.rowCount ?? 0) > 0) {
      const row = upd.rows[0];
      // idempotency_key: the RPC gateway's own request_id when supplied (one
      // request, one draw, matches revenue_events_v2.request_id); a random
      // fallback for any other caller so this never breaks on a missing id.
      const idempotencyKey = requestId || `auto_${crypto.randomUUID()}`;
      await insertDraw(client, {
        principalId, authorizationId: row.id, fundingSourceId: row.funding_source_id,
        amountMinor: cost, idempotencyKey, nowMs,
      });
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  if ((upd.rowCount ?? 0) > 0) {
    const row = upd.rows[0];
    const availableAfter = BigInt(row.cap_amount) - BigInt(row.consumed_amount);
    return {
      ok: true,
      tier: 'capacity',
      // T-23: never 0 — this IS the real per-call cost, in the same decimal-
      // dollar unit revenue_events_v2.amount_usdt uses everywhere else
      // (rpc_billing.js), converted from capacity's minor-unit accounting.
      cost: callCostMinor() / 1_000_000,
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
export async function enforceCapacity(db, { apiKey, wallet, requestId = null, product = 'rpc' }) {
  // Kill-switch source: the path is read from platform_flags (DB) via
  // getCapacityPath, not the CAPACITY_ENFORCEMENT_PATH env var, so an operator
  // can flip legacy⇄dual⇄new with a single row UPDATE and no redeploy
  // (≤10s propagation). getCapacityPath fails closed to 'legacy' on any DB
  // error and never throws, so the served decision is never made more
  // permissive by an infra fault. (enforcementPath() still reflects the env var
  // and is retained only for the /internal capacity_parity diagnostic report.)
  const path = await getCapacityPath(db);

  if (path === 'legacy') {
    return authorizeAndMeter(db, { apiKey, wallet, product });
  }

  if (path === 'new') {
    // T-23 (M6): the V1 waterfall, in this exact order —
    //   prepaid api_credits  →  authorization cap  →  HARD STOP (402)
    //
    // 1. Try prepaid FIRST. Any outcome that is NOT a clean allow (no
    //    account, inactive, daily limit hit, credits exhausted) falls
    //    through to the authorization layer — nothing was drawn on a
    //    failed/partial prepaid attempt (authorizeAndMeter's own atomic
    //    UPDATE only commits on success), so there is never a double-charge
    //    across the two layers.
    const prepaid = await authorizeAndMeter(db, { apiKey, wallet, product });
    if (prepaid.ok) return prepaid;
    // CONSOLE_ACCOUNTS_V1: an owner's control on the key (paused, scope,
    // spend cap, credit auto-use off) is a HARD STOP — it must never fall
    // through to the authorization layer and be served anyway.
    if (prepaid.terminal) return prepaid;

    // 2. Authorization cap. enforceNew's atomic UPDATE is the SOLE decision
    //    point — no separate "is there capacity" read happens here, so this
    //    can never disagree with what it actually drew.
    const verdict = await enforceNew(db, { apiKey, wallet, cost: callCostMinor(), requestId });
    if (verdict.ok) return verdict;

    // 3. HARD STOP. Both layers denied — surface the authorization-layer
    //    verdict: capacity_enforcement.js is the primary gate under 'new'
    //    mode, and its denial codes/messages point at the specific fix
    //    ("sign an authorization" / "insufficient capacity") rather than a
    //    generic account-not-found. NOTE (intentional, not an oversight):
    //    unlike the pre-T-23 order, a REVOKED authorization no longer
    //    implicitly blocks a principal's separate, independently-funded
    //    prepaid account — prepaid is checked on its own merits, first, per
    //    the stated waterfall order; revocation is scoped to the one
    //    authorization it names.
    return verdict;
  }

  // dual: evaluate both, time both, SERVE LEGACY, record parity.
  const cost = callCostMinor();
  const t0 = hrMs();
  const legacy = await authorizeAndMeter(db, { apiKey, wallet, product });
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
export const __internal = { resolvePrincipalId, classifyCapacity, checkEntitlement, enforceNew, callCostMinor };
