// Form primitives — Field wrapper (label + error) plus Input, Textarea,
// Select, Checkbox. All keyboard-accessible, labelled, with a visible
// focus-visible ring and an aria-invalid error style.
import * as React from "react";
import { cn } from "@/lib/utils";

const controlBase =
  "w-full rounded-[var(--sl-radius-sm)] border border-sl-border bg-sl-bg-raised px-3 py-2.5 text-sm text-sl-text " +
  "placeholder:text-sl-text-subtle transition-colors " +
  "focus-visible:outline-none focus-visible:border-sl-accent focus-visible:ring-2 focus-visible:ring-sl-accent/35 " +
  "aria-[invalid=true]:border-sl-down aria-[invalid=true]:ring-sl-down/30 disabled:opacity-55";

export interface FieldProps {
  label: string;
  htmlFor: string;
  error?: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
}

export function Field({ label, htmlFor, error, hint, required, children, className }: FieldProps) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={htmlFor} className="text-sm font-medium text-sl-text">
        {label}
        {required && <span className="ml-0.5 text-sl-down"> *</span>}
      </label>
      {children}
      {hint && !error && <p className="text-xs text-sl-text-subtle">{hint}</p>}
      {error && (
        <p className="text-xs text-sl-down" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input ref={ref} className={cn(controlBase, className)} {...props} />
  )
);
Input.displayName = "Input";

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea ref={ref} className={cn(controlBase, "min-h-28 resize-y", className)} {...props} />
));
Textarea.displayName = "Textarea";

export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, children, ...props }, ref) => (
  <select ref={ref} className={cn(controlBase, "appearance-none pr-8", className)} {...props}>
    {children}
  </select>
));
Select.displayName = "Select";

export const Checkbox = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement> & { label: React.ReactNode }
>(({ className, label, id, ...props }, ref) => (
  <label htmlFor={id} className="flex cursor-pointer items-start gap-2.5 text-sm text-sl-text-muted">
    <input
      ref={ref}
      id={id}
      type="checkbox"
      className={cn(
        "mt-0.5 size-4 shrink-0 rounded-[4px] border border-sl-border bg-sl-bg-raised accent-[var(--sl-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sl-accent/45",
        className
      )}
      {...props}
    />
    <span>{label}</span>
  </label>
));
Checkbox.displayName = "Checkbox";
