/**
 * Source-level enforcement: DATABASE_URL must never appear in an integration
 * test file. Those files read TEST_DATABASE_URL only, gated by the fail-closed
 * marker guard (libs/testing/src/assert-test-db.ts).
 *
 * Why a source scan and not a dependency-cruiser rule: dependency-cruiser
 * analyses the *import graph*. `process.env.DATABASE_URL` is a bare property
 * read, not an import, so it produces no dependency edge and no cruiser rule
 * can match it (verified empirically). A source scan is the correct instrument
 * for a string-level ban, and — like the M0 arch harness — it is tripwire-
 * verified here so a rule nobody has watched fail is never mistaken for one
 * that works.
 *
 * The regex matches `process.env.DATABASE_URL` and `process.env['DATABASE_URL']`
 * but NOT `process.env.TEST_DATABASE_URL` (the sanctioned variable).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { readdirSync, readFileSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const REPO_ROOT = resolve(__dirname, '../..');
const FIXTURE_DIR = join(REPO_ROOT, 'tools/architecture-tests/__dburl_fixture__');

const INTEGRATION_FILE = /\.(integration|smoke)\.test\.ts$/;
const FORBIDDEN =
  /process\.env\.DATABASE_URL\b|process\.env\[\s*['"]DATABASE_URL['"]\s*\]/;

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.claude',
  'dist',
  'build',
  'coverage',
  '.next',
]);

/**
 * Recursively collect integration/smoke test files under `root`. Only real
 * directories are entered — symlinks (e.g. the worktree node_modules link) and
 * SKIP_DIRS are not followed.
 */
export function findIntegrationTestFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(join(dir, entry.name));
      } else if (entry.isFile() && INTEGRATION_FILE.test(entry.name)) {
        out.push(join(dir, entry.name));
      }
    }
  };
  walk(root);
  return out;
}

/** Of the given files, those that reference DATABASE_URL. */
export function filesReferencingDatabaseUrl(files: readonly string[]): string[] {
  return files.filter((f) => FORBIDDEN.test(readFileSync(f, 'utf8')));
}

afterEach(() => {
  if (existsSync(FIXTURE_DIR)) {
    rmSync(FIXTURE_DIR, { recursive: true, force: true });
  }
});

describe('DATABASE_URL is forbidden in integration test files', () => {
  it('no integration/smoke test file references DATABASE_URL', () => {
    const files = findIntegrationTestFiles(REPO_ROOT);
    // Sanity: the scan actually found the integration suite (not a broken walk).
    expect(files.length).toBeGreaterThan(0);

    const offenders = filesReferencingDatabaseUrl(files).map((f) => f.slice(REPO_ROOT.length + 1));
    expect(offenders, `these integration files must read TEST_DATABASE_URL only:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('TRIPWIRE: the scan fires on a DATABASE_URL reference in an integration file', () => {
    mkdirSync(FIXTURE_DIR, { recursive: true });
    const violating = join(FIXTURE_DIR, 'leak.integration.test.ts');
    writeFileSync(
      violating,
      'const url = process.env.DATABASE_URL;\nexport const pool = { url };\n',
      'utf8',
    );

    // The scanner must discover the fixture and flag it.
    const found = findIntegrationTestFiles(FIXTURE_DIR);
    expect(found).toContain(violating);
    expect(filesReferencingDatabaseUrl(found)).toContain(violating);
  });

  it('TRIPWIRE: TEST_DATABASE_URL is NOT mistaken for a violation', () => {
    mkdirSync(FIXTURE_DIR, { recursive: true });
    const clean = join(FIXTURE_DIR, 'ok.integration.test.ts');
    writeFileSync(
      clean,
      'const url = process.env.TEST_DATABASE_URL;\nexport const pool = { url };\n',
      'utf8',
    );

    expect(filesReferencingDatabaseUrl([clean])).toEqual([]);
  });
});
