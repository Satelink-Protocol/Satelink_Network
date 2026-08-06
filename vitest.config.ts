/**
 * Vitest root configuration.
 *
 * Uses `test.projects` rather than the deprecated `vitest.workspace.ts`
 * (removed in the next major).
 *
 * Three projects with deliberately different characteristics:
 *
 *   libs        — pure domain. Fast, no Docker, no network. Branch coverage
 *                 rises to 100% on money-critical aggregates from M3.
 *   tools       — architecture enforcement tests. Node environment, filesystem
 *                 access permitted (they inspect the repo itself).
 *   integration — Docker-backed. Excluded from the default run.
 *
 * Workspace packages (@satelink/kernel, @satelink/financial-domain) resolve via
 * their node_modules symlinks — created by `npm install`'s workspace linking in
 * CI, and present locally too. No alias/plugin indirection.
 *
 * Run:
 *   npx vitest run --project libs
 *   npx vitest run --project tools
 *   npx vitest run --project integration
 */

import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const INTEGRATION_PATTERNS = [
  '**/*.smoke.test.ts',
  '**/*.integration.test.ts',
];

// Resolve workspace package specifiers to their TS source. A resolveId plugin is
// used because Vitest's `projects` do not reliably apply resolve.alias to
// transitive bare specifiers, and the local shared node_modules symlink does not
// contain the M3 workspace links. In CI, `npm install` links the workspaces, so
// this plugin is a harmless no-op there (npm resolution wins first).
const WORKSPACE_SOURCES: Record<string, string> = {
  '@satelink/kernel': fileURLToPath(new URL('./libs/kernel/src/index.ts', import.meta.url)),
  '@satelink/financial-domain': fileURLToPath(
    new URL('./libs/financial-domain/src/index.ts', import.meta.url),
  ),
};

const workspaceResolver = {
  name: 'satelink-workspace-resolver',
  enforce: 'pre' as const,
  resolveId(id: string) {
    return WORKSPACE_SOURCES[id] ?? null;
  },
};

export default defineConfig({
  plugins: [workspaceResolver],
  test: {
    projects: [
      {
        test: {
          name: 'libs',
          include: ['libs/**/*.{test,spec}.ts'],
          exclude: ['**/node_modules/**', '**/dist/**', '.claude/worktrees/**', ...INTEGRATION_PATTERNS],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'tools',
          include: ['tools/**/*.{test,spec}.ts'],
          exclude: ['**/node_modules/**', '.claude/worktrees/**', ...INTEGRATION_PATTERNS],
          environment: 'node',
        },
      },
      {
        extends: true,
        plugins: [workspaceResolver],
        test: {
          name: 'integration',
          include: INTEGRATION_PATTERNS,
          exclude: ['**/node_modules/**', '.claude/worktrees/**'],
          // Fail-closed guard: the suite refuses to run unless TEST_DATABASE_URL
          // points at a database carrying __test_db_marker. Runs once before any
          // integration test is collected. See libs/testing/src/assert-test-db.ts.
          globalSetup: ['./libs/testing/src/assert-test-db.ts'],
          environment: 'node',
          testTimeout: 120_000,
          hookTimeout: 120_000,
        },
      },
    ],
    coverage: {
      provider: 'v8',
      include: ['libs/**/src/**/*.ts'],
      exclude: ['**/*.{test,spec}.ts', '**/index.ts'],
      // Raised to 100 for money-critical aggregates at M3.
      thresholds: { lines: 0, branches: 0, functions: 0, statements: 0 },
    },
  },
});
