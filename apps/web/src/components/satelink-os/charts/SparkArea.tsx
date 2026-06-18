import { useId } from 'react';
import { Area, AreaChart, YAxis } from 'recharts';

import { colors } from '../theme/colors';

export interface SparkAreaProps {
  /**
   * Raw values, oldest → newest.
   * - empty/null → renders nothing (no fabricated shape)
   * - exactly one value → flat level line (honest: a known value, no trend yet)
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

  // A single known value has no trend yet — duplicate it into a flat level line
  // rather than inventing motion. Never fabricate intermediate points.
  const series = (values.length === 1 ? [values[0], values[0]] : values).map((y, x) => ({
    x,
    y,
  }));

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
          <stop offset="100%" stopColor={color} stopOpacity={0} />
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
