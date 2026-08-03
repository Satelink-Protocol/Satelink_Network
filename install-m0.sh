#!/usr/bin/env bash
#
# Satelink M0 — Architecture Enforcement Harness installer
#
# Idempotent. Safe to re-run. Creates no database changes and modifies no
# runtime code. Rollback: git checkout . && rm -rf libs tools
#
# Run from the satelink repository root.

set -euo pipefail

say()  { printf '\033[1;36m%s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m  ✓ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m  ! %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31m  ✗ %s\033[0m\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------- preflight
say "M0 installer — preflight"

[ -f package.json ] || die "No package.json here. Run from the satelink repo root."
grep -q '"workspaces"' package.json || die "Root package.json has no workspaces field."
[ -d .git ] || die "Not a git repository."

BRANCH=$(git rev-parse --abbrev-ref HEAD)
ok "repo root confirmed (branch: $BRANCH)"

if [ -n "$(git status --porcelain)" ]; then
  warn "working tree is dirty:"
  git status --short | head -10
  printf '\nContinue anyway? [y/N] '
  read -r reply
  [ "$reply" = "y" ] || die "aborted"
fi

command -v node >/dev/null || die "node not found"
NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
[ "$NODE_MAJOR" -ge 20 ] || die "Node >= 20 required (found $NODE_MAJOR)"
ok "node $(node -v)"

# ---------------------------------------------------------------- structure
say "Creating directories"
mkdir -p libs/kernel/src
mkdir -p tools/architecture-tests
mkdir -p .github/workflows
mkdir -p docs/adr
ok "libs/kernel/src, tools/architecture-tests, .github/workflows, docs/adr"


say "Writing .dependency-cruiser.cjs"
cat > '.dependency-cruiser.cjs' <<'SATELINK_M0_EOF'
/**
 * Satelink architecture enforcement.
 *
 * These rules make the layering from the approved blueprint mechanically
 * enforced rather than aspirational. A violation fails CI.
 *
 * Rule ordering below mirrors the dependency graph: purity first, then
 * aggregate isolation, then context isolation, then layering.
 *
 * See docs/adr/000-architecture-enforcement.md
 */

/** Node core modules that must never appear in a pure domain layer. */
const NODE_CORE = [
  'fs', 'fs/promises', 'path', 'http', 'https', 'net', 'dns', 'tls',
  'child_process', 'cluster', 'dgram', 'os', 'worker_threads', 'stream',
  'crypto', 'zlib', 'readline', 'v8', 'vm', 'perf_hooks',
].join('|');

/** I/O-performing npm packages that must never appear in a pure domain layer. */
const IO_PACKAGES = [
  'pg', 'postgres', 'pg-promise', 'knex', 'drizzle-orm', 'prisma', '@prisma/client',
  'redis', 'ioredis',
  'axios', 'node-fetch', 'got', 'undici',
  'express', 'fastify', 'koa',
  'ethers', 'viem', 'web3',
  'dotenv',
].join('|');

/** Test files are exempt from purity rules — they may import vitest, fast-check, etc. */
const NOT_A_TEST = '\\.(test|spec)\\.tsx?$';

module.exports = {
  forbidden: [
    // ---------------------------------------------------------------------
    // PURITY — the rules that keep the domain layer testable without mocks
    // ---------------------------------------------------------------------
    {
      name: 'kernel-imports-nothing',
      severity: 'error',
      comment:
        'libs/kernel is the root of the dependency graph. It must import nothing — ' +
        'not another lib, not an npm package, not a node builtin. Everything imports ' +
        'kernel; kernel importing anything creates an unbreakable coupling.',
      from: { path: '^libs/kernel/src', pathNot: NOT_A_TEST },
      to: { pathNot: '^libs/kernel/src' },
    },
    {
      name: 'domain-no-node-core',
      severity: 'error',
      comment:
        'Domain code must be pure. Importing a node builtin means I/O has leaked into ' +
        'the domain layer, which is what forces mocks into domain tests.',
      from: { path: '^libs/', pathNot: NOT_A_TEST },
      to: { dependencyTypes: ['core'], path: `^(${NODE_CORE})$` },
    },
    {
      name: 'domain-no-io-packages',
      severity: 'error',
      comment:
        'Domain code must not reach a database, network, or chain. Repositories and ' +
        'adapters belong in services/*/infrastructure, behind ports.',
      from: { path: '^libs/', pathNot: NOT_A_TEST },
      // Two forms must both match: the bare specifier (when the package is not
      // installed, dependency-cruiser reports `pg`) and the resolved path
      // (when it is installed, it reports `node_modules/pg/...`). Matching only
      // the bare form means the rule stops firing after `npm install`.
      to: {
        path: `(^|/)node_modules/(${IO_PACKAGES})(/|$)|^(${IO_PACKAGES})(/|$)`,
      },
    },

    // ---------------------------------------------------------------------
    // AGGREGATE ISOLATION — what makes the graph acyclic
    // ---------------------------------------------------------------------
    {
      name: 'no-aggregate-to-aggregate',
      severity: 'error',
      comment:
        'Aggregates reference each other by Id only, never by root class. ' +
        'Cross-aggregate logic belongs in libs/*-domain/src/coordination/. ' +
        'This rule is what keeps all aggregates at the same dependency tier.',
      from: {
        path: '^libs/(financial|commerce)-domain/src/(?!coordination|shared|facts)([^/]+)/',
        pathNot: NOT_A_TEST,
      },
      to: {
        path: '^libs/(financial|commerce)-domain/src/(?!coordination|shared|facts)([^/]+)/',
        pathNot: '^libs/$1-domain/src/(?:coordination|shared|facts|$2)/',
      },
    },

    // ---------------------------------------------------------------------
    // BOUNDED CONTEXT ISOLATION
    // ---------------------------------------------------------------------
    {
      name: 'no-financial-to-commerce',
      severity: 'error',
      comment:
        'Bounded contexts communicate by event only, via libs/contracts. ' +
        'A direct import here is the worst kind of cycle — across contexts.',
      from: { path: '^libs/financial-domain' },
      to: { path: '^libs/commerce-domain' },
    },
    {
      name: 'no-commerce-to-financial',
      severity: 'error',
      comment:
        'Commerce must never import Financial. Entitlement suspension on capacity ' +
        'exhaustion happens via the authorization.exhausted event, not an import.',
      from: { path: '^libs/commerce-domain' },
      to: { path: '^libs/financial-domain' },
    },

    // ---------------------------------------------------------------------
    // LAYERING — dependency inversion between application and infrastructure
    // ---------------------------------------------------------------------
    {
      name: 'application-not-to-infrastructure',
      severity: 'error',
      comment:
        'Ports are interfaces declared in application and implemented in ' +
        'infrastructure. Application importing infrastructure inverts that and ' +
        'makes the application layer untestable without a database.',
      from: { path: '^services/[^/]+/src/application' },
      to: { path: '^services/[^/]+/src/infrastructure' },
    },
    {
      name: 'libs-not-to-services',
      severity: 'error',
      comment: 'libs sits below services. It must never reach upward.',
      from: { path: '^libs/' },
      to: { path: '^(services|gateways|workers|apps)/' },
    },
    {
      name: 'services-not-to-deployables',
      severity: 'error',
      comment: 'services are imported by gateways/workers, never the reverse.',
      from: { path: '^services/' },
      to: { path: '^(gateways|workers|apps)/' },
    },

    // ---------------------------------------------------------------------
    // BACKSTOP
    // ---------------------------------------------------------------------
    {
      name: 'no-circular',
      severity: 'error',
      comment:
        'Global cycle detection. The rules above make cycles structurally ' +
        'impossible; this catches anything the structure missed.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-orphans',
      severity: 'warn',
      comment: 'Unreachable modules are usually dead code.',
      from: {
        orphan: true,
        pathNot: [
          '(^|/)\\.[^/]+\\.(js|cjs|mjs|ts|json)$',
          '\\.d\\.ts$',
          '(^|/)tsconfig\\.json$',
          '(^|/)(package|package-lock)\\.json$',
          // Barrel files are entry points by definition, not orphans.
          '(^|/)index\\.ts$',
        ],
      },
      to: {},
    },
  ],

  options: {
    // Do not traverse INTO node_modules, but DO record edges pointing at it.
    //
    // CRITICAL: node_modules must NOT appear in `exclude`. `exclude` removes
    // matching modules from the graph entirely, which deletes the
    // kernel → pg edge and silently disables every I/O rule the moment the
    // package is actually installed. `doNotFollow` keeps the edge and stops
    // at the boundary. Verified by tools/architecture-tests/guard.test.ts.
    doNotFollow: {
      path: 'node_modules',
    },
    exclude: {
      path: [
        '\\.next/',
        'dist/',
        'build/',
        'coverage/',
        '__arch_fixture__',
      ],
    },
    tsPreCompilationDeps: true,
    tsConfig: {
      fileName: 'tsconfig.base.json',
    },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      extensions: ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'],
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
SATELINK_M0_EOF
ok ".dependency-cruiser.cjs"

say "Writing tsconfig.base.json"
cat > 'tsconfig.base.json' <<'SATELINK_M0_EOF'
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "ESNext",
    "moduleResolution": "Bundler",

    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "noImplicitReturns": true,
    "useUnknownInCatchVariables": true,

    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,

    "paths": {
      "@satelink/kernel": ["./libs/kernel/src/index.ts"]
    }
  },
  "exclude": ["node_modules", "dist", "build", "coverage", ".next"]
}
SATELINK_M0_EOF
ok "tsconfig.base.json"

say "Writing vitest.config.ts"
cat > 'vitest.config.ts' <<'SATELINK_M0_EOF'
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
          // M0 ships the harness; libs/kernel has no contents yet. M1 adds the
          // first domain tests (Money) and this becomes moot. Remove once M1
          // lands so an empty libs suite fails loudly rather than silently.
          passWithNoTests: true,
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
SATELINK_M0_EOF
ok "vitest.config.ts"

say "Writing libs/kernel/package.json"
cat > 'libs/kernel/package.json' <<'SATELINK_M0_EOF'
{
  "name": "@satelink/kernel",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "description": "Pure shared value objects. Imports nothing. The root of the dependency graph.",
  "exports": {
    ".": {
      "types": "./src/index.ts",
      "default": "./src/index.ts"
    }
  },
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "files": [
    "src"
  ],
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "typescript": "^5.9.3",
    "vitest": "^3.0.0",
    "fast-check": "^4.0.0"
  }
}
SATELINK_M0_EOF
ok "libs/kernel/package.json"

