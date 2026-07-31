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
 * Run:
 *   npx vitest run --project libs
 *   npx vitest run --project tools
 *   npx vitest run --project integration
 */

import { defineConfig } from 'vitest/config';

const INTEGRATION_PATTERNS = [
  '**/*.smoke.test.ts',
  '**/*.integration.test.ts',
];

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'libs',
          include: ['libs/**/*.{test,spec}.ts'],
          exclude: ['**/node_modules/**', '**/dist/**', ...INTEGRATION_PATTERNS],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'tools',
          include: ['tools/**/*.{test,spec}.ts'],
          exclude: ['**/node_modules/**', ...INTEGRATION_PATTERNS],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'integration',
          include: INTEGRATION_PATTERNS,
          exclude: ['**/node_modules/**'],
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
