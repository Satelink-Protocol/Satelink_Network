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
