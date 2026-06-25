import React from 'react';
import { cn } from '@satelink/ui';

export type TimeRangeValue = '1H' | '24H' | '7D' | '30D' | '90D';

export interface TimeRangeSelectorProps {
  value?: TimeRangeValue;
  onChange?: (value: TimeRangeValue) => void;
  className?: string;
}

const RANGES: { label: string; value: TimeRangeValue }[] = [
  { label: '1H', value: '1H' },
  { label: '24H', value: '24H' },
  { label: '7D', value: '7D' },
  { label: '30D', value: '30D' },
  { label: '90D', value: '90D' },
];

export function TimeRangeSelector({ 
  value = '24H', 
  onChange,
  className 
}: TimeRangeSelectorProps): JSX.Element {
  return (
    <div className={cn("inline-flex items-center rounded-md border border-border bg-muted/20 p-1 font-mono text-[11px]", className)}>
      <span className="px-2 font-medium text-muted-foreground mr-1">RANGE</span>
      <div className="flex items-center gap-1">
        {RANGES.map((range) => (
          <button
            key={range.value}
            onClick={() => onChange?.(range.value)}
            className={cn(
              "px-2 py-1 rounded transition-colors",
              value === range.value
                ? "bg-primary text-primary-foreground font-bold shadow-sm"
                : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
            )}
          >
            {range.label}
          </button>
        ))}
      </div>
    </div>
  );
}
