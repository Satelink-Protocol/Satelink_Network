import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { colors } from '../theme/colors';
import { ChartFrame } from './ChartFrame';

export interface SeriesPoint {
  x: string | number;
  y: number;
}

export interface SeriesChartProps {
  title: string;
  /** null/empty → empty state. Never pass simulated data. */
  data: SeriesPoint[] | null;
  type?: 'area' | 'line' | 'bar';
  emptyNote?: string;
  height?: number;
  color?: string;
}

const tooltipStyle = {
  background: colors.bg2,
  border: `1px solid ${colors.border}`,
  borderRadius: 0,
  fontSize: 10,
};
const axisTick = { fill: colors.textMuted, fontSize: 8 };

/** Area / Line / Bar series chart with empty-state contract. */
export function SeriesChart({
  title,
  data,
  type = 'area',
  emptyNote = 'Requires telemetry pipeline',
  height = 120,
  color = colors.primary,
}: SeriesChartProps): JSX.Element {
  const hasData = Array.isArray(data) && data.length > 0;
  return (
    <ChartFrame title={title} hasData={hasData} emptyNote={emptyNote}>
      {hasData ? (
        <ResponsiveContainer width="100%" height={height}>
          {type === 'area' ? (
            <AreaChart data={data ?? []}>
              <XAxis dataKey="x" tick={axisTick} />
              <YAxis hide />
              <Tooltip contentStyle={tooltipStyle} />
              <Area dataKey="y" stroke={color} strokeWidth={1.5} fill={color} fillOpacity={0.15} dot={false} />
            </AreaChart>
          ) : type === 'line' ? (
            <LineChart data={data ?? []}>
              <XAxis dataKey="x" tick={axisTick} />
              <YAxis hide />
              <Tooltip contentStyle={tooltipStyle} />
              <Line dataKey="y" stroke={color} strokeWidth={1.5} dot={false} />
            </LineChart>
          ) : (
            <BarChart data={data ?? []}>
              <XAxis dataKey="x" tick={axisTick} />
              <YAxis hide />
              <Tooltip contentStyle={tooltipStyle} />
              <Bar dataKey="y" fill={color} fillOpacity={0.8} />
            </BarChart>
          )}
        </ResponsiveContainer>
      ) : null}
    </ChartFrame>
  );
}

/** Thin named wrappers (Phase 9 API surface). */
export const AreaChartPanel = (p: Omit<SeriesChartProps, 'type'>): JSX.Element => (
  <SeriesChart {...p} type="area" />
);
export const LineChartPanel = (p: Omit<SeriesChartProps, 'type'>): JSX.Element => (
  <SeriesChart {...p} type="line" />
);
export const BarChartPanel = (p: Omit<SeriesChartProps, 'type'>): JSX.Element => (
  <SeriesChart {...p} type="bar" />
);
