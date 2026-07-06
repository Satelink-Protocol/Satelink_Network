# @satelink/ui — Phase 1 migration note (2026-07-06, ui/finished-dashboard)

**What stays:** the existing stack already matches the target — Next.js React,
Tailwind v4, shadcn/Radix primitives (`src/components/ui/*`), Recharts,
lucide-react. All component APIs, the `.satelink-os` scope, and the semantic
var names (`--card`, `--border`, `--success`, …) are unchanged; no app logic
was rewritten.

**What's replaced:** (1) token *values* in `styles/theme.css` retargeted from
the blue-tinted palette to the spec scale — `#0A0A0B / #111113 / #18181B`
surfaces, `#27272A / #3F3F46` borders, `#FAFAFA / #A1A1AA / #71717A` text,
semantic `#22C55E / #F59E0B / #EF4444 / #3B82F6`, accent teal `#2DD4BF`
(actions + live data only); (2) all glow effects (panel hover, status-dot
box-shadows) removed — flat borders only; (3) `dry-run` state now amber, not
violet; (4) new exports: `Modal` (opaque, blurred backdrop, right-aligned
actions — fixes the transparent-modal production bug), `CopyField`, and the
raw `Dialog` primitives. Render-check every component at `/design`.
