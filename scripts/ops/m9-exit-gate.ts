#!/usr/bin/env -S npx tsx
/**
 * M9 Exit Gate Driver — 72-hour 5,000+ call endurance test.
 *
 * Operates on a PRE-REGISTERED schedule (Steps 2/3 must have already run).
 *
 * Required env:
 *   SCHEDULE_ID         — the schedule_id returned by m9-register-schedule.ts
 *   API_BASE            — production API base (e.g. https://api.satelink.network)
 *   RECONCILER          — reconciler base URL
 *   INTERNAL_TOKEN      — internal auth token for /internal/* endpoints
 *   DATABASE_URL        — Postgres connection string (for any DB ops)
 *
 * The signer private key comes from the M9_DRIVER_SIGNER_KEY env var if set
 *   (Railway service execution, where the macOS Keychain is unavailable), else
 *   the macOS Keychain (service=satelink-m9-signer, account=m9-schedule-signer)
 *   for laptop runs. It is NEVER printed, logged, or written to any file.
 *
 * Asserts:
 *   - RPC status === 200 on every call (aborts with body on non-200)
 *   - Sample failures are HARD failures (no fail-open fallbacks)
 *   - total_consumed <= total_capacity
 *   - current_authorization.remaining decreases monotonically within each auth lifecycle
 *     (NOT across nonce transitions, where remaining legitimately jumps up)
 *   - drift_minor_units === 0 on every sample & reconciler not halted
 *   - nonces.signed === 5 throughout
 *   - At least one refill transition occurs (refill_events.length > initialRefillCount)
 *
 * Produces one evidence log: logs/m9_exit_gate_evidence.jsonl
 */

import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { privateKeyToAccount } from 'viem/accounts';

