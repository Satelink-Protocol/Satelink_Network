import React, { useState, type ReactNode } from 'react';

export interface FilterGroupProps {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
}

export function FilterGroup({ title, children, defaultOpen = true }: FilterGroupProps): JSX.Element {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ borderBottom: '1px solid var(--sat-border)', paddingBottom: '12px', marginBottom: '12px' }}>
      <button 
        type="button" 
        onClick={() => setOpen(!open)}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          width: '100%',
          background: 'transparent',
          border: 'none',
          color: 'var(--sat-text)',
          fontFamily: 'var(--sat-font-sans)',
          fontSize: '11px',
          fontWeight: 600,
          cursor: 'pointer',
          padding: '4px 0',
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
          textAlign: 'left'
        }}
      >
        <span>{title}</span>
        <span style={{ fontSize: '9px', color: 'var(--sat-text-dim)' }}>{open ? '▼' : '▶'}</span>
      </button>
      {open && <div style={{ marginTop: '8px' }}>{children}</div>}
    </div>
  );
}
