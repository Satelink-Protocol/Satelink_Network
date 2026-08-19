#!/usr/bin/env -S npx tsx
/**
 * M9 Exit Gate Driver — 72-hour 5,000+ call endurance test.
 *
 * Requirements:
 * - Existing funded wallet (passed via M9_SIGNER_PRIVATE_KEY)
 * - Signs 5 nonces ONCE
 * - Makes 5,000 calls paced evenly across DURATION_HOURS (default 72)
 * - Samples /internal/recurring (available balance) & /internal/reconciliation (drift)
 * - Asserts:
 *   - RPC status === 200 on every call (aborts with body on non-200)
 *   - Sample failures are HARD failures (no fail-open fallbacks)
 *   - total_consumed <= total_capacity
 *   - total_remaining decreases monotonically across the schedule
 *   - current_authorization.remaining decreases monotonically within each auth lifecycle
 *   - drift_minor_units === 0 on every sample & reconciler not halted
 *   - nonces.signed === 5 throughout
 *   - At least one refill transition occurs (refill_events.length > initialRefillCount)
 * - Produces one evidence log: logs/m9_exit_gate_evidence.jsonl
 *
 * Usage:
 *   DATABASE_URL=... API_BASE=... RECONCILER=... INTERNAL_TOKEN=... M9_SIGNER_PRIVATE_KEY=... npx tsx scripts/ops/m9-exit-gate.ts
 */

import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { privateKeyToAccount } from 'viem/accounts';

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('ERROR: DATABASE_URL is not set.');
    process.exit(1);
  }
  const pk = process.env.M9_SIGNER_PRIVATE_KEY;
  if (!pk || !/^0x[0-9a-fA-F]{64}$/.test(pk)) {
    console.error('ERROR: set M9_SIGNER_PRIVATE_KEY=0x<64 hex> in the environment.');
    process.exit(1);
  }
  const apiBase = process.env.API_BASE || 'http://localhost:8080';
  const reconcilerUrl = process.env.RECONCILER || 'http://localhost:3000';
  const internalToken = process.env.INTERNAL_TOKEN || '';
  const durationHours = Number(process.env.DURATION_HOURS || '72');
  const totalCalls = 5000;

  console.log(`=== M9 Exit Gate Driver ===`);
  console.log(`Duration:   ${durationHours} hours`);
  console.log(`Calls:      ${totalCalls}`);
  console.log(`Pacing:     1 call every ${((durationHours * 3600) / totalCalls).toFixed(1)} seconds`);

  // 1. Setup existing funded wallet
  const account = privateKeyToAccount(pk as `0x${string}`);
  console.log(`\n[1] Using existing funded signer: ${account.address}`);

  // 2. Sign 5 nonces ONCE
  console.log(`[2] Signing 5 nonces...`);
  const signOutput = execSync('node scripts/ops/m9-sign-schedule.mjs', {
    env: { ...process.env, M9_NONCE_COUNT: '5' },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  
  // 3. Register schedule
  console.log(`[3] Registering schedule...`);
  const regOutput = execSync('npx tsx scripts/ops/m9-register-schedule.ts', {
    env: { ...process.env },
    input: signOutput,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  
  const summary = JSON.parse(regOutput.trim());
  console.log(`    Schedule registered! ID: ${summary.schedule_id}`);

  // 4. Run the 5000 call loop
  console.log(`\n[4] Entering ${durationHours}-hour endurance loop...`);
  const logDir = path.join(process.cwd(), 'logs');
  fs.mkdirSync(logDir, { recursive: true });
  const logPath = path.join(logDir, 'm9_exit_gate_evidence.jsonl');
  const logFile = fs.openSync(logPath, 'a');
  console.log(`    Evidence log: ${logPath}\n`);

  const intervalMs = (durationHours * 3600 * 1000) / totalCalls;
  let lastTotalRemaining: bigint | null = null;
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
    const sched = recurringBody.schedules?.find((s: any) => s.schedule_id === summary.schedule_id);
    if (!sched) {
      const err = `FATAL: Schedule ${summary.schedule_id} not found in /internal/recurring report!`;
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

    // Fix 1: Transition assertion requires refill_events.length > initialRefillCount alone
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
    const driftMinor = driftBody.drift_minor_units;
    const halted = driftBody.halted;

    // d. Invariant Assertions (A3 & A4)
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

    // Invariant 2a: total_remaining (schedule-wide) decreases monotonically
    if (lastTotalRemaining !== null && totalRemaining > lastTotalRemaining) {
      const err = `FATAL INVARIANT VIOLATION: total_remaining increased from ${lastTotalRemaining} to ${totalRemaining}`;
      console.error(`\n❌ ${err}`);
      fs.writeSync(logFile, JSON.stringify({ error: err, timestamp: new Date().toISOString() }) + '\n');
      process.exit(1);
    }
    lastTotalRemaining = totalRemaining;

    // Invariant 2b: current authorization remaining decreases monotonically within each auth lifecycle
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
      lastAuthId = currentAuth.id;
      lastAuthRemaining = authRemaining;
    }

    // Invariant 3: drift_minor_units === 0 on every sample
    if (driftMinor !== 0) {
      const err = `FATAL INVARIANT VIOLATION: reconciler drift is ${driftMinor} (expected 0)`;
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

  // A4 assertion: assert at least one refill transition occurred during the run (refill_events.length > initialRefillCount)
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
