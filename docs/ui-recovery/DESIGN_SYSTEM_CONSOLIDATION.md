# DESIGN_SYSTEM_CONSOLIDATION.md

Goal: `@satelink/ui` (`packages/ui`) becomes the ONLY source of UI primitives.
End-state: every UI import in `apps/web` originates from `@satelink/ui` (domain
visualizations excepted until extracted).

---

## Current state (verified)

`packages/ui/src/components/ui/` exports (the SSOT):
`badge, button, card, command, dialog, input, separator, sheet, sidebar, skeleton, table, tooltip`

`apps/web/src/components/ui/` (the drifted fork — to remove):
`badge, button, card, chart, input, separator, sheet, sidebar, skeleton, table, tooltip`

Diff result: **all overlapping files differ** (see `UI_AUDIT.md §3`).
Importers of the fork: only `sidebar.tsx` (self) and `shadcn-trial/CustomerZeroCard.tsx`.
**No page imports `@/components/ui`.**

---

## Actions (file-by-file)

### A. Remove the dead fork

```bash
# 1. Delete the trial component that is the only external importer of the fork
git rm apps/web/src/components/shadcn-trial/CustomerZeroCard.tsx

# 2. Confirm no remaining importers outside the fork itself
grep -rn "@/components/ui" apps/web/src --include="*.tsx" --include="*.jsx" \
  | grep -v "src/components/ui/"
#   expected: no output

# 3. Delete the drifted fork directory
git rm -r apps/web/src/components/ui
```

**Exception — `chart.tsx`:** it has no `packages/ui` equivalent. Before step 3, decide:
- If unused (confirm `grep -rn "components/ui/chart" apps/web/src`), delete with the rest.
- If used, **promote it**: move to `packages/ui/src/components/ui/chart.tsx`, add an export
  line in `packages/ui/src/index.ts`, import from `@satelink/ui` at call sites.

### B. Reconcile `command` and `dialog`

`packages/ui` has `command.tsx` and `dialog.tsx`; the web fork does not. `DashboardShell`'s
search palette already consumes `command` internally. No action — these only live in the
SSOT, which is correct.

### C. Verify the `sidebar` situation

`packages/ui/src/components/ui/sidebar.tsx` (547L) is the canonical one and feeds
`DashboardShell`. The web fork's 726L `sidebar.tsx` is unused chrome from v1 — removed in
step A.3. No call site re-points needed (no page imports it).

### D. Domain visualizations (deferred to PRODUCT_STANDARDIZATION + COMMAND_CENTER plans)

The 7 domain-viz components used by `command-center` stay in `satelink-os` until extracted
into `@satelink/ui`. They are charts/features, not primitives, so they do **not** block the
"all primitives from @satelink/ui" goal.

---

## Files modified / removed (summary)

| Action | Path |
|---|---|
| REMOVE | `apps/web/src/components/ui/` (badge, button, card, input, separator, sheet, sidebar, skeleton, table, tooltip) |
| REMOVE | `apps/web/src/components/shadcn-trial/CustomerZeroCard.tsx` |
| DECIDE | `apps/web/src/components/ui/chart.tsx` → promote to `packages/ui` or delete |
| REMOVE | `apps/web/src/app/admin/command-center/page.jsx.bak` |
| KEEP | `packages/ui/src/components/ui/*` (SSOT, unchanged) |

## Imports replaced

**Zero page-level import rewrites required** — no page imports the fork. Consolidation here
is pure dead-code deletion. This is the lowest-risk high-impact cleanup in the whole program.

## Verification

```bash
cd apps/web && pnpm build   # or: npm run build
# Then confirm only @satelink/ui supplies primitives:
grep -rn "from \"@/components/ui" apps/web/src   # expected: no output
```
