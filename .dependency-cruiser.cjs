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
