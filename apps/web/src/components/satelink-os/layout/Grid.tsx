import type { ReactNode } from 'react';

import styles from './Grid.module.css';

type Gap = 'sm' | 'md' | 'lg';

export interface StackProps {
  children: ReactNode;
  gap?: Gap;
}
/** Vertical flex stack. */
export function Stack({ children, gap = 'sm' }: StackProps): JSX.Element {
  return (
    <div className={styles.stack} data-gap={gap}>
      {children}
    </div>
  );
}

export interface InlineProps {
  children: ReactNode;
  gap?: Gap;
  wrap?: boolean;
}
/** Horizontal flex row (e.g. button groups). */
export function Inline({ children, gap = 'sm', wrap = true }: InlineProps): JSX.Element {
  return (
    <div className={styles.inline} data-gap={gap} data-wrap={wrap ? '1' : undefined}>
      {children}
    </div>
  );
}

export interface SplitProps {
  children: ReactNode;
  aside: ReactNode;
  asideWidth?: 'sm' | 'md';
  asidePosition?: 'left' | 'right';
  gap?: Gap;
}
/** Two-column layout with a fixed-width aside on either side. */
export function Split({
  children,
  aside,
  asideWidth = 'sm',
  asidePosition = 'right',
  gap = 'sm',
}: SplitProps): JSX.Element {
  return (
    <div className={styles.split} data-pos={asidePosition} data-w={asideWidth} data-gap={gap}>
      {asidePosition === 'left' ? <div>{aside}</div> : null}
      <div className={styles.splitMain}>{children}</div>
      {asidePosition === 'right' ? <div>{aside}</div> : null}
    </div>
  );
}