say "Writing libs/kernel/tsconfig.json"
cat > 'libs/kernel/tsconfig.json' <<'SATELINK_M0_EOF'
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "./src",
    "outDir": "./dist",
    "noEmit": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist", "src/__arch_fixture__"]
}
SATELINK_M0_EOF
ok "libs/kernel/tsconfig.json"

say "Writing libs/kernel/src/index.ts"
cat > 'libs/kernel/src/index.ts' <<'SATELINK_M0_EOF'
/**
 * @satelink/kernel
 *
 * Pure shared value objects for the Satelink domain layer.
 *
 * INVARIANT: this package imports nothing. Not another lib, not an npm
 * package, not a node builtin. It is the root of the dependency graph and
 * everything else depends on it. Enforced by the `kernel-imports-nothing`
 * rule in .dependency-cruiser.cjs.
 *
 * M0 establishes the package and its enforcement. The contents arrive in M1,
 * beginning with Money — see docs/satelink-milestones.md.
 */

/**
 * Marker for the enforcement harness. Exists so the package has a real export
 * and the toolchain (typecheck, cruise, test) has something to resolve.
 *
 * Removed in M1 when Money lands.
 */
export const KERNEL_VERSION = '0.0.0' as const;

/**
 * Branded identifier helper.
 *
 * Included in M0 because the dependency-cruiser rules reference identifier
 * flow between aggregates, and a compiling example makes the rules verifiable
 * rather than theoretical.
 *
 * @example
 *   type PrincipalId = Brand<string, 'PrincipalId'>;
 *   const id = 'prn_123' as PrincipalId;
 *   const wrong: PrincipalId = 'acc_456' as AccountId; // compile error
 */
