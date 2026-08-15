#!/usr/bin/env -S npx tsx
/**
 * m8-create-authorization — run the verified create-authorization command
 * against a Postgres. Reads the signed envelope(s) as JSON on STDIN and the
 * connection string from env DATABASE_URL (never from a file it writes, never
 * echoed). Verifies the signature and persists atomically; prints a REDACTED
 * result (signature shortened to first6…last6) so nothing sensitive is logged.
 *
 * Usage:
 *   DATABASE_URL=… npx tsx scripts/ops/m8-create-authorization.ts < envelope.json
 *   # envelope.json may be a single envelope, or { main, exhaustion } — both run.
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
  const envelopes: SignedAuthorizationEnvelope[] =
    parsed && parsed.signature
      ? [parsed]
      : [parsed.main, parsed.exhaustion].filter(Boolean);
  if (envelopes.length === 0) {
    console.error('ERROR: could not find any envelope (expected a single envelope or { main, exhaustion }).');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: dbUrl });
  pool.on('error', () => {});
  const deps = {
    verifier: new ViemEip3009Verifier(),
    principals: new PostgresPrincipalRepository(pool),
    uow: new PostgresAuthorizationCreationUnitOfWork(pool),
  };

  let failures = 0;
  try {
    for (const env of envelopes) {
      const res = await createAuthorization(deps, env);
      if (res.isErr) {
        failures++;
        console.log(JSON.stringify({ ok: false, signer: env.signer, signature: redact(env.signature), error: res.error.reason }, null, 2));
        continue;
      }
      console.log(
        JSON.stringify(
          {
            ok: true,
            created: res.value.created,
            signature: redact(env.signature),
            principalId: res.value.principalId,
            fundingSourceId: res.value.fundingSourceId,
            authorizationId: res.value.authorizationId,
            accountId: res.value.accountId,
            signer: res.value.signer,
            capMinorUnits: res.value.capMinorUnits,
            currency: res.value.currency,
            nonce: res.value.nonce,
          },
          null,
          2,
        ),
      );
    }
  } finally {
    await pool.end();
  }
  process.exit(failures > 0 ? 2 : 0);
}

void main();