function readSignerKey(): string {
  // Prefer an injected env secret (Railway service execution, where the macOS
  // Keychain is unavailable); fall back to the local Keychain for laptop runs.
  // Validated below; never printed, logged, or written to a file either way.
  const rawSource =
    process.env.M9_DRIVER_SIGNER_KEY ??
    execSync(
      'security find-generic-password -s "satelink-m9-signer" -a "m9-schedule-signer" -w',
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    );
  const raw = rawSource.trim();
  const pk = raw.startsWith('0x') ? raw : `0x${raw}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(pk)) {
    console.error('ERROR: signer key (M9_DRIVER_SIGNER_KEY env or Keychain satelink-m9-signer/m9-schedule-signer) is not a valid 0x<64 hex> private key.');
    process.exit(1);
  }
  return pk;
}

async function main() {
  // M9 separation: sign (Step 2) and register (Step 3) are run as separate
  // explicit CLI steps. The exit-gate receives schedule_id via M9_SCHEDULE_ID
  // env and validates/drives only — it does not re-sign or re-register.
  // (Env var is named SCHEDULE_ID in this script.)
  const scheduleId = process.env.SCHEDULE_ID;
  if (!scheduleId) {
    console.error('ERROR: SCHEDULE_ID is not set. Run m9-register-schedule.ts first and pass the schedule_id.');
    process.exit(1);
  }

  const apiBase = process.env.API_BASE || 'https://api.satelink.network';
  const reconcilerUrl = process.env.RECONCILER || 'https://satelink-reconciler-production.up.railway.app';
  const internalToken = process.env.INTERNAL_TOKEN || '';
  const durationHours = Number(process.env.DURATION_HOURS || '72');
  const totalCalls = 5000;

  console.log(`=== M9 Exit Gate Driver ===`);
  console.log(`Schedule:   ${scheduleId}`);
  console.log(`Duration:   ${durationHours} hours`);
  console.log(`Calls:      ${totalCalls}`);
  console.log(`Pacing:     1 call every ${((durationHours * 3600) / totalCalls).toFixed(1)} seconds`);

  // 1. Read signer key from M9_DRIVER_SIGNER_KEY env (Railway) or macOS Keychain
  //    (laptop). Never printed, logged, or written to a file.
  const pk = readSignerKey();
  const account = privateKeyToAccount(pk as `0x${string}`);
  console.log(`\n[1] Using existing funded signer: ${account.address}`);

  // 2. Run the 5000 call loop against pre-registered schedule
  console.log(`\n[2] Entering ${durationHours}-hour endurance loop...`);
  const logDir = path.join(process.cwd(), 'logs');
  fs.mkdirSync(logDir, { recursive: true });
  const logPath = path.join(logDir, 'm9_exit_gate_evidence.jsonl');
  const logFile = fs.openSync(logPath, 'a');
  console.log(`    Evidence log: ${logPath}\n`);

  const intervalMs = (durationHours * 3600 * 1000) / totalCalls;
  let lastAuthId: string | null = null;
  let lastAuthRemaining: bigint | null = null;

  let initialRefillCount = 0;
  let hasTransitioned = false;

  for (let i = 1; i <= totalCalls; i++) {
    const cycleStart = Date.now();

    // a. Make RPC Call via /rpc/base (consumes capacity via wallet-header path)
    const rpcRes = await fetch(`${apiBase}/rpc/base`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-wallet-address': account.address },
      body: JSON.stringify({ jsonrpc: '2.0', id: i, method: 'eth_blockNumber', params: [] })
    });

    // A2: Assert rpc_status === 200, abort on first non-200 with full response body
    if (rpcRes.status !== 200) {
      const errorBody = await rpcRes.text();
      const errMsg = `FATAL: RPC call ${i} failed with status HTTP ${rpcRes.status}. Body: ${errorBody}`;
      console.error(`\n❌ ${errMsg}`);
      fs.writeSync(logFile, JSON.stringify({ error: errMsg, timestamp: new Date().toISOString() }) + '\n');
      process.exit(1);
    }
    const rpcStatus = rpcRes.status;

    // b. Sample available-balance (A1: HARD FAILURE if sample fails)
    const recRes = await fetch(`${reconcilerUrl}/internal/recurring`, {
      headers: { 'x-internal-token': internalToken }
    });
    if (!recRes.ok) {
      const errText = await recRes.text();
      const err = `FATAL: Sample /internal/recurring failed HTTP ${recRes.status}: ${errText}`;
      console.error(`\n❌ ${err}`);
      fs.writeSync(logFile, JSON.stringify({ error: err, timestamp: new Date().toISOString() }) + '\n');
      process.exit(1);
    }
    const recurringBody = await recRes.json();
    const sched = recurringBody.schedules?.find((s: any) => s.schedule_id === scheduleId);
    if (!sched) {
      const err = `FATAL: Schedule ${scheduleId} not found in /internal/recurring report!`;
      console.error(`\n❌ ${err}`);
      fs.writeSync(logFile, JSON.stringify({ error: err, timestamp: new Date().toISOString() }) + '\n');
      process.exit(1);
    }

    const totalRemainingStr = sched.total_remaining;
    const capacityStr = sched.total_capacity;
    const consumedStr = sched.total_consumed;
    const signedCount = sched.nonces?.signed;
    const refillEvents = sched.refill_events || [];
    const currentAuth = sched.current_authorization;

    if (i === 1) {
      initialRefillCount = refillEvents.length;
    }

    // Transition assertion: refill_events.length > initialRefillCount alone
    if (refillEvents.length > initialRefillCount) {
      hasTransitioned = true;
    }

    // c. Sample reconciler drift (A1: HARD FAILURE if sample fails)
    const driftRes = await fetch(`${reconcilerUrl}/internal/reconciliation`, {
      headers: { 'x-internal-token': internalToken }
    });
    if (!driftRes.ok) {
      const errText = await driftRes.text();
      const err = `FATAL: Sample /internal/reconciliation failed HTTP ${driftRes.status}: ${errText}`;
      console.error(`\n❌ ${err}`);
      fs.writeSync(logFile, JSON.stringify({ error: err, timestamp: new Date().toISOString() }) + '\n');
      process.exit(1);
    }
    const driftBody = await driftRes.json();
    // FIX: drift_minor_units comes from the reconciler as a string "0", not
    // numeric 0. Without this coerce, invariant-3 always fires as false positive.
    const driftMinorRaw = driftBody.drift_minor_units;
    const driftMinor = Number(driftMinorRaw);    // reconciler returns string "0", coerce to number
    const halted = driftBody.halted;

    // d. Invariant Assertions
    const totalRemaining = BigInt(totalRemainingStr);
    const capacity = BigInt(capacityStr);
    const consumed = BigInt(consumedStr);

    // Invariant 1: consumed never exceeds total_capacity
    if (consumed > capacity) {
      const err = `FATAL INVARIANT VIOLATION: consumed (${consumed}) > capacity (${capacity})`;
      console.error(`\n❌ ${err}`);
      fs.writeSync(logFile, JSON.stringify({ error: err, timestamp: new Date().toISOString() }) + '\n');
      process.exit(1);
    }

    // Invariant 2: current authorization remaining decreases monotonically WITHIN each auth lifecycle
    // On nonce transition (auth N exhausted → auth N+1), remaining legitimately jumps UP.
    // We reset tracking whenever the auth ID changes.
    if (currentAuth) {
      const authRemaining = BigInt(currentAuth.remaining);
      if (lastAuthId === currentAuth.id && lastAuthRemaining !== null) {
        if (authRemaining > lastAuthRemaining) {
          const err = `FATAL INVARIANT VIOLATION: auth ${currentAuth.id} remaining increased from ${lastAuthRemaining} to ${authRemaining}`;
          console.error(`\n❌ ${err}`);
          fs.writeSync(logFile, JSON.stringify({ error: err, timestamp: new Date().toISOString() }) + '\n');
          process.exit(1);
        }
      }
      if (lastAuthId !== currentAuth.id) {
        // Nonce transition: reset per-auth tracking
        lastAuthId = currentAuth.id;
        lastAuthRemaining = authRemaining;
      } else {
        lastAuthRemaining = authRemaining;
      }
    }

    // Invariant 3: drift_minor_units === 0 on every sample (coerced to number)
    if (driftMinor !== 0) {
      const err = `FATAL INVARIANT VIOLATION: reconciler drift is ${driftMinorRaw} (expected 0)`;
      console.error(`\n❌ ${err}`);
      fs.writeSync(logFile, JSON.stringify({ error: err, timestamp: new Date().toISOString() }) + '\n');
      process.exit(1);
    }

    // Invariant 4: Reconciler not halted
    if (halted) {
      const err = `FATAL INVARIANT VIOLATION: reconciler is halted!`;
      console.error(`\n❌ ${err}`);
      fs.writeSync(logFile, JSON.stringify({ error: err, timestamp: new Date().toISOString() }) + '\n');
      process.exit(1);
    }

    // Invariant 5: schedule stays at exactly 5 authorizations for the full run
    if (signedCount !== 5) {
      const err = `FATAL INVARIANT VIOLATION: signed nonces count is ${signedCount} (expected 5)`;
      console.error(`\n❌ ${err}`);
      fs.writeSync(logFile, JSON.stringify({ error: err, timestamp: new Date().toISOString() }) + '\n');
      process.exit(1);
    }

    // Log evidence
    const evidence = {
      call: i,
      timestamp: new Date().toISOString(),
      rpc_status: rpcStatus,
      total_remaining: totalRemainingStr,
      total_capacity: capacityStr,
      total_consumed: consumedStr,
      current_auth_id: currentAuth?.id ?? null,
      current_auth_remaining: currentAuth?.remaining ?? null,
      signed_nonces: signedCount,
      refill_events_count: refillEvents.length,
      drift_minor_units: driftMinor,
      drift_halted: halted
    };
    fs.writeSync(logFile, JSON.stringify(evidence) + '\n');

    if (i % 10 === 0 || i === 1) {
      console.log(`    [${new Date().toISOString()}] Call ${i}/${totalCalls} | RPC: ${rpcStatus} | Remaining: ${totalRemainingStr} | Auth: ${currentAuth?.id ?? 'none'} | Drift: ${driftMinor}`);
    }

    // e. Sleep until next cycle
    const elapsed = Date.now() - cycleStart;
    const sleepTime = Math.max(0, intervalMs - elapsed);
    if (i < totalCalls && sleepTime > 0) {
      await new Promise(r => setTimeout(r, sleepTime));
    }
  }

  // A4 assertion: assert at least one refill transition occurred during the run
  if (!hasTransitioned) {
    const err = `FATAL INVARIANT VIOLATION: No refill_events transition occurred during the test run! (refill_events count did not increase from initial ${initialRefillCount})`;
    console.error(`\n❌ ${err}`);
    fs.writeSync(logFile, JSON.stringify({ error: err, timestamp: new Date().toISOString() }) + '\n');
    process.exit(1);
  }

  console.log(`\n=== Exit Gate Test Completed Successfully! ===`);
  console.log(`Refill transition verified: ${hasTransitioned}`);
  console.log(`Evidence saved to ${logPath}`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