export type Brand<T, B extends string> = T & { readonly __brand: B };
SATELINK_M0_EOF
ok "libs/kernel/src/index.ts"

say "Writing tools/architecture-tests/guard.test.ts"
cat > 'tools/architecture-tests/guard.test.ts' <<'SATELINK_M0_EOF'
/**
 * Tests for the architecture enforcement harness itself.
 *
 * The M0 exit gate is: "deliberately add a forbidden import and confirm CI
 * fails with the rule name." This file automates that gate so it runs on every
 * commit rather than once, manually, and then never again.
 *
 * A lint rule nobody has watched fail is a lint rule nobody knows is working.
 *
 * Method: write a violating fixture into the real package tree, cruise it with
 * the production ruleset, assert the expected rule fires, then remove the
 * fixture. Cleanup is in `finally` and the fixture directory is gitignored.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { cruise, type ICruiseResult } from 'dependency-cruiser';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const REPO_ROOT = resolve(__dirname, '../..');
const FIXTURE_DIR = join(REPO_ROOT, 'libs/kernel/src/__arch_fixture__');

/** Load the production ruleset. Tests must never use a bespoke config. */
async function loadConfig(): Promise<Record<string, unknown>> {
  const mod = await import(join(REPO_ROOT, '.dependency-cruiser.cjs'));
  return (mod.default ?? mod) as Record<string, unknown>;
}

/**
 * Write a fixture file and cruise it against the production ruleset.
 * The fixture lives inside libs/kernel so path-based rules actually match.
 */
