#!/usr/bin/env -S npx tsx
/**
 * m9-register-schedule — registers a nonce schedule by calling
 * createAuthorization() for each envelope in the JSON array on STDIN,
 * then groups them with a shared schedule_id.
 *
 * Reads the signed envelope array from STDIN and connection string from
 * env DATABASE_URL (never from a file, never echoed). Each envelope is
 * signature-verified and persisted atomically; then a schedule_id is applied
 * and schedule_state is initialized.
 *
 * Also updates the funding_sources to set supportsRecurring = true.
 *
 * Usage:
 *   DATABASE_URL=… npx tsx scripts/ops/m9-register-schedule.ts < envelopes.json
 */

import { Pool } from 'pg';
import {
  createAuthorization,
  ViemEip3009Verifier,
  PostgresPrincipalRepository,
  PostgresAuthorizationCreationUnitOfWork,
  type SignedAuthorizationEnvelope,
} from '@satelink/financial';

function redact(sig: string): string {
  if (typeof sig !== 'string' || sig.length < 14) return '<redacted>';
  return `${sig.slice(0, 6)}…${sig.slice(-6)}`;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

async function main(): Promise<void> {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('ERROR: DATABASE_URL is not set.');
    process.exit(1);
  }

  const raw = (await readStdin()).trim();
  if (!raw) {
    console.error('ERROR: no envelope JSON on stdin.');
    process.exit(1);
  }

  const parsed = JSON.parse(raw);
  const envelopes: SignedAuthorizationEnvelope[] = Array.isArray(parsed) ? parsed : [parsed];
  if (envelopes.length === 0) {
    console.error('ERROR: empty envelope array.');
    process.exit(1);
  }

  console.error(`[m9-register] ${envelopes.length} envelopes to register.`);

  const pool = new Pool({ connectionString: dbUrl });
  pool.on('error', () => {});

  const deps = {
    verifier: new ViemEip3009Verifier(),
    principals: new PostgresPrincipalRepository(pool),
    uow: new PostgresAuthorizationCreationUnitOfWork(pool),
  };

  const authorizationIds: string[] = [];
  const fundingSourceIds: string[] = [];
  let failures = 0;

  try {
    // 1. Create each authorization.
    for (let i = 0; i < envelopes.length; i++) {
      const env = envelopes[i]!;
      const res = await createAuthorization(deps, env);
      if (res.isErr) {
        failures++;
        console.error(
          `[m9-register] envelope ${i} FAILED: ${res.error.reason} (sig: ${redact(env.signature)})`,
        );
        continue;
      }
      authorizationIds.push(res.value.authorizationId);
      fundingSourceIds.push(res.value.fundingSourceId);
      console.error(
        `[m9-register] envelope ${i}: ${res.value.created ? 'CREATED' : 'EXISTS'} ` +
          `auth=${res.value.authorizationId} cap=${res.value.capMinorUnits} sig=${redact(env.signature)}`,
      );
    }

    if (failures > 0) {
      console.error(`[m9-register] ${failures} envelope(s) failed. Aborting schedule grouping.`);
      process.exit(2);
    }

    if (authorizationIds.length < 2) {
      console.error('[m9-register] only 1 authorization — no schedule grouping needed.');
      process.exit(0);
    }

    // 2. Derive schedule_id from the first authorization's id prefix.
    const scheduleId = `sched_${authorizationIds[0]!.replace(/^auth_/, '').slice(0, 8)}`;
    console.error(`[m9-register] grouping ${authorizationIds.length} auths as schedule_id=${scheduleId}`);

    // 3. Apply schedule_id to all authorizations.
    await pool.query(
      `UPDATE authorizations SET schedule_id = $1 WHERE id = ANY($2::text[])`,
      [scheduleId, authorizationIds],
    );

    // 4. Update funding_sources to set supportsRecurring = true.
    await pool.query(
      `UPDATE funding_sources
          SET capabilities = jsonb_set(capabilities, '{supportsRecurring}', 'true')
        WHERE id = ANY($1::text[])`,
      [fundingSourceIds],
    );

    // 5. Initialize schedule_state with the first auth as current.
    // Determine the principal from the first authorization.
    const principalRes = await pool.query<{ principal_id: string }>(
      `SELECT principal_id FROM authorizations WHERE id = $1`,
      [authorizationIds[0]],
    );
    const principalId = principalRes.rows[0]?.principal_id;
    if (!principalId) {
      console.error('[m9-register] could not resolve principal_id. Schedule state not initialized.');
      process.exit(2);
    }

    await pool.query(
      `INSERT INTO schedule_state (schedule_id, principal_id, current_auth_id, updated_at)
            VALUES ($1, $2, $3, now())
       ON CONFLICT (schedule_id) DO UPDATE
            SET current_auth_id = $3, updated_at = now()`,
      [scheduleId, principalId, authorizationIds[0]],
    );

    // 6. Print summary.
    const summary = {
      ok: true,
      schedule_id: scheduleId,
      principal_id: principalId,
      authorization_ids: authorizationIds,
      funding_source_ids: fundingSourceIds,
      nonce_count: authorizationIds.length,
    };
    process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
  } finally {
    await pool.end();
  }
  process.exit(failures > 0 ? 2 : 0);
}

void main();
