/**
 * Satelink-OS elevation. Dark consoles use border + subtle glow rather than
 * heavy drop shadows. Mirrored as `--sat-elev-*` in theme.css.
 */
export const elevation = {
  flat: 'none',
  raised: '0 1px 0 rgba(255,255,255,0.02), 0 2px 8px rgba(0,0,0,0.35)',
  overlay: '0 8px 32px rgba(0,0,0,0.5)',
  // accent glow for live/active surfaces
  glowPrimary: '0 0 12px rgba(94,234,212,0.25)',
  glowDanger: '0 0 12px rgba(239,68,68,0.25)',
} as const;

export type ElevationToken = keyof typeof elevation;
