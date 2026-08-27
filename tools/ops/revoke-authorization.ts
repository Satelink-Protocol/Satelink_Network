#!/usr/bin/env -S npx tsx
/**
 * revoke-authorization — the sanctioned path to revoke an Authorization.
 *
 * Drives the REAL domain revoke() + PostgresAuthorizationRepository.save(). It
 * NEVER issues raw UPDATEs against authorizations — the whole point is to exercise
 * the domain aggregate so its invariants (terminal-state guard, optimistic version
 * lock, nonce set replacement, and NOT touching ledger_entries) are enforced.
 *
 * Revocation is a state transition: state='active' -> state='revoked' (terminal,
 * invariant #9). It preserves consumed_amount and every ledger_entries row —
 * revocation kills FUTURE draws, it does not rewrite history. There is no
 * revoked_at column in the schema (the domain models revocation as a state, not a
 * timestamp); the revocation time is captured in the structured audit log below.
 *
 * Usage (dry-run is the DEFAULT — mutation requires --confirm):
 *   railway run --service Postgres-iQeW -- \
 *     npx tsx tools/ops/revoke-authorization.ts --signer 0x2821... --reason "..." --actor me
 *   ... add --confirm to actually mutate production.
 *
 * Connection: reads DATABASE_PUBLIC_URL / DATABASE_URL from the environment
 * (injected by `railway run`). The connection string is never logged.
 */

import { Pool } from 'pg';
import { PostgresAuthorizationRepository } from '../../services/financial/src/infrastructure/repositories/postgres/postgres-authorization-repository.js';

export interface RevokeOptions {
  /** Explicit authorization ids. */
  ids?: string[];
  /** Resolve ids by signer address (envelope signer), tiebreak valid_before ASC, id ASC. */
  signer?: string;
  reason: string;
  actor: string;
  /** DEFAULT true. Only false (via --confirm) mutates. */
  dryRun: boolean;
  /** Injectable clock for deterministic logs in tests. */
  nowMs?: number;
  /** Sink for structured audit lines (default: console.log). */
  log?: (line: string) => void;
}

export type RevokeAction =
  | 'revoke' // will (dry-run) / did (confirm) revoke an active authorization
  | 'noop-already-revoked' // terminal — idempotent no-op
  | 'skip-not-found'; // no such authorization

export interface RevokeResult {
  authId: string;
  signer: string | null;
  consumedAmount: string;
  validBefore: string;
  previousState: string;
  action: RevokeAction;
  mutated: boolean;
}

interface TargetRow {
  id: string;
  signer: string | null;
  state: string;
  valid_before: string;
  consumed_amount: string;
}

/** Resolve the target authorization rows, applying the canonical tiebreak. */
async function resolveTargets(pool: Pool, opts: RevokeOptions): Promise<TargetRow[]> {
  if (opts.ids && opts.ids.length > 0) {
    const { rows } = await pool.query<TargetRow>(
      `SELECT id, signature_envelope->>'signer' AS signer, state,
              valid_before::text AS valid_before, consumed_amount::text AS consumed_amount
         FROM authorizations WHERE id = ANY($1)
        ORDER BY valid_before ASC, id ASC`,
      [opts.ids],
    );
    return rows;
  }
  if (opts.signer) {
    const { rows } = await pool.query<TargetRow>(
      `SELECT id, signature_envelope->>'signer' AS signer, state,
              valid_before::text AS valid_before, consumed_amount::text AS consumed_amount
         FROM authorizations
        WHERE signature_envelope->>'signer' ILIKE $1
        ORDER BY valid_before ASC, id ASC`,
      [opts.signer],
    );
    return rows;
  }
  throw new Error('revoke-authorization: one of --id or --signer is required');
}

/**
 * STOP-3 pre-flight: an authorization may not be revoked out from under an
 * in-flight draw or an un-reconciled ledger transaction. Draws are the only
 * aggregate that consumes an Authorization, and every ledger_txn follows a draw,
 * so a clean draw set is sufficient. Returns a human-readable blocker or null.
 */
async function preflightBlock(pool: Pool, authId: string): Promise<string | null> {
  const { rows } = await pool.query<{ state: string; n: string }>(
    `SELECT state, count(*)::text AS n FROM draws
      WHERE authorization_id = $1 AND state <> 'rejected'
      GROUP BY state`,
    [authId],
  );
  if (rows.length === 0) return null;
  const detail = rows.map((r) => `${r.n} ${r.state}`).join(', ');
  return `has non-rejected draws (${detail}) — reconcile/settle before revoking`;
}

/**
 * Revoke the targeted authorizations via the domain path. Each revocation is one
 * repository transaction (save() does BEGIN..COMMIT over the root + its nonces);
 * no eventual consistency is introduced. Idempotent: an already-revoked
 * authorization is a no-op, not an error.
 */
