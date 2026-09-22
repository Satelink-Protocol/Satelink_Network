"use client";
// Satelink Signal 2.0 — motion primitives (P1 §2.3).
// Framer Motion via LazyMotion + domAnimation ONLY (small bundle). Every
// primitive respects prefers-reduced-motion: it renders the final, static state
// with no animation. No parallax, no scroll-jacking.
import * as React from "react";
import {
  LazyMotion,
  domAnimation,
  m,
  useReducedMotion,
  useInView,
  animate,
} from "framer-motion";

// Self-contained provider so any primitive works without a page-level wrapper.
// Nested LazyMotion is allowed; domAnimation loads once.
function MP({ children }: { children: React.ReactNode }) {
  return <LazyMotion features={domAnimation}>{children}</LazyMotion>;
}

/** Optional single wrapper for a page/section (identical to the built-in one). */
export function MotionProvider({ children }: { children: React.ReactNode }) {
  return <MP>{children}</MP>;
}

export interface ScrollRevealProps {
  children: React.ReactNode;
  /** ms delay before the reveal starts. */
  delay?: number;
  /** px the element translates up from (default 12). */
  y?: number;
  as?: "div" | "section" | "li" | "span";
  className?: string;
}

/** Fade + translate-up 12px over 220ms when scrolled into view (once). */
export function ScrollReveal({ children, delay = 0, y = 12, as = "div", className }: ScrollRevealProps) {
  const reduce = useReducedMotion();
  const ref = React.useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "0px 0px -10% 0px" });
  const Comp = m[as];
  if (reduce) {
    const Static = as;
    return <Static className={className}>{children}</Static>;
  }
  return (
    <MP>
      <Comp
        ref={ref as never}
        className={className}
        initial={{ opacity: 0, y }}
        animate={inView ? { opacity: 1, y: 0 } : { opacity: 0, y }}
        transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1], delay: delay / 1000 }}
      >
        {children}
      </Comp>
    </MP>
  );
}

export interface StaggerProps {
  children: React.ReactNode;
  /** seconds between each child (default 0.06). */
  step?: number;
  className?: string;
}

/** Staggered reveal for a grid/list of children. Wrap each child in StaggerItem. */
export function Stagger({ children, step = 0.06, className }: StaggerProps) {
  const reduce = useReducedMotion();
  const ref = React.useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "0px 0px -10% 0px" });
  if (reduce) return <div className={className}>{children}</div>;
  return (
    <MP>
      <m.div
        ref={ref}
        className={className}
        initial="hidden"
        animate={inView ? "show" : "hidden"}
        variants={{ show: { transition: { staggerChildren: step } }, hidden: {} }}
      >
        {children}
      </m.div>
    </MP>
  );
}

/** A single item inside <Stagger>. */
export function StaggerItem({ children, className }: { children: React.ReactNode; className?: string }) {
  const reduce = useReducedMotion();
  if (reduce) return <div className={className}>{children}</div>;
  return (
    <MP>
      <m.div
        className={className}
        variants={{
          hidden: { opacity: 0, y: 12 },
          show: { opacity: 1, y: 0, transition: { duration: 0.22, ease: [0.16, 1, 0.3, 1] } },
        }}
      >
        {children}
      </m.div>
    </MP>
  );
}

export interface CountUpProps {
  /** Target numeric value. */
  value: number;
  /** Decimal places (default 0). */
  decimals?: number;
  prefix?: string;
  suffix?: string;
  /** seconds (default 1.2). */
  duration?: number;
  className?: string;
  /** Locale grouping (default true). */
  group?: boolean;
}

/** Animated number count-up — ONLY for real/live values. Reduced-motion and
 *  the SSR pass render the final value immediately (no flash of zero). */
export function CountUp({
  value,
  decimals = 0,
  prefix = "",
  suffix = "",
  duration = 1.2,
  className,
  group = true,
}: CountUpProps) {
  const reduce = useReducedMotion();
  const format = React.useCallback(
    (n: number) =>
      prefix +
      n.toLocaleString(undefined, {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
        useGrouping: group,
      }) +
      suffix,
    [prefix, suffix, decimals, group]
  );
  const [display, setDisplay] = React.useState(() => format(value));
  const ref = React.useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });

  React.useEffect(() => {
    if (reduce || !inView) {
      setDisplay(format(value));
      return;
    }
    const controls = animate(0, value, {
      duration,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (n) => setDisplay(format(n)),
    });
    return () => controls.stop();
  }, [value, inView, reduce, duration, format]);

  return (
    <span ref={ref} className={className} data-sl>
      {display}
    </span>
  );
}

export interface HoverLiftProps {
  children: React.ReactNode;
  className?: string;
}

/** Subtle lift + shadow on hover (cards). Disabled under reduced-motion. */
export function HoverLift({ children, className }: HoverLiftProps) {
  const reduce = useReducedMotion();
  if (reduce) return <div className={className}>{children}</div>;
  return (
    <MP>
      <m.div
        className={className}
        whileHover={{ y: -4 }}
        transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
      >
        {children}
      </m.div>
    </MP>
  );
}
