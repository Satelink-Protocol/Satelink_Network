import styles from './Input.module.css';

export interface InputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  ariaLabel?: string;
  disabled?: boolean;
  /** Monospace input (e.g. typed confirmations, addresses). */
  mono?: boolean;
}

/** Single-line text input primitive — the only input control in the system. */
export function Input({
  value,
  onChange,
  placeholder,
  ariaLabel,
  disabled,
  mono,
}: InputProps): JSX.Element {
  return (
    <input
      className={styles.input}
      data-mono={mono ? '1' : undefined}
      value={value}
      placeholder={placeholder}
      aria-label={ariaLabel}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
