import { Cell, Pie, PieChart, ResponsiveContainer } from 'recharts';

import { chartPalette } from '../theme/colors';
import { ChartFrame } from './ChartFrame';

export interface DonutSlice {
  name: string;
  value: number;
}

export interface DonutChartProps {
  title: string;
  data: DonutSlice[] | null;
  emptyNote?: string;
  height?: number;
}

/** Donut/share chart with empty-state contract. */
export function DonutChart({
  title,
  data,
  emptyNote = 'Requires telemetry pipeline',
  height = 150,
}: DonutChartProps): JSX.Element {
  const hasData = Array.isArray(data) && data.length > 0;
  return (
    <ChartFrame title={title} hasData={hasData} emptyNote={emptyNote}>
      {hasData ? (
        <ResponsiveContainer width="100%" height={height}>
          <PieChart>
            <Pie data={data ?? []} dataKey="value" nameKey="name" innerRadius={42} outerRadius={64} stroke="none">
              {(data ?? []).map((slice, i) => (
                <Cell key={slice.name} fill={chartPalette[i % chartPalette.length]} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
      ) : null}
    </ChartFrame>
  );
}
