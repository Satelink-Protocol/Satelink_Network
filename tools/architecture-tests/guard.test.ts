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
