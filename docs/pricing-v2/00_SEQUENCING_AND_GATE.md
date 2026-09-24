# Pricing V2 — sequencing & the merge gate (A0)

**This is PHASE 1–2 (audit + docs only). No Pricing V2 feature code exists yet.**
Per instruction: "Do not start Pricing V2 on top of a five-PR stack... Pricing V2
branches from main after the founder has merged #404 → #401 → #405 → #402 →
#403. If they are not merged yet, do PHASE 1–2 (audit only, docs only) and stop
there." This branch (`docs/pricing-v2-audit`) is cut directly from `main` and
contains **zero production code** — only this design/audit package. It does not
depend on the five-PR stack merging, and merging it changes nothing at runtime.

## Review status of the five-PR chain (checked live, 2026-09-23)

| # | Branch | → base | State | Reviewed? | Mergeable? |
|---|---|---|---|---|---|
| **#404** | `fix/api-test-harness` | `main` | OPEN | No review submitted | Yes (no conflicts) |
| **#401** | `feat/web-machine-commerce-reposition` | `main` | OPEN | No review submitted | Yes |
| **#405** | `feat/web-ia-v2-claude-pattern` | `feat/web-machine-commerce-reposition` (#401) | OPEN | No review submitted | Yes |
| **#402** | `feat/web-v3-experience` | `feat/web-ia-v2-claude-pattern` (#405) | OPEN | No review submitted | Yes |
| **#403** | `feat/api-auth-and-plans` | `main` | OPEN | No review submitted | Yes |

Two more PRs were opened during this same session, outside the original five,
and are **not** part of the merge-order gate but are worth noting here since
they affect what "main" looks like once the chain lands:
- **#406** `fix/deposit-listener-cursor-resume` → `main` — the real money-path
  bug fix (A1). Own PR, independent of the chain, highest priority.
- This PR itself (Pricing V2 audit/docs) → `main`.

**I have not merged anything — the founder merges.** All five (plus #406) are
still open and unreviewed as of this check. Per the gate above, no Pricing V2
implementation branch should be started from `main` until the chain lands in
order. This package is the complete PHASE 1–2 deliverable to work from once it
does.

## What's in this package
- `01_PAYMENTS_BOUNDARY.md` — A2, audited against what Track B (#403) already
  built; confirms alignment, flags the one thing worth double-checking.
- `02_USAGE_UNIT_MODEL.md` — A3, the UU conversion table (verified by
  independent recomputation) + the §59 economic validation (Dodo fees, the
  worst-case dispute analysis on the $5 Launch payment, and mitigations).
- `03_DODO_CAPABILITY_VERIFICATION.md` — A4, researched (not assumed) against
  Dodo's own documentation: the real mechanism for "$5 first cycle then $19,"
  and India RBI e-mandate behavior.
- `04_CREATOR_AFFILIATE_PROGRAM.md` — A5, design spec only (no code): accrual
  model, disclosure requirement, truth-lint extension.
- `05_SCOPE_TRIMS.md` — A8, the explicit non-goals for this pass.

DNS (A7) is handled separately in `docs/web/INFRA_SETUP.md` (a docs-only
addition, no live Cloudflare/Vercel calls made) — see that file's new
Cloudflare section. The secret-scan pre-push step (A7) is a small, independent
repo-tooling change, not gated by the merge chain, delivered in its own PR.
