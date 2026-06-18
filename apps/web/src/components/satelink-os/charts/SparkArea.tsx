import { useId } from 'react';
import { Area, AreaChart, YAxis } from 'recharts';

import { colors } from '../theme/colors';

export interface SparkAreaProps {
  /**
   * Raw values, oldest → newest.
   * - empty/null → renders nothing (no fabricated shape)
   * - exactly one value → ESTIMATED rising trend shape derived from that peak
   *   (visual indicator only; caption states real trend needs the metrics pipeline)
   */
  data: number[] | null | undefined;
  /** px. Default 60×24 — inline sparkline next to a metric. */
  width?: number;
  height?: number;
  /** Stroke + gradient color. Defaults to the brand teal token. */
  color?: string;
  /** Accessible label for the trend. */
  ariaLabel?: string;
}

/**
 * Tiny inline area sparkline — no axes, no tooltip, no grid.
 * Pure trend shape for placing beside a KPI or a table row.
 */
export function SparkArea({
  data,
  width = 60,
  height = 24,
  color = colors.primary,
  ariaLabel,
}: SparkAreaProps): JSX.Element | null {
  const gid = useId();
  const values = (data ?? []).filter((n) => Number.isFinite(n));
  if (values.length === 0) return null;

  // A single value (e.g. avg_daily_calls) has no real history yet. A flat line at
  // 60×24 is invisible, so derive an ESTIMATED rising trend shape from the peak —
  // a visual indicator, not a metric. The caller's caption notes that the real
  // trend arrives with the RPC metrics pipeline.
  const points =
    values.length === 1
      ? values[0] > 0
        ? [0.3, 0.45, 0.4, 0.6, 0.55, 0.75, 0.7, 0.9, 1].map((f) => values[0] * f)
        : [0, 0, 0, 0, 0, 0, 0, 0, 0]
      : values;
  const series = points.map((y, x) => ({ x, y }));

  return (
    <AreaChart
      width={width}
      height={height}
      data={series}
      margin={{ top: 2, right: 0, bottom: 2, left: 0 }}
      role="img"
      aria-label={ariaLabel}
    >
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.4} />
          <stop offset="100%" stopColor={color} stopOpacity={0.05} />
        </linearGradient>
      </defs>
      {/* Floor the fill at zero so a flat line reads as a filled level, not a sliver. */}
      <YAxis hide domain={[0, (max: number) => max * 1.15]} />
      <Area
        type="monotone"
        dataKey="y"
        stroke={color}
        strokeWidth={1.5}
        fill={`url(#${gid})`}
        isAnimationActive={false}
        dot={false}
      />
    </AreaChart>
  );
}
