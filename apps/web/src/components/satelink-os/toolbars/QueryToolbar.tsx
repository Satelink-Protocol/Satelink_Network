import React, { type ReactNode } from 'react';

export interface QueryToolbarProps {
  left?: ReactNode;
  right?: ReactNode;
}

export function QueryToolbar({ left, right }: QueryToolbarProps): JSX.Element {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '16px',
      padding: '8px 16px',
      background: 'var(--sat-bg-1)',
      borderBottom: '1px solid var(--sat-border)',
      minHeight: '40px'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>{left}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>{right}</div>
    </div>
  );
}
