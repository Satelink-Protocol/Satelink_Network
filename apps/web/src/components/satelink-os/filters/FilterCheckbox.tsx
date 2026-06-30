import React from 'react';

export interface FilterCheckboxProps {
  label: string;
  count?: number;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

export function FilterCheckbox({ label, count, checked, onChange }: FilterCheckboxProps): JSX.Element {
  return (
    <label className="flex items-center justify-between w-full py-1 cursor-pointer select-none">
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="accent-primary cursor-pointer"
        />
        <span className="text-[11px] font-sans text-foreground/70">
          {label}
        </span>
      </div>
      {count !== undefined && (
        <span className="text-[9px] font-mono text-muted-foreground">
          {count}
        </span>
      )}
    </label>
  );
}
