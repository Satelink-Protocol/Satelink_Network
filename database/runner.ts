/**
 * database/runner.ts — Sequential, forward-only migration runner.
 *
 * Properties:
 *   - Applies numbered .sql files in order
 *   - Never runs on app boot — explicit CLI command only
 *   - Idempotent: re-running applies nothing
 *   - Checksum verification: SHA-256 of each file stored; mismatches fail loudly
 *   - Tracks state in a `schema_migrations` table
 *   - Accepts connectionString explicitly — NEVER reads env vars
 *
 * Commands:
 *   npx tsx database/runner.ts migrate  <connectionString>
 *   npx tsx database/runner.ts status   <connectionString>
 *   npx tsx database/runner.ts verify   <connectionString>
 *
 * M2: Ledger schema. Tables are purely additive.
 */

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Client } from 'pg';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MigrationFile {
  readonly filename: string;
  readonly number: number;
  readonly sql: string;
  readonly checksum: string;
}

export interface AppliedMigration {
  readonly id: number;
  readonly filename: string;
  readonly checksum: string;
  readonly applied_at: Date;
}

export interface MigrationStatus {
  readonly filename: string;
  readonly number: number;
  readonly status: 'applied' | 'pending';
  readonly applied_at?: Date;
}

export interface MigrationResult {
  readonly applied: string[];
  readonly skipped: string[];
  readonly errors: string[];
}

// ---------------------------------------------------------------------------
// Core
// ---------------------------------------------------------------------------

const MIGRATIONS_DIR = resolve(import.meta.dirname ?? new URL('.', import.meta.url).pathname, 'migrations');

/**
 * Compute SHA-256 checksum of a migration file's contents.
 */
export function computeChecksum(sql: string): string {
  return createHash('sha256').update(sql, 'utf8').digest('hex');
}

/**
 * Discover all migration files on disk, sorted by number.
 */
export function discoverMigrations(dir: string = MIGRATIONS_DIR): MigrationFile[] {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  return files.map((filename) => {
    const match = filename.match(/^(\d+)_/);
    if (!match) {
      throw new Error(`Migration filename "${filename}" does not start with a number prefix`);
    }
    const sql = readFileSync(join(dir, filename), 'utf8');
    return {
      filename,
      number: parseInt(match[1]!, 10),
      sql,
      checksum: computeChecksum(sql),
    };
  });
}

/**
 * Ensure the schema_migrations tracking table exists.
 */
async function ensureTrackingTable(client: Client): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id            SERIAL PRIMARY KEY,
      filename      TEXT NOT NULL UNIQUE,
      checksum      TEXT NOT NULL,
      applied_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

/**
 * Fetch all applied migrations from the tracking table.
 */
