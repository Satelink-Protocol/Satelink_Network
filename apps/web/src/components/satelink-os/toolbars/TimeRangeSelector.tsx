import React from 'react';

export interface TimeRangeSelectorProps {
  value?: string;
}

export function TimeRangeSelector({ value = 'SINCE LAUNCH (183d)' }: TimeRangeSelectorProps): JSX.Element {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      padding: '3px 8px',
      background: 'var(--sat-bg-0)',
      border: '1px dashed var(--sat-border)',
      borderRadius: 'var(--sat-radius-md)',
      fontFamily: 'var(--sat-font-mono)',
      fontSize: '10px'
    }}>
      <span style={{ color: 'var(--sat-text-dim)', fontWeight: 500, letterSpacing: '0.5px' }}>RANGE</span>
      <span style={{ color: 'var(--sat-primary)', fontWeight: 600 }}>{value}</span>
    </div>
  );
}
