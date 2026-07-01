/**
 * @satelink/ui — Satelink Design System v2 (single source of truth).
 *
 * Foundation: shadcn primitives + Radix + Tailwind semantic tokens
 * (./styles/theme.css, `.satelink-os` scope). OS and Admin compose from these
 * dashboard-level primitives only — no bespoke shells, cards, or hardcoded
 * colors. Reference density: shadcn finance dashboard.
 */

// design tokens (single source of truth for state → color)
export {
  STATE_META,
  normalizeState,
  MOTION,
  FONT_MONO_NUMERIC,
} from "./tokens";
export type { SystemState, StateMeta } from "./tokens";

// utils + hooks
export { cn } from "./lib/utils";
export { useIsMobile } from "./hooks/use-mobile";
export { useEndpoint } from "./hooks/use-endpoint";

// base primitives (shadcn / Radix)
export { Button, buttonVariants } from "./components/ui/button";
export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardAction,
  CardDescription,
  CardContent,
} from "./components/ui/card";
export {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "./components/ui/table";
export { Badge, badgeVariants } from "./components/ui/badge";
export { Skeleton } from "./components/ui/skeleton";
export { Input } from "./components/ui/input";
export { Separator } from "./components/ui/separator";
export {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "./components/ui/tooltip";
export {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
  ChartStyle,
} from "./components/ui/chart";
export type { ChartConfig } from "./components/ui/chart";

// dashboard shell (replaces AppShell)
export { DashboardShell } from "./components/dashboard-shell";
export type {
  DashboardShellProps,
  ShellNavItem,
  ShellNavGroup,
  ShellSearchItem,
} from "./components/dashboard-shell";

// core Grafana-grade primitives
export { Panel } from "./components/panel";
export type { PanelProps } from "./components/panel";
export { KPIStat } from "./components/kpi-stat";
export type { KPIStatProps } from "./components/kpi-stat";
export { StatusPill, HealthBadge } from "./components/status-pill";
export type { StatusPillProps, HealthBadgeProps } from "./components/status-pill";

// dashboard-level primitives
export { KPIGrid } from "./components/kpi-grid";
export type { KPIGridProps } from "./components/kpi-grid";
export { KPICard, StatusCard, MetricCard } from "./components/metrics-cards";
export type { KPICardProps, StatusCardProps, MetricCardProps } from "./components/metrics-cards";
// Keep StatCard around temporarily to prevent breaking changes during refactor
export { StatCard } from "./components/stat-card";
export type { StatCardProps } from "./components/stat-card";
export { MetricTrend } from "./components/metric-trend";
export type { MetricTrendProps } from "./components/metric-trend";
export { DashboardSection } from "./components/dashboard-section";
export type { DashboardSectionProps } from "./components/dashboard-section";
export { PageHeader } from "./components/page-header";
export type { PageHeaderProps } from "./components/page-header";
export { DataTable } from "./components/data-table";
export type { DataTableColumn, DataTableProps } from "./components/data-table";
export { StatusBadge } from "./components/status-badge";
export type { StatusBadgeProps } from "./components/status-badge";
export { GrafanaPanel } from "./components/grafana-panel";
export type { GrafanaPanelProps } from "./components/grafana-panel";
export { LogPanel } from "./components/monitoring-panels";
export type { MonitoringPanelProps } from "./components/monitoring-panels";

// state primitives
export { EmptyState } from "./components/empty-state";
export type { EmptyStateProps } from "./components/empty-state";
export { ErrorState } from "./components/error-state";
export type { ErrorStateProps } from "./components/error-state";
export { LoadingState } from "./components/loading-state";
export type { LoadingStateProps } from "./components/loading-state";

// resilience
export { ErrorBoundary } from "./components/error-boundary";
export type { ErrorBoundaryProps } from "./components/error-boundary";
export { AsyncBoundary } from "./components/async-boundary";
export type { AsyncBoundaryProps } from "./components/async-boundary";

// Elevated domain components
export * from "./components/charts";
export * from "./components/tables";
export * from "./components/topology";

// Grafana-inspired components
export { SparklineKPICard } from "./components/grafana/SparklineKPICard";
export { StatRow } from "./components/grafana/StatRow";
export { TimeseriesPanel } from "./components/grafana/TimeseriesPanel";
export { LogFeed } from "./components/grafana/LogFeed";
export { AlertBand } from "./components/grafana/AlertBand";
export { HeatmapPanel } from "./components/grafana/HeatmapPanel";
