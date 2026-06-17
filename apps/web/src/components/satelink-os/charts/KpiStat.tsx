import type { ReactNode } from 'react';

import { MetricCard } from '../metrics/MetricCard';
import type { Tone } from '../shared/types';

export interface KpiStatProps {
  label: string;
  value: ReactNode;
  sub?: string;
  tone?: Tone;
  alert?: boolean;
}

/** Single headline KPI. Wraps MetricCard so KPI styling stays centralized. */
export function KpiStat(props: KpiStatProps): JSX.Element {
  return <MetricCard {...props} />;
}
