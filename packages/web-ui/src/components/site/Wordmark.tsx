// Wordmark — the brand layer's only logo element. A small orbit mark (a node on
// a ring: one machine linked to another) + the name set in the editorial
// display serif shared with jakuraa.com. Colour comes from currentColor and
// --sl-accent, so it follows the theme.
export function Wordmark({ name = "Satelink", className }: { name?: string; className?: string }) {
  return (
    <span className={"inline-flex items-center gap-2 " + (className ?? "")}>
      <svg aria-hidden viewBox="0 0 24 24" className="size-[22px]" fill="none">
        <circle cx="12" cy="12" r="8.25" stroke="currentColor" strokeWidth="1.5" />
        <circle cx="12" cy="12" r="2.25" fill="currentColor" />
        <circle cx="18.2" cy="6.6" r="2.25" fill="var(--sl-accent)" />
      </svg>
      <span className="font-sl-display text-[21px] leading-none tracking-[-0.01em]">{name}</span>
    </span>
  );
}