async function cruiseFixture(filename: string, source: string): Promise<ICruiseResult> {
  mkdirSync(FIXTURE_DIR, { recursive: true });
  const filePath = join(FIXTURE_DIR, filename);
  writeFileSync(filePath, source, 'utf8');

  const config = await loadConfig();

  // The production config excludes __arch_fixture__ so day-to-day cruises stay
  // clean. Strip that exclusion here — this test exists to inspect fixtures.
  //
  // NOTE 1: cruise() expects rules under `ruleSet`, not as a bare `forbidden`
  // key. Passing them at the top level silently produces no validation.
  //
  // NOTE 2: node_modules must NOT be in `exclude`, or the edge to the
  // offending package is deleted and the rule cannot fire. `doNotFollow` from
  // the production options handles the traversal boundary.
  const options = {
    ...(config.options as Record<string, unknown>),
    exclude: {
      path: ['\\.next/', 'dist/', 'build/', 'coverage/'],
    },
    ruleSet: { forbidden: config.forbidden },
    validate: true,
  };

  const result = await cruise([filePath], options as never);
  return result.output as ICruiseResult;
}

/** Rule names that fired anywhere in the cruise result. */
function violatedRules(result: ICruiseResult): string[] {
  return result.summary.violations.map((v) => v.rule.name);
}

afterEach(() => {
  if (existsSync(FIXTURE_DIR)) {
    rmSync(FIXTURE_DIR, { recursive: true, force: true });
  }
});

describe('architecture enforcement harness', () => {
  it('is loadable and defines the expected rule set', async () => {
    const config = await loadConfig();
    const names = (config.forbidden as Array<{ name: string }>).map((r) => r.name);

    // Every rule the blueprint depends on must be present. If a rule is
    // deleted, this test fails rather than silently permitting violations.
    expect(names).toEqual(
      expect.arrayContaining([
        'kernel-imports-nothing',
        'domain-no-node-core',
        'domain-no-io-packages',
        'no-aggregate-to-aggregate',
        'no-financial-to-commerce',
        'no-commerce-to-financial',
        'application-not-to-infrastructure',
        'libs-not-to-services',
        'services-not-to-deployables',
        'no-circular',
      ]),
    );
  });

  it('all structural rules are severity=error, not warn', async () => {
    const config = await loadConfig();
    const rules = config.forbidden as Array<{ name: string; severity: string }>;
    const structural = rules.filter((r) => r.name !== 'no-orphans');

    for (const rule of structural) {
      expect(rule.severity, `rule "${rule.name}" must block the build`).toBe('error');
    }
  });

  // -------------------------------------------------------------------------
  // THE M0 EXIT GATE, automated
  // -------------------------------------------------------------------------

  it('rejects an I/O package imported into libs/kernel', async () => {
    const result = await cruiseFixture(
      'io-violation.ts',
      `import pg from 'pg';\nexport const bad = pg;\n`,
    );

    const fired = violatedRules(result);

    // Both rules must fire. `domain-no-io-packages` is the one that protects
    // libs/financial-domain and libs/commerce-domain, where
    // `kernel-imports-nothing` does not apply — so asserting only the latter
    // would let the important rule silently break.
    expect(fired).toContain('kernel-imports-nothing');
    expect(fired).toContain('domain-no-io-packages');
    expect(result.summary.error).toBeGreaterThan(0);
  });

  it('rejects an I/O package imported into a domain package', async () => {
    // Regression guard: proves domain-no-io-packages works outside kernel,
    // where kernel-imports-nothing provides no cover.
    const dir = join(REPO_ROOT, 'libs/financial-domain/src/__arch_fixture__');
    mkdirSync(dir, { recursive: true });
    const filePath = join(dir, 'io.ts');
    writeFileSync(filePath, `import pg from 'pg';\nexport const bad = pg;\n`, 'utf8');

    try {
      const config = await loadConfig();
      const result = await cruise([filePath], {
        ...(config.options as Record<string, unknown>),
        exclude: { path: ['\\.next/', 'dist/', 'build/', 'coverage/'] },
        ruleSet: { forbidden: config.forbidden },
        validate: true,
      } as never);

      const fired = violatedRules(result.output as ICruiseResult);
      expect(fired).toContain('domain-no-io-packages');
    } finally {
      rmSync(join(REPO_ROOT, 'libs/financial-domain'), { recursive: true, force: true });
    }
  });

  it('rejects a node core module imported into libs/kernel', async () => {
    const result = await cruiseFixture(
      'core-violation.ts',
      `import { readFileSync } from 'node:fs';\nexport const bad = readFileSync;\n`,
    );

    expect(violatedRules(result).length).toBeGreaterThan(0);
    expect(result.summary.error).toBeGreaterThan(0);
  });

  it('accepts a pure module in libs/kernel', async () => {
    const result = await cruiseFixture(
      'pure.ts',
      `export const add = (a: bigint, b: bigint): bigint => a + b;\n`,
    );

    expect(result.summary.error).toBe(0);
  });
});
SATELINK_M0_EOF
ok "tools/architecture-tests/guard.test.ts"

