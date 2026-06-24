import type { ReactNode } from 'react';

import type { Tone } from '../shared/types';
import styles from './Button.module.css';

export interface ButtonProps {
  children: ReactNode;
  onClick?: () => void;
  tone?: Tone;
  size?: 'sm' | 'md';
  disabled?: boolean;
  title?: string;
}

/** Outline button — the single button primitive. */
export function Button({
  children,
  onClick,
  tone = 'muted',
  size = 'md',
  disabled,
  title,
}: ButtonProps): JSX.Element {
  return (
    <button
      type="button"
      className={styles.btn}
      data-tone={tone}
      data-size={size}
      onClick={onClick}
      disabled={disabled}
      title={title}
    >
      {children}
    </button>
  );
}
