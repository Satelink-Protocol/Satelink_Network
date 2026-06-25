"use client";
import React from 'react';

export interface HorizontalMetricBarProps {
  value: number;
  max: number;
  color?: string;
  label?: string;
  suffix?: string;
}

export function HorizontalMetricBar({
  value,
  max,
  color = 'var(--success)',
  label,
  suffix = '',
}: HorizontalMetricBarProps): JSX.Element {
  const pct = Math.min(100, Math.round(((value || 0) / (max || 1)) * 100));
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <div style={{ width: 60, height: 6, background: 'rgba(255, 255, 255, 0.08)', borderRadius: 3, overflow: 'hidden', position: 'relative' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 3 }} />
      </div>
      <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace', fontSize: 11, color: 'var(--foreground)', minWidth: 24 }}>
        {label !== undefined ? label : `${pct}${suffix}`}
      </span>
    </div>
  );
}