say "Writing tools/architecture-tests/testcontainers.smoke.test.ts"
cat > 'tools/architecture-tests/testcontainers.smoke.test.ts' <<'SATELINK_M0_EOF'
/**
 * Testcontainers smoke test.
 *
 * M2 onward depends on real-Postgres integration tests. This proves the
 * container toolchain works now, so a failure at M2 is a code failure rather
 * than an infrastructure surprise.
 *
 * Excluded from the default `npm test` run because it requires Docker and
 * takes ~20s. Invoked explicitly:
 *
 *   npm run test:integration
 *
 * CI runs it in a dedicated job that is allowed to be slow.
 */

import { describe, it, expect } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';

describe('testcontainers infrastructure', { timeout: 120_000 }, () => {
  it('starts postgres, accepts a connection, and tears down', async () => {
    let container: StartedPostgreSqlContainer | undefined;
    let client: Client | undefined;

    try {
      container = await new PostgreSqlContainer('postgres:16-alpine').start();

      client = new Client({ connectionString: container.getConnectionUri() });
      await client.connect();

      const { rows } = await client.query<{ ok: number }>('SELECT 1 AS ok');
      expect(rows[0]?.ok).toBe(1);

      // Confirms the version the migrations in M2 will target.
      const { rows: version } = await client.query<{ server_version_num: string }>(
        'SHOW server_version_num',
      );
      expect(Number(version[0]?.server_version_num)).toBeGreaterThanOrEqual(160000);
    } finally {
      await client?.end().catch(() => undefined);
      await container?.stop().catch(() => undefined);
    }
  });
});
SATELINK_M0_EOF
ok "tools/architecture-tests/testcontainers.smoke.test.ts"

say "Writing .github/workflows/architecture.yml"
cat > '.github/workflows/architecture.yml' <<'SATELINK_M0_EOF'
# Architecture enforcement.
#
# Deliberately a separate workflow from ci.yml. ci.yml was recently repaired
# (lockfile sync + Node 22) and is serving production; adding jobs to it risks
# that. This workflow can fail independently without blocking unrelated work,
# and can be made required once it has run green for a few days.

name: Architecture

on:
  push:
    branches: [main]
  pull_request:

concurrency:
  group: architecture-${{ github.ref }}
  cancel-in-progress: true

env:
  NODE_VERSION: '22'

jobs:
  layering:
    name: Layering rules
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: npm

      - name: Install
        run: npm ci

      # The gate. Any forbidden import fails the build with the rule name.
      - name: Validate dependency graph
        run: npx depcruise --config .dependency-cruiser.cjs --output-type err-long libs tools

      - name: Typecheck kernel
        run: npm run typecheck --workspace=@satelink/kernel

  guard-tests:
    name: Enforcement harness tests
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: npm

      - name: Install
        run: npm ci

      # Proves the rules actually fire, rather than assuming they do.
      - name: Run architecture guard tests
        run: npx vitest run --project tools

      - name: Run domain tests
        run: npx vitest run --project libs

  integration:
    name: Integration infrastructure
    runs-on: ubuntu-latest
    # Slow (Docker). Not required for merge until M2 depends on it.
    continue-on-error: true
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: npm

      - name: Install
        run: npm ci

      - name: Testcontainers smoke test
        run: npx vitest run --project integration
SATELINK_M0_EOF
ok ".github/workflows/architecture.yml"

say "Writing docs/adr/000-architecture-enforcement.md"
cat > 'docs/adr/000-architecture-enforcement.md' <<'SATELINK_M0_EOF'
# ADR-000: Architecture Enforcement by Lint Rule

**Status:** Accepted
**Date:** 2026-08-01
**Milestone:** M0

## Context

The approved blueprint specifies a layered architecture: a pure domain layer
(`libs/`) with no I/O, aggregates that reference each other only by identifier,
two bounded contexts that never import each other, and dependency inversion
between application and infrastructure.

Architectural rules stated in documentation erode. Not through malice — through
a deadline, an autocomplete import, or an agent making a locally reasonable
choice. By the time erosion is noticed, unwinding it is expensive.

Two options were considered.

