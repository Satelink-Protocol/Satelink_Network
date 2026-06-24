import React from 'react';

export interface FilterCheckboxProps {
  label: string;
  count?: number;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

export function FilterCheckbox({ label, count, checked, onChange }: FilterCheckboxProps): JSX.Element {
  return (
    <label style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      width: '100%',
      padding: '4px 0',
      cursor: 'pointer',
      userSelect: 'none'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <input 
          type="checkbox" 
          checked={checked} 
          onChange={(e) => onChange(e.target.checked)}
          style={{
            accentColor: 'var(--sat-primary)',
            cursor: 'pointer'
          }}
        />
        <span style={{ fontSize: '11px', fontFamily: 'var(--sat-font-sans)', color: 'var(--sat-text-secondary)' }}>
          {label}
        </span>
      </div>
      {count !== undefined && (
        <span style={{ fontSize: '9px', fontFamily: 'var(--sat-font-mono)', color: 'var(--sat-text-dim)' }}>
          {count}
        </span>
      )}
    </label>
  );
}