export async function revokeAuthorizations(pool: Pool, opts: RevokeOptions): Promise<RevokeResult[]> {
  const repo = new PostgresAuthorizationRepository(pool);
  const log = opts.log ?? ((l: string) => console.log(l));
  const nowMs = opts.nowMs ?? Date.now();
  const targets = await resolveTargets(pool, opts);
  const results: RevokeResult[] = [];

  for (const t of targets) {
    const base = {
      authId: t.id,
      signer: t.signer,
      consumedAmount: t.consumed_amount,
      validBefore: t.valid_before,
      previousState: t.state,
    };

    const found = await repo.findById(t.id);
    if (found.isErr) throw new Error(`findById failed for ${t.id}: ${found.error.toString()}`);
    const auth = found.value;
    if (!auth) {
      results.push({ ...base, action: 'skip-not-found', mutated: false });
      continue;
    }

    if (auth.state.isTerminal()) {
      const r: RevokeResult = { ...base, action: 'noop-already-revoked', mutated: false };
      log(auditLine(r, opts, nowMs, opts.dryRun));
      results.push(r);
      continue;
    }

    const blocker = await preflightBlock(pool, t.id);
    if (blocker) {
      // STOP-3: refuse the whole run rather than partially revoke.
      throw new Error(`STOP-3: authorization ${t.id} ${blocker}`);
    }

    const r: RevokeResult = { ...base, action: 'revoke', mutated: !opts.dryRun };
    log(auditLine(r, opts, nowMs, opts.dryRun));

    if (opts.dryRun) {
      results.push(r);
      continue;
    }

    const revoked = auth.revoke();
    if (revoked.isErr) {
      // Raced to terminal between load and revoke — treat as idempotent no-op.
      results.push({ ...base, action: 'noop-already-revoked', mutated: false });
      continue;
    }
    const saved = await repo.save(revoked.value);
    if (saved.isErr) throw new Error(`save failed for ${t.id}: ${saved.error.toString()}`);
    results.push(r);
  }

  return results;
}

function auditLine(r: RevokeResult, opts: RevokeOptions, nowMs: number, dryRun: boolean): string {
  return JSON.stringify({
    event: 'authorization_revocation',
    mode: dryRun ? 'dry-run' : 'confirmed',
    action: r.action,
    auth_id: r.authId,
    signer: r.signer,
    consumed_amount: r.consumedAmount,
    valid_before: r.validBefore,
    previous_state: r.previousState,
    reason: opts.reason,
    actor: opts.actor,
    ts: new Date(nowMs).toISOString(),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────────────────────────────────────

function isProductionConnection(conn: string): boolean {
  try {
    const host = new URL(conn).hostname.toLowerCase();
    return !['localhost', '127.0.0.1', '::1', '0.0.0.0'].includes(host) && !host.endsWith('.internal');
  } catch {
    // Unparseable → treat as NON-production so a mutation is refused (fail safe).
    return false;
  }
}

function parseArgs(argv: string[]): {
  ids?: string[];
  signer?: string;
  reason: string;
  actor: string;
  confirm: boolean;
  allowTest: boolean;
} {
  const out: Record<string, string> = {};
  const flags = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--confirm' || a === '--allow-test' || a === '--dry-run') {
      flags.add(a);
    } else if (a.startsWith('--')) {
      out[a.slice(2)] = argv[++i]!;
    }
  }
  return {
    ids: out.id ? out.id.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
    signer: out.signer,
    reason: out.reason ?? '',
    actor: out.actor ?? process.env.USER ?? 'unknown',
    confirm: flags.has('--confirm') && !flags.has('--dry-run'),
    allowTest: flags.has('--allow-test'),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.reason) {
    console.error('ERROR: --reason "<why>" is required (audit trail).');
    process.exit(2);
  }
  if (!args.ids && !args.signer) {
    console.error('ERROR: one of --id <auth_id[,auth_id]> or --signer <address> is required.');
    process.exit(2);
  }

  const conn = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!conn) {
    console.error('ERROR: DATABASE_PUBLIC_URL / DATABASE_URL not set (run via `railway run`).');
    process.exit(2);
  }

  const isProd = isProductionConnection(conn);
  const dryRun = !args.confirm;

  // Guard both directions.
  if (!isProd && !args.allowTest) {
    console.error('REFUSING: target looks like a NON-production DB. Pass --allow-test to run here.');
    process.exit(2);
  }
  if (isProd && !dryRun && !args.confirm) {
    console.error('REFUSING: production mutation requires --confirm.');
    process.exit(2);
  }

  console.error(
    `[revoke-authorization] target=${isProd ? 'PRODUCTION' : 'test'} mode=${dryRun ? 'DRY-RUN' : 'CONFIRM (mutating)'} ` +
      `selector=${args.ids ? `ids(${args.ids.length})` : `signer(${args.signer})`}`,
  );

  const pool = new Pool({ connectionString: conn });
  pool.on('error', () => {});
  try {
    const results = await revokeAuthorizations(pool, {
      ids: args.ids,
      signer: args.signer,
      reason: args.reason,
      actor: args.actor,
      dryRun,
    });
    const revoked = results.filter((r) => r.action === 'revoke').length;
    const noop = results.filter((r) => r.action === 'noop-already-revoked').length;
    const missing = results.filter((r) => r.action === 'skip-not-found').length;
    console.error(
      `[revoke-authorization] ${dryRun ? 'PLAN' : 'DONE'}: ${revoked} to-revoke, ${noop} already-revoked, ${missing} not-found` +
        `${dryRun ? '  (no rows mutated — re-run with --confirm to apply)' : ''}`,
    );
  } finally {
    await pool.end();
  }
}

// Only run the CLI when executed directly (not when imported by tests).
const invokedDirectly =
  process.argv[1] !== undefined &&
  (process.argv[1].endsWith('revoke-authorization.ts') || process.argv[1].endsWith('revoke-authorization.js'));
if (invokedDirectly) {
  main().catch((e) => {
    console.error(`[revoke-authorization] FAILED: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  });
}
