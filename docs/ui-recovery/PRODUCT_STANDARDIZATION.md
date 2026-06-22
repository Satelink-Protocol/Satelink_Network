# PRODUCT_STANDARDIZATION.md

Standard: every product page composes from `@satelink/ui` primitives — `DashboardShell`,
`KPIGrid`, `StatCard`, `DashboardSection`, `DataTable`, `LoadingState`/`AsyncBoundary`,
`ErrorBoundary`, `EmptyState`.

Audited surface: `apps/web/src/app/{satelink/os/*, admin/*, docs, page.tsx}`.

---

## Primitive adoption matrix (verified via grep)

| Page | Shell* | KPIGrid | StatCard | Section | DataTable | Async/Loading | Empty | StatusBadge | Verdict |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|
| os/overview | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ | **Compliant** |
| os/nodes | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ | **Compliant** |
| os/usage | ✅ | ✅ | ✅ | — | ✅ | ✅ | ✅ | ✅ | Minor: wrap in `DashboardSection` |
| os/deposit | ✅ | ✅ | ✅ | — | — | — | ✅ | — | Gap: no `AsyncBoundary`/`DashboardSection` |
| os/keys | ✅ | — | — | — | ✅ | ✅ | — | ✅ | Gap: no KPI strip, no `EmptyState`, no `DashboardSection` |
| admin/command-center | ✅ | ✅ | ✅ | ✅ | ✅ | — (custom) | ✅ | ✅ | See `COMMAND_CENTER_V3_PLAN.md` |
| docs | — | — | — | — | — | — | — | — | Exempt (markdown) — keep shell-less |
| page (landing) | — | — | — | — | — | — | — | — | Exempt (marketing) — keep bespoke |

\* "Shell" = wrapped by `DashboardShell` via the new `src/app/satelink/os/layout.tsx`
(untracked — commit it). `command-center` wraps `DashboardShell` directly in its own page.

> Note on `ErrorBoundary`: OS pages use `AsyncBoundary`, which composes loading + error +
> empty per widget (`packages/ui/src/components/async-boundary.tsx`). That satisfies the
> ErrorBoundary requirement at the widget level. A top-level `ErrorBoundary` in
> `os/layout.tsx` is still recommended as a crash backstop (see action S0).

---

## Actions (file-by-file)

### S0 — Commit the OS shell + add a crash backstop
- `git add apps/web/src/app/satelink/os/layout.tsx` (currently untracked).
- In `layout.tsx`, wrap `{children}` with `<ErrorBoundary>` from `@satelink/ui` so a thrown
  page can't blank the whole shell.

### S1 — `os/keys/page.tsx`
- Add a `KPIGrid` strip: total keys, active keys, requests today (sum), tier.
  Components already imported pattern exists in `os/usage`.
- Wrap the key table in `<DashboardSection title="API Keys">`.
- Add `<EmptyState>` for the zero-keys case (currently only `AsyncBoundary` + `DataTable`).
- Keep `StatusBadge` per-key status.

### S2 — `os/deposit/page.tsx`
- Wrap the deposit/pricing blocks in `<DashboardSection>` for consistent headers.
- Replace ad-hoc loading markup with `<AsyncBoundary>` around the balance/pricing fetch.
- Keep existing `KPIGrid`/`StatCard`/`EmptyState`.

### S3 — `os/usage/page.tsx`
- Wrap each chart/table block in `<DashboardSection>` (matches overview/nodes structure).
  Otherwise already compliant.

### S4 — `docs/page.tsx` (exempt, optional polish)
- Leave shell-less, but optionally render inside the OS shell when reached from
  `/satelink/os/*` so docs feel in-product (P2).

### S5 — `landing page.tsx` (exempt)
- No change. Marketing surface intentionally bespoke.

---

## Definition of done

```bash
# every os page reachable under one shell, no per-page shell duplication
grep -rn "DashboardShell" apps/web/src/app/satelink/os   # only layout.tsx
# no page builds its own loading/error markup outside AsyncBoundary/LoadingState
```
Standardization is ~80% complete already; remaining work is S1/S2 (real gaps) + S0 (commit).