**Separate npm packages per layer.** Module boundaries enforce themselves
because a package cannot import what it does not depend on. Costs: twelve
`package.json` files, twelve build configs, version coordination on every
change, and meaningful friction for a solo operator.

**Lint-rule enforcement.** Two packages, layering enforced by
`dependency-cruiser` in CI. Costs: rules can be disabled; enforcement is
advisory unless CI blocks merges.

## Decision

Lint-rule enforcement, with three conditions that make it real rather than
advisory:

1. **Every structural rule is `severity: error`.** Warnings are ignored.
2. **The rules are themselves tested.** `tools/architecture-tests/guard.test.ts`
   writes violating fixtures, cruises them with the production config, and
   asserts the expected rule fires. If a rule is deleted or weakened, that test
   fails.
3. **Package count stays low.** Two domain packages, not twelve. The friction
   saved is real, and the enforcement is equivalent once CI blocks.

## Consequences

**Positive.** Layering is checked on every commit, in seconds. Rules are
readable in one file with the reasoning attached. Adding a rule is a
one-line change rather than a repository restructure.

**Negative.** A determined contributor can add an `eslint-disable`-equivalent
exception. Mitigated by the guard tests and by the config living in a
reviewed file.

**Deferred.** If the domain later needs to be published or consumed
externally, package extraction remains possible. The directory boundaries were
drawn so extraction is mechanical.

## The rule that matters most

`domain-no-io-packages` and `domain-no-node-core` together make
`libs/` unable to import a database driver, an HTTP client, or a node builtin.

This is what guarantees domain tests need no mocks. A domain test requiring a
mock is a signal that logic sits in the wrong layer — and with these rules, that
signal arrives at CI rather than six months later.

## Verification

The exit gate for M0 is a live tripwire, documented in
`docs/M0_VERIFICATION.md` and automated in the guard tests. It must be run
manually once, at M0, so that a human has personally watched the guard fail.
SATELINK_M0_EOF
ok "docs/adr/000-architecture-enforcement.md"

say "Writing docs/M0_VERIFICATION.md"
cat > 'docs/M0_VERIFICATION.md' <<'SATELINK_M0_EOF'
# M0 — Enforcement Harness: Installation & Verification

**Milestone:** M0
**Ships:** `libs/` skeleton, dependency-cruiser rules, vitest + fast-check +
testcontainers, CI enforcement.
**Migrations:** none. M0 touches no database and no runtime code.
**Rollback:** revert the commit. Nothing running depends on any of it.

---

## 1. Install

### 1.1 Files

Copy into the repository root, preserving paths:

```
.dependency-cruiser.cjs
tsconfig.base.json
vitest.config.ts
libs/kernel/package.json
libs/kernel/tsconfig.json
libs/kernel/src/index.ts
tools/architecture-tests/guard.test.ts
tools/architecture-tests/testcontainers.smoke.test.ts
.github/workflows/architecture.yml
docs/adr/000-architecture-enforcement.md
docs/M0_VERIFICATION.md
```

### 1.2 Root `package.json`

Add `libs/*` and `tools` to workspaces, and add the scripts below. Edit the
existing file — do not replace it.

```jsonc
{
  "workspaces": [
    "apps/*",
    "packages/*",
    "libs/*"        // ← add
  ],
  "scripts": {
    // ← add these; keep existing scripts unchanged
    "arch": "depcruise --config .dependency-cruiser.cjs --output-type err-long libs tools",
    "arch:graph": "depcruise --config .dependency-cruiser.cjs --output-type dot libs | dot -T svg > architecture.svg",
    "test:arch": "vitest run --project tools",
    "test:libs": "vitest run --project libs",
    "test:integration": "vitest run --project integration",
    "typecheck:libs": "npm run typecheck --workspace=@satelink/kernel"
  }
}
```

### 1.3 Dependencies

```bash
npm install -D -w . \
  dependency-cruiser@^16 \
  vitest@^3 \
  fast-check@^4 \
  @vitest/coverage-v8@^3 \
  @testcontainers/postgresql@^10 \
  pg@^8
```

`pg` is a root dev dependency only, used by the testcontainers smoke test.
The `domain-no-io-packages` rule prevents it from ever reaching `libs/`.

### 1.4 `.gitignore`

```
# architecture test fixtures (written and removed at test time)
libs/**/__arch_fixture__/
architecture.svg
```

---

## 2. Verify

### 2.1 Rules load and pass on a clean tree

```bash
npm run arch
```

Expected: `no dependency violations found`.

### 2.2 Guard tests pass

```bash
npm run test:arch
```

Expected: 5 passing. These write violating fixtures, cruise them, and assert
the correct rule fires.

