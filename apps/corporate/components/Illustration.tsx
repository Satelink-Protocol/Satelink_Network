// Original single-weight line illustrations, one per vertical. Decorative:
// aria-hidden, stroke uses currentColor so the parent sets the colour.

type Kind = "network" | "crates" | "globe" | "gear" | "pages" | "mission";

const paths: Record<Kind, React.ReactNode> = {
  network: (
    <>
      <circle cx="60" cy="60" r="8" />
      <circle cx="160" cy="40" r="8" />
      <circle cx="200" cy="120" r="8" />
      <circle cx="110" cy="140" r="8" />
      <circle cx="40" cy="150" r="6" />
      <path d="M67 56 L152 43 M166 46 L195 113 M192 123 L118 138 M103 136 L66 67 M104 143 L46 149 M154 46 L115 133" />
      <path d="M130 90 m-22 0 a22 22 0 1 0 44 0 a22 22 0 1 0 -44 0" strokeDasharray="3 5" />
    </>
  ),
  crates: (
    <>
      <path d="M40 150 L40 95 L100 95 L100 150 Z M100 150 L100 95 L160 95 L160 150 Z M70 95 L70 40 L130 40 L130 95" />
      <path d="M40 95 L55 80 L85 80 L100 95 M100 95 L115 80 L145 80 L160 95 M70 40 L85 25 L115 25 L130 40" />
      <path d="M180 150 L180 120 L215 120 L215 150 M172 150 L225 150" />
      <path d="M20 160 L230 160" />
    </>
  ),
  globe: (
    <>
      <circle cx="120" cy="95" r="62" />
      <ellipse cx="120" cy="95" rx="26" ry="62" />
      <path d="M58 95 L182 95 M68 62 L172 62 M68 128 L172 128" />
      <path d="M20 40 C 60 10, 180 10, 220 40" strokeDasharray="4 6" />
      <path d="M212 32 L220 40 L209 43" />
    </>
  ),
  gear: (
    <>
      <circle cx="100" cy="95" r="22" />
      <path d="M100 45 L100 60 M100 130 L100 145 M50 95 L65 95 M135 95 L150 95 M65 60 L75 70 M125 120 L135 130 M65 130 L75 120 M125 70 L135 60" />
      <circle cx="100" cy="95" r="40" />
      <circle cx="175" cy="140" r="16" />
      <circle cx="175" cy="140" r="6" />
      <path d="M175 116 L175 124 M175 156 L175 164 M151 140 L159 140 M191 140 L199 140" />
    </>
  ),
  pages: (
    <>
      <path d="M60 40 L150 40 L170 60 L170 160 L60 160 Z M150 40 L150 60 L170 60" />
      <path d="M80 80 L150 80 M80 95 L150 95 M80 110 L150 110 M80 125 L125 125" />
      <path d="M40 60 L40 175 L150 175" />
    </>
  ),
  mission: (
    <>
      <circle cx="80" cy="100" r="50" />
      <circle cx="160" cy="100" r="50" />
      <path d="M120 70 L120 130" strokeDasharray="3 5" />
      <circle cx="120" cy="100" r="4" />
    </>
  ),
};

export function Illustration({ kind, className = "" }: { kind: Kind; className?: string }) {
  return (
    <svg
      viewBox="0 0 240 190"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {paths[kind]}
    </svg>
  );
}
