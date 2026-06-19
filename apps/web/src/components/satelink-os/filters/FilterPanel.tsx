import React, { type ReactNode } from 'react';
import { Panel } from '../shared/Panel';
import { SectionLabel } from '../shared/SectionLabel';

export interface FilterPanelProps {
  children: ReactNode;
  title?: string;
}

export function FilterPanel({ children, title = 'Filters' }: FilterPanelProps): JSX.Element {
  return (
    <Panel>
      <SectionLabel>{title}</SectionLabel>
      <div style={{ marginTop: '16px' }}>{children}</div>
    </Panel>
  );
}