### 2.3 Kernel typechecks

```bash
npm run typecheck:libs
```

Expected: no output, exit 0.

### 2.4 Integration infrastructure works

Requires Docker running.

```bash
npm run test:integration
```

Expected: 1 passing, ~20s. Confirms testcontainers can start Postgres 16 —
the dependency M2 onward relies on.

---

## 3. Exit gate — the tripwire

**This must be performed manually, once, by a human.** The guard tests
automate it, but a rule nobody has personally watched fail is a rule nobody
knows is working.

**Step 1.** Introduce a real violation:

```bash
cat >> libs/kernel/src/index.ts <<'EOF'

// TRIPWIRE — remove after verification
import pg from 'pg';
export const tripwire = pg;
EOF
```

**Step 2.** Run the guard locally:

```bash
npm run arch
```

**Required output** — the rule name must appear:

```
  error kernel-imports-nothing: libs/kernel/src/index.ts → pg

✘ 1 dependency violation (1 error, 0 warnings). 2 modules, 1 dependency cruised.
```

**Step 3.** Push to a branch and confirm CI fails:

```bash
git checkout -b chore/m0-tripwire
git add libs/kernel/src/index.ts
git commit -m "test: M0 tripwire — intentional violation, do not merge"
git push origin chore/m0-tripwire
```

Confirm the **Architecture / Layering rules** job fails on GitHub, and that
the failure names `kernel-imports-nothing`.

**Step 4.** Revert and confirm green:

```bash
git checkout libs/kernel/src/index.ts
git commit -am "revert: remove M0 tripwire"
git push
```

Confirm the Architecture workflow passes.

**Step 5.** Delete the branch. Do not merge it.

```bash
git checkout main
git branch -D chore/m0-tripwire
git push origin --delete chore/m0-tripwire
```

### Gate criteria

| # | Criterion | Pass |
|---|---|---|
| 1 | `npm run arch` reports zero violations on a clean tree | ☐ |
| 2 | `npm run test:arch` — 5 passing | ☐ |
| 3 | `npm run typecheck:libs` exits 0 | ☐ |
| 4 | `npm run test:integration` — Postgres 16 container starts | ☐ |
| 5 | **Tripwire: CI fails, naming `kernel-imports-nothing`** | ☐ |
| 6 | Tripwire reverted, CI green | ☐ |

All six required. M0 is not complete until a human has watched criterion 5 fail.

---

## 4. Measure

The M0 milestone metric:

```bash
# Active enforcement rules
node -e "console.log(require('./.dependency-cruiser.cjs').forbidden.length)"
# Expected: 11

# CI time added
# Read from the Architecture workflow run. Target: under 90s for the
# layering + guard-tests jobs combined.
```

---

## 5. What M0 explicitly does not do

- No database migrations. M2 introduces the first.
- No runtime code changes. The RPC gateway, API, and console are untouched.
- No `Money`. That is M1, and it is the first real contents of `libs/kernel`.
- No aggregates. The rules referencing `libs/financial-domain` and
  `libs/commerce-domain` match paths that do not yet exist — deliberately.
  They activate the moment those directories appear, so the first aggregate
  written is already governed.

---

## 6. Next

**M1 — Money.** 2 days. Exit gate: 10⁶ random operations pass associativity,
commutativity, and no-precision-loss; adding two different currencies is a
compile error.
SATELINK_M0_EOF
ok "docs/M0_VERIFICATION.md"

# ------------------------------------------------------- patch package.json
say "Patching root package.json"
node <<'PATCH_EOF'
const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));

// workspaces: add libs/*
const ws = Array.isArray(pkg.workspaces) ? pkg.workspaces : (pkg.workspaces?.packages ?? []);
if (!ws.includes('libs/*')) {
  ws.push('libs/*');
  if (Array.isArray(pkg.workspaces)) pkg.workspaces = ws;
  else pkg.workspaces.packages = ws;
  console.log('  + workspaces: libs/*');
} else {
  console.log('  = workspaces: libs/* already present');
}

// scripts: add without clobbering
pkg.scripts = pkg.scripts || {};
const scripts = {
  'arch': 'depcruise --config .dependency-cruiser.cjs --output-type err-long libs tools',
  'arch:graph': 'depcruise --config .dependency-cruiser.cjs --output-type dot libs | dot -T svg > architecture.svg',
  'test:arch': 'vitest run --project tools',
  'test:libs': 'vitest run --project libs',
  'test:integration': 'vitest run --project integration',
  'typecheck:libs': 'npm run typecheck --workspace=@satelink/kernel',
};
for (const [k, v] of Object.entries(scripts)) {
  if (pkg.scripts[k] && pkg.scripts[k] !== v) {
    console.log(`  ! script "${k}" exists with different value — NOT overwritten`);
  } else if (!pkg.scripts[k]) {
    pkg.scripts[k] = v;
    console.log(`  + script: ${k}`);
  }
}

fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
PATCH_EOF
ok "package.json patched"

# ------------------------------------------------------------- .gitignore
say "Updating .gitignore"
touch .gitignore
grep -q '__arch_fixture__' .gitignore || {
  printf '\n# M0 architecture test fixtures (written and removed at test time)\nlibs/**/__arch_fixture__/\narchitecture.svg\n' >> .gitignore
  ok ".gitignore updated"
}
grep -q '__arch_fixture__' .gitignore && ok "fixture ignore present"

# ------------------------------------------------------------ dependencies
say "Installing dev dependencies (this takes a minute)"
npm install -D \
  dependency-cruiser@^16 \
  vitest@^3 \
  fast-check@^4 \
  @vitest/coverage-v8@^3 \
  @testcontainers/postgresql@^10 \
  pg@^8 \
  --no-audit --no-fund
ok "dependencies installed"

# ------------------------------------------------------------ verification
say "Verification"

echo ""
echo "--- 1/4  npm run arch (expect: zero violations) ---"
if npm run arch; then ok "arch clean"; else die "arch failed — see output above"; fi

echo ""
echo "--- 2/4  npm run typecheck:libs ---"
if npm run typecheck:libs; then ok "kernel typechecks"; else die "typecheck failed"; fi

echo ""
echo "--- 3/4  npm run test:arch (guard tests) ---"
if npm run test:arch; then ok "guard tests pass"; else die "guard tests failed"; fi

echo ""
echo "--- 4/4  rule count ---"
RULES=$(node -e "console.log(require('./.dependency-cruiser.cjs').forbidden.length)")
echo "  $RULES enforcement rules active"
[ "$RULES" = "11" ] && ok "11 rules as expected" || warn "expected 11 rules, found $RULES"

# ------------------------------------------------------------------ tripwire
echo ""
say "M0 EXIT GATE — the tripwire"
echo ""
echo "  A rule nobody has watched fail is a rule nobody knows is working."
echo "  This introduces a real violation, confirms the guard catches it,"
echo "  then reverts. Nothing is committed."
echo ""
printf '  Run the tripwire now? [Y/n] '
read -r reply
if [ "$reply" != "n" ]; then
  cp libs/kernel/src/index.ts /tmp/m0-kernel-backup.ts
  cat >> libs/kernel/src/index.ts <<'TRIPWIRE_EOF'

// TRIPWIRE — auto-reverted by installer
import pg from 'pg';
export const tripwire = pg;
TRIPWIRE_EOF

  echo ""
  echo "  --- violation introduced, running guard ---"
  set +e
  npm run arch
  TRIP_EXIT=$?
  set -e

  cp /tmp/m0-kernel-backup.ts libs/kernel/src/index.ts
  rm -f /tmp/m0-kernel-backup.ts

  echo ""
  if [ "$TRIP_EXIT" -ne 0 ]; then
    ok "TRIPWIRE PASSED — guard blocked the violation (exit $TRIP_EXIT)"
    ok "kernel reverted to clean state"
  else
    die "TRIPWIRE FAILED — guard did NOT block. Enforcement is not working."
  fi

  echo ""
  echo "  --- confirming clean state ---"
  npm run arch >/dev/null 2>&1 && ok "clean tree green again" || die "revert failed"
else
  warn "tripwire skipped — run it manually before accepting M0"
  warn "see docs/M0_VERIFICATION.md section 3"
fi

# ---------------------------------------------------------------------- done
echo ""
say "M0 INSTALLED"
echo ""
echo "  Files created:      11"
echo "  Rules active:       $RULES"
echo "  Migrations:         none (M0 touches no database)"
echo "  Runtime changes:    none (RPC gateway, API, console untouched)"
echo ""
echo "  Next:"
echo "    git checkout -b chore/m0-enforcement-harness"
echo "    git add .dependency-cruiser.cjs tsconfig.base.json vitest.config.ts"
echo "    git add libs/kernel tools/architecture-tests"
echo "    git add .github/workflows/architecture.yml docs/adr docs/M0_VERIFICATION.md"
echo "    git add package.json package-lock.json .gitignore"
echo "    git commit -m 'chore(arch): M0 architecture enforcement harness'"
echo "    git push origin chore/m0-enforcement-harness"
echo ""
echo "  Then run the M1 prompt."
echo ""
