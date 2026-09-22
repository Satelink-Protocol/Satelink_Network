// Button — Satelink Signal primitive.
// Renders a <button> or, with `asChild`, merges into a single child (e.g. a
// Next <Link>) via Radix Slot. Variants/sizes via cva; focus-visible ring;
// dark + light via --sl-* tokens.
import * as React from "react";
import { Slot } from "radix-ui";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";

export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap font-semibold " +
    "transition-colors duration-[var(--sl-dur-1)] ease-[var(--sl-ease)] " +
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sl-accent/45 focus-visible:ring-offset-0 " +
    "disabled:pointer-events-none disabled:opacity-55 " +
    "[&_svg]:size-[1.05em] [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary:
          "bg-sl-accent text-sl-accent-ink hover:bg-sl-accent-strong shadow-[var(--sl-shadow-1)]",
        secondary:
          "bg-sl-surface text-sl-text border border-sl-border hover:bg-sl-surface-hover hover:border-sl-border-strong",
        ghost: "bg-transparent text-sl-text-muted hover:text-sl-text hover:bg-sl-surface",
        link: "bg-transparent text-sl-accent hover:text-sl-accent-strong underline-offset-4 hover:underline p-0 h-auto",
      },
      size: {
        sm: "h-9 rounded-[var(--sl-radius-sm)] px-3 text-[0.8125rem]",
        md: "h-11 rounded-[var(--sl-radius)] px-[18px] text-sm",
        lg: "h-[52px] rounded-[var(--sl-radius)] px-6 text-[0.9375rem]",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, loading = false, children, disabled, ...props }, ref) => {
    const Comp = asChild ? Slot.Root : "button";
    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size }), className)}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {loading ? (
          <>
            <span
              aria-hidden
              className="size-[1em] animate-spin rounded-full border-2 border-current border-r-transparent"
            />
            <span className="sr-only">Loading</span>
            {children}
          </>
        ) : (
          children
        )}
      </Comp>
    );
  }
);
Button.displayName = "Button";