async function getAppliedMigrations(client: Client): Promise<AppliedMigration[]> {
  const { rows } = await client.query<{
    id: number;
    filename: string;
    checksum: string;
    applied_at: Date;
  }>('SELECT id, filename, checksum, applied_at FROM schema_migrations ORDER BY id');
  return rows;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/**
 * Apply all pending migrations. Each migration runs in its own transaction.
 * Fails loudly on checksum mismatch of an already-applied migration.
 */
export async function migrate(
  connectionString: string,
  migrationsDir?: string,
): Promise<MigrationResult> {
  const client = new Client({ connectionString });
  await client.connect();

  try {
    await ensureTrackingTable(client);

    const onDisk = discoverMigrations(migrationsDir);
    const applied = await getAppliedMigrations(client);
    const appliedByName = new Map(applied.map((a) => [a.filename, a]));

    const result: MigrationResult = { applied: [], skipped: [], errors: [] };

    for (const migration of onDisk) {
      const existing = appliedByName.get(migration.filename);

      if (existing) {
        // Already applied — verify checksum
        if (existing.checksum !== migration.checksum) {
          const msg =
            `Checksum mismatch for "${migration.filename}": ` +
            `applied=${existing.checksum.slice(0, 12)}… ` +
            `current=${migration.checksum.slice(0, 12)}…`;
          result.errors.push(msg);
          throw new Error(msg);
        }
        result.skipped.push(migration.filename);
        continue;
      }

      // Apply migration in its own transaction
      await client.query('BEGIN');
      try {
        await client.query(migration.sql);
        await client.query(
          'INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)',
          [migration.filename, migration.checksum],
        );
        await client.query('COMMIT');
        result.applied.push(migration.filename);
      } catch (err) {
        await client.query('ROLLBACK');
        const msg = `Failed to apply "${migration.filename}": ${err instanceof Error ? err.message : String(err)}`;
        result.errors.push(msg);
        throw new Error(msg);
      }
    }

    return result;
  } finally {
    await client.end();
  }
}

/**
 * Report migration status: which are applied, which are pending.
 */
export async function status(
  connectionString: string,
  migrationsDir?: string,
): Promise<MigrationStatus[]> {
  const client = new Client({ connectionString });
  await client.connect();

  try {
    await ensureTrackingTable(client);

    const onDisk = discoverMigrations(migrationsDir);
    const applied = await getAppliedMigrations(client);
    const appliedByName = new Map(applied.map((a) => [a.filename, a]));

    return onDisk.map((m) => {
      const existing = appliedByName.get(m.filename);
      return {
        filename: m.filename,
        number: m.number,
        status: existing ? ('applied' as const) : ('pending' as const),
        applied_at: existing?.applied_at,
      };
    });
  } finally {
    await client.end();
  }
}

/**
 * Verify all applied migrations match their current file checksums.
 * Returns errors for any mismatches.
 */
export async function verify(
  connectionString: string,
  migrationsDir?: string,
): Promise<{ ok: boolean; errors: string[] }> {
  const client = new Client({ connectionString });
  await client.connect();

  try {
    await ensureTrackingTable(client);

    const onDisk = discoverMigrations(migrationsDir);
    const applied = await getAppliedMigrations(client);
    const onDiskByName = new Map(onDisk.map((m) => [m.filename, m]));

    const errors: string[] = [];

    for (const a of applied) {
      const disk = onDiskByName.get(a.filename);
      if (!disk) {
        errors.push(`Applied migration "${a.filename}" not found on disk`);
      } else if (disk.checksum !== a.checksum) {
        errors.push(
          `Checksum mismatch for "${a.filename}": ` +
          `applied=${a.checksum.slice(0, 12)}… ` +
          `current=${disk.checksum.slice(0, 12)}…`,
        );
      }
    }

    return { ok: errors.length === 0, errors };
  } finally {
    await client.end();
  }
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const [command, connectionString] = process.argv.slice(2);

  if (!command || !connectionString) {
    console.error('Usage: npx tsx database/runner.ts <migrate|status|verify> <connectionString>');
    process.exit(1);
  }

  switch (command) {
    case 'migrate': {
      console.log('Applying pending migrations…');
      const result = await migrate(connectionString);
      if (result.applied.length > 0) {
        console.log(`Applied: ${result.applied.join(', ')}`);
      }
      if (result.skipped.length > 0) {
        console.log(`Skipped (already applied): ${result.skipped.join(', ')}`);
      }
      if (result.errors.length > 0) {
        console.error(`Errors: ${result.errors.join('; ')}`);
        process.exit(1);
      }
      console.log('Done.');
      break;
    }
    case 'status': {
      const statuses = await status(connectionString);
      console.log('\nMigration Status:');
      for (const s of statuses) {
        const mark = s.status === 'applied' ? '✅' : '⏳';
        const date = s.applied_at ? ` (${s.applied_at.toISOString()})` : '';
        console.log(`  ${mark} ${s.filename}${date}`);
      }
      break;
    }
    case 'verify': {
      const result = await verify(connectionString);
      if (result.ok) {
        console.log('✅ All applied migrations match their file checksums.');
      } else {
        console.error('❌ Verification failed:');
        for (const e of result.errors) {
          console.error(`  - ${e}`);
        }
        process.exit(1);
      }
      break;
    }
    default:
      console.error(`Unknown command: "${command}". Use migrate, status, or verify.`);
      process.exit(1);
  }
}

// Only run CLI when executed directly
const isDirectExecution =
  typeof process !== 'undefined' &&
  process.argv[1] !== undefined &&
  (process.argv[1].endsWith('runner.ts') || process.argv[1].endsWith('runner.js'));

if (isDirectExecution) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
