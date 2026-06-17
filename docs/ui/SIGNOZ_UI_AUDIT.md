# SigNoz Frontend — UI Architecture Audit

> Reverse-engineering audit of `./signoz/frontend` performed to derive the
> Satelink-OS design system. Findings are drawn from reading the actual source
> tree (`signoz/frontend/src`). Where a detail is inferred from naming/structure
> rather than line-by-line reading, it is marked _(inferred)_.

## Stack summary (observed)

| Concern | SigNoz | Notes |
|---|---|---|
| Build | Vite | `vite.config.ts`, not Next |
| Framework | React 18.2 | |
| Component kit | **Ant Design 5.11** + `@signozhq/ui` | `antd` `Flex`, `Tooltip`, `Table`, etc. |
| Styling | **styled-components 5.3** + **SCSS** | co-located `*.styles.ts` and `*.styles.scss` |
| Design tokens | **`@signozhq/design-tokens` 2.1.4** + `constants/theme.ts` | external token pkg + large in-repo color map |
| Charts | **uPlot 1.6** | high-perf canvas; not recharts |
| Dates | dayjs | |
| Class composition | `classnames` (`cx`) | conditional classNames |
| Scroll | `OverlayScrollbar` wrapper | custom scrollbars |

The Satelink stack is **Next 15 App Router + Tailwind v4 + CSS variables + geist**, no
antd/styled-components. The audit therefore extracts SigNoz *architecture and patterns*,
not its exact dependencies — see `SATELINK_UI_ARCHITECTURE.md` for the adaptation.

---

## 1. Layout shell architecture
`src/container/AppLayout/` — `index.tsx` composes the whole authenticated app:
`<SideNav/>` + `<TopNav/>` + a scrollable content region (wrapped in
`OverlayScrollbar`), with `react-helmet-async` driving the document title.
Shell-level concerns live here: version/changelog checks, error boundary fallback,
global keyboard shortcuts, dark-mode class, chat/AI overlays. Styling split across
`AppLayout.styles.scss` (layout) and `styles.ts` (styled-components).

**Takeaway:** one shell component owns chrome (nav + top bar + scroll + title);
pages render only into the content region.

## 2. Navigation architecture
`src/container/SideNav/` — a structured, data-driven sidebar:
`config.ts` + `menuItems.tsx` define the nav model, `NavItem/` renders an item,
`helper.ts` resolves active route, `sideNav.types.ts` types it, `SideNav.styles.scss`
styles it. Collapsible, route-aware (active highlight), icon + label per item.

**Takeaway:** nav is a typed config array → rendered by a generic `NavItem`, not
hand-written markup per link.

## 3. Header / top bar architecture
`src/container/TopNav/` + `components/Header/` + `components/HeaderRightSection/`.
Persistent top bar holds global controls (time picker, search/cmd-K, environment,
right-aligned utility cluster). `FullScreenHeader/` is a variant for focus modes.

## 4. Page container architecture
Pages live under `src/pages/` and feature containers under `src/container/`. Pages are
thin: they set title (Helmet) and compose container components. Content is constrained
by the shell's scroll region rather than per-page width hacks.

## 5. Grid system
Dashboard grids via `container/GridCardLayout/` (a react-grid-layout style draggable/
resizable card grid). Ant Design `Row`/`Col` and `Flex` for general layout. Cards are
the grid unit.

## 6. Design token system
Two layers: (a) the external **`@signozhq/design-tokens`** package, and (b)
`src/constants/theme.ts` — a very large nested color map (`traceDetailColors`,
`traceDetailColorsV3` with named blues/cyans/teals, chart palettes). Tokens are
referenced by name, not raw hex, in components.

## 7. Theme system
Ant Design 5's `ConfigProvider` theme + CSS variables + SCSS partials
(`styles.scss`, `periscope.scss`). A single source of truth feeds antd's theme object
and the SCSS variables.

## 8. Dark mode implementation
`hooks/useDarkMode` / `useIsDarkMode` returns the active mode; the shell applies a
mode class on the root and switches the antd theme token set. Dark is the primary,
default surface.

## 9. Typography hierarchy
Driven by token/SCSS variables (font family, size, weight, line-height scale). UI text
vs. monospace/operational data are distinct families. Consistent scale rather than
ad-hoc font sizes.

