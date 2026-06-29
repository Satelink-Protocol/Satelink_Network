'use client';

import { ReactNode } from 'react';

export default function MachineLayout({ children }: { children: ReactNode }) {
  return (
    <div className="satelink-os min-h-screen bg-background text-foreground">
      {children}
    </div>
  );
}
