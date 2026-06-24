# LEGACY_FRONTEND_PLAN.md

Goal: end-state has `apps/web` as the only frontend; `apps/dashboard` removed or archived.
No ambiguity.

---

## Disposition of `apps/dashboard` (verified facts)

- **112 page files** (`find apps/dashboard/src/app -name page.tsx | wc -l` → 112).
- **0** imports of `@satelink/ui` (`grep -rl "@satelink/ui" apps/dashboard/src` → 0).
- Maintains its **own** `components/ui` fork + `components/{admin,landing,dashboard,...}`.
- `package.json` declares `"next": "^0.4.1"` — an invalid Next version → **not buildable
  as-is**; strong signal the app is abandoned.
- **Not referenced** by any `vercel.json` / `railway.json` deploy config → not in the
  production path. `app.satelink.network` serves `apps/web`.

**Verdict: ARCHIVE the app, MIGRATE a small set of unique admin surfaces, DELETE the rest.**

---

## Page classification

`apps/dashboard` contains a large admin/ops IA that `apps/web` does **not** yet have. Most is
stale, but the *information architecture* is valuable as a reference for `COMMAND_CENTER_V3`.

| Class | Buckets (representative paths) | Action |
|---|---|---|
| **DELETE** (superseded / marketing dupes) | `about`, `how-it-works`, `investors`, `legal`, `developers`, `enterprise`, `governance`, `economics`, `network/*`, `node*`, `builder/*`, `dashboard`, `login`, `403`, `account/*` | Remove — `apps/web` owns landing/auth/product; these are dead duplicates. |
| **MIGRATE** (IA reference → command-center views) | `admin/revenue/*`, `admin/settlement/*`, `admin/network/{fleet,nodes,reputation}`, `admin/security/*`, `admin/rewards/*`, `admin/treasury`, `admin/ops/*` | Do **not** port the code. Use as the spec for the new command-center sections in `COMMAND_CENTER_V3_PLAN.md` (Billing/Security/Settlement/Alert). |
| **ARCHIVE** (everything else under `admin/*`) | `admin/{beta,diagnostics,distributors,drills,forensics,growth,launch,partners,preflight,reports,support,system,users}` | Keep history via git; remove from working tree. |
| **KEEP** | — | Nothing in `apps/dashboard` is kept live. |

> The `admin/*` tree is the most useful artifact here: it's a ready-made map of the cockpit
> sections Datadog/Cloudflare-class products expose. Mine it for `COMMAND_CENTER_V3`, then drop it.

---

## Execution (file actions)

### Step 1 — Snapshot the IA before deleting (cheap insurance)
```bash
# Record the full admin route map for command-center reference
find apps/dashboard/src/app/admin -name page.tsx | sort \
  > docs/ui-recovery/legacy-admin-ia.txt
git add docs/ui-recovery/legacy-admin-ia.txt
```

### Step 2 — Archive the app out of the active workspace
The app is matched by the root `workspaces: ["apps/*", ...]` glob. Remove it from the build
graph and the tree:
```bash
git rm -r apps/dashboard
git commit -m "chore(web): retire legacy apps/dashboard (superseded by apps/web + @satelink/ui)"
```
History is preserved in git; the route map lives in `legacy-admin-ia.txt`. If a softer move is
preferred, `git mv apps/dashboard archive/dashboard` and add `archive/*` to a workspace-ignore,
but deletion is cleaner given 0 design-system adoption and an unbuildable `package.json`.

### Step 3 — Confirm nothing else references it
```bash
grep -rln "apps/dashboard\|workspace:dashboard\|\"dashboard\"" \
  package.json turbo.json vercel.json railway.json docker-compose*.yml 2>/dev/null
# resolve any hits (likely none in deploy configs)
```

### Step 4 — Verify the remaining frontend still builds
```bash
cd apps/web && npm run build
```

---

## End-state
```
apps/web        canonical frontend  (Next 15.5, @satelink/ui)
packages/ui     single source of UI primitives (@satelink/ui)
apps/dashboard  REMOVED  (IA preserved in docs/ui-recovery/legacy-admin-ia.txt + git history)
```