## 10. Ant Design usage
Pervasive: `Table`, `Tooltip`, `Flex`, `Row/Col`, `Drawer`, `Modal`, `Skeleton`,
`Tabs`, `Input`, `Select`, `Badge`, `Tag`, `Button`, `Empty`. SigNoz wraps many of
these in thin in-repo components (`components/Input`, `components/Badges`,
`HttpStatusBadge`) to centralize styling/behavior.

## 11. Reusable UI primitives — the `periscope` library
`src/periscope/components/` is SigNoz's internal primitive layer, the most important
pattern for us. Observed primitives include:
`Card`, `Tabs2`, `DataStateRenderer`, `KeyValueLabel`, `BetaTag`, `ContextMenu`,
`CopyToClipboard`, `DataViewer`, `JsonView`, `LineClampedText`, `TrimmedText`,
`SeeMore`, `ResizableBox`, `FloatingPanel`, `PaginationInfoText`.

**Takeaway:** a dedicated primitive directory, separate from feature components, is
the backbone. Satelink-OS mirrors this with `components/satelink-os/`.

## 12. Table architecture
Ant Design `Table` as the base, extended via in-repo components
(`DraggableTableRow`, `MembersTable`, `DownloadOptionsMenu`, `antd-table-saveas-excel`
for export). Columns are typed config; loading/empty handled by the table + the
state-renderer pattern.

## 13. Chart architecture
uPlot under a `components/Graph` wrapper plus `GridCardLayout` for dashboard panels.
Charts receive a normalized series model; rendering is decoupled from data fetching.

## 14. Filter architecture
A query-builder system (`ClientSideQBSearch`, `FieldsSelector`, an ANTLR-generated
`FilterQueryLexer`/parser under `src/parser/`). Filters are structured query objects,
not free strings.

## 15. Search architecture
Command palette (`components/cmdKPalette`) for global navigation/search, plus
context-scoped search inputs. Global search is a first-class top-bar control.

## 16. Status badge architecture
Dedicated badge components: `components/Badges`, `HttpStatusBadge`,
`ChangePercentagePill`, `periscope/BetaTag`. Status → color/label mapping is
centralized per badge type rather than inlined at call sites.

## 17. Drawer / modal architecture
Ant `Drawer` and `Modal` wrapped per feature: `EditMemberDrawer`, `ChangelogModal`,
`ErrorModal`, `InviteMembersModal`, `CreateServiceAccountModal`. Side detail panels use
`DetailsPanel`/`FloatingPanel`.

## 18. Empty state architecture
Ant `Empty` plus the **`DataStateRenderer`** render-prop primitive (see §20). Empty is
a distinct, intentional state — never simulated/placeholder data.

## 19. Loading state architecture
`components/Spinner`, `AppLoading`, `Loadable` (route-level code-split loading). The
state-renderer shows the spinner while `isLoading || isRefetching || !data`.

## 20. Skeleton architecture
Ant `Skeleton` for content-shaped placeholders during fetch. The canonical state flow
is captured by `periscope/components/DataStateRenderer/DataStateRenderer.tsx`:

```tsx
// loading/refetching/no-data -> Spinner ; error/null -> error ; else -> children(data)
function DataStateRenderer<T>({ isLoading, isRefetching, isError, data, ... }) {
  if (isLoading || isRefetching || !data) return <Spinner tip={loadingMessage} />;
  if (isError || data === null) return <div>{errorMessage ?? 'something_went_wrong'}</div>;
  return <>{children(data)}</>;
}
```

This four-state contract — **loading → error → empty → data** — is the single most
reusable idea in the SigNoz UI and becomes `shared/EmptyState` + `DataState` in
Satelink-OS.

---

## What Satelink-OS adopts vs. adapts

| Adopt (architecture) | Adapt (because stack differs) |
|---|---|
| Shell = SideNav + TopBar + content + page-title | styled-components/SCSS → **CSS Modules + CSS variables** |
| Data-driven typed nav config | antd `ConfigProvider` → scoped `.sat-os` CSS-variable theme |
| Dedicated primitive library (`periscope` → `satelink-os`) | uPlot → **recharts** (already a dep) |
| Token system (named colors, type scale, spacing) | `@signozhq/design-tokens` → in-repo `theme/*.ts` + `theme.css` |
| `DataStateRenderer` four-state contract | antd `Table`/`Empty`/`Skeleton` → in-repo `DataTable`/`EmptyState`/`Skeleton` |
| Centralized status-badge mapping | antd `Drawer`/`Modal` → lightweight in-repo equivalents |
