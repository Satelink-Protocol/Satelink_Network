# Satelink UI Design System

## Architecture
Single source: `@satelink/ui` package
All components imported from `packages/ui/src/index.ts`

## Token Reference
| Token Name | HSL Value | Hex Equivalent | Usage Context |
| :--- | :--- | :--- | :--- |
| `--background` | `220 20% 4%` | `#080A0C` (approx `#090D15`) | Main dashboard surface (near-black with blue tint) |
| `--foreground` | `210 20% 92%` | `#E5E8EC` | Cool white text for primary content |
| `--card` | `220 18% 8%` | `#111518` | Dark card surface |
| `--card-border` | `217 25% 16%` | `#1E2533` | Subtle blue-grey border for cards/panels |
| `--primary` | `174 80% 38%` | `#13AE9E` | Satelink teal accent for primary actions and active states |
| `--muted` | `220 15% 11%` | `#181B20` | Subdued panel backgrounds and alternating rows |
| `--muted-foreground`| `215 15% 55%` | `#788293` | Subdued labels and secondary text |
| `--success` | `152 65% 38%` | `#21A063` | Positive trends, "good" status |
| `--warning` | `38 90% 52%` | `#F6A816` | Amber for warnings, "warning" status |
| `--destructive`| `0 72% 42%` | `#B81E1E` | Red for errors, "critical" status |
| `--chart-1` | `174 80% 48%` | `#18DCC8` | Primary teal for chart series |
| `--chart-2` | `200 85% 55%` | `#29A6EE` | Electric blue for chart series |
| `--chart-3` | `38 90% 55%` | `#F7B121` | Amber/warning for chart series |
| `--chart-4` | `152 65% 45%` | `#28BE76` | Green/success for chart series |

## Component Catalog
*(Existing primitives like `Button`, `Card`, `Badge`, `KPICard`, `DashboardShell` are documented in code and imported directly from `@satelink/ui`)*

## Grafana Components (NEW)
These components use Grafana-inspired density, dark teal branding, and precise tabular-nums for metrics.

### SparklineKPICard
File: `packages/ui/src/components/grafana/SparklineKPICard.tsx`
Props: `SparklineKPICardProps`
```tsx
import { SparklineKPICard } from "@satelink/ui";

<SparklineKPICard 
  label="API Requests (1h)" 
  value="1.2M" 
  unit="req/s" 
  status="good"
  sparkData={[12, 15, 20, 18, 25, 30, 28]} 
  trend={12.4} 
/>
```

### StatRow
File: `packages/ui/src/components/grafana/StatRow.tsx`
Props: `StatRowProps`
```tsx
import { StatRow } from "@satelink/ui";

<StatRow 
  stats={[
    { label: "Success Rate", value: "99.99", unit: "%", status: "good", colorize: true },
    { label: "Errors", value: "2", status: "critical", colorize: true }
  ]} 
/>
```

### TimeseriesPanel
File: `packages/ui/src/components/grafana/TimeseriesPanel.tsx`
Props: `TimeseriesPanelProps`
```tsx
import { TimeseriesPanel } from "@satelink/ui";

<TimeseriesPanel 
  title="Gateway Traffic"
  timeRange="1h"
  data={[{ ts: 1718000000, value1: 400, value2: 120 }]}
  series={[
    { key: "value1", label: "Inbound", type: "area" },
    { key: "value2", label: "Outbound", type: "line" }
  ]}
/>
```

### LogFeed
File: `packages/ui/src/components/grafana/LogFeed.tsx`
Props: `LogFeedProps`
```tsx
import { LogFeed } from "@satelink/ui";

<LogFeed 
  logs={[
    { id: 1, timestamp: Date.now(), level: "error", process: "gateway", message: "Timeout" }
  ]} 
/>
```

### AlertBand
File: `packages/ui/src/components/grafana/AlertBand.tsx`
Props: `AlertBandProps`
```tsx
import { AlertBand } from "@satelink/ui";

<AlertBand 
  alerts={[
    { code: "ERR_503", message: "Service Unavailable", severity: "critical" }
  ]} 
/>
```

### HeatmapPanel
File: `packages/ui/src/components/grafana/HeatmapPanel.tsx`
Props: `HeatmapPanelProps`
```tsx
import { HeatmapPanel } from "@satelink/ui";

<HeatmapPanel 
  title="Latency Heatmap"
  data={[[10, 20, 5], [5, 40, 10]]}
  colorScale="teal"
/>
```

## Future Roadmap
- Components planned but not yet built: Drill-down histograms, unified trace view, dynamic node topology minimaps.
- Design decisions deferred: Refactoring the legacy `KPICard` entirely to use `SparklineKPICard` internally to unify APIs.

## Debug Guide
Common issues and fixes:
- **Theme not applying** → check `.satelink-os` wrapper class is correctly bound to the AppShell or DashboardShell.
- **recharts not rendering** → check `ResponsiveContainer` has an explicit `height` or its parent container has absolute sizing (e.g. `h-[200px]` or `absolute inset-0`).
- **Tailwind arbitrary values not working** → check `next.config` content globs include `packages/ui`.
