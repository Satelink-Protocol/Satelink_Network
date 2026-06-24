# COST ANALYSIS — Paperclip Agent Model Spend

**Date:** 2026-06-13.

## VERIFIED CONFIG (before fix)

`start-cloud.sh:44-51` writes `~/.claude/settings.json` for the Paperclip claude CLI (`claude_local` adapter):

```js
const settings = {
  hasCompletedOnboarding: true,
  autoUpdaterStatus: 'disabled',
  model: 'claude-sonnet-4-6',            // ← default model for every agent call
  largeContextModel: 'claude-sonnet-4-6',
  smallModel: 'claude-haiku-4-5-20251001',
  theme: 'dark'
};
```

The default `model` (used for routine agent turns) was **claude-sonnet-4-6**. Paperclip runs 12 agents (`agents.satelink.network`, ✅ live: `{"status":"ok"}`).

## FIX APPLIED (this audit)

`start-cloud.sh:47` changed `model: 'claude-sonnet-4-6'` → **`model: 'claude-haiku-4-5-20251001'`**.
`largeContextModel` left as `claude-sonnet-4-6` so genuinely large-context/complex turns still escalate to Sonnet. `smallModel` was already Haiku.

```diff
-      model: 'claude-sonnet-4-6',
+      model: 'claude-haiku-4-5-20251001',
       largeContextModel: 'claude-sonnet-4-6',
       smallModel: 'claude-haiku-4-5-20251001',
```

`sh -n start-cloud.sh` → OK.

## COST IMPACT (order-of-magnitude estimate)

> **Caveat — not independently verified:** I have no access to the Anthropic billing console from this environment, so the "$6.51/day burn" figure in the audit brief is **unconfirmed**. The untracked `anthropic_admin_check.sh` in the repo suggests someone was probing billing. The per-token *ratio* below is sound; the absolute dollar figures inherit the brief's call-volume assumption (~17.2k input tokens/call).

Sonnet input ≈ 12× Haiku input per token. At the brief's assumed volume:

| | Sonnet 4.6 (before) | Haiku 4.5 (after) |
|---|---|---|
| Per-call (17.2k in) | ~$0.052 | ~$0.0043 |
| Daily (brief's cadence) | ~$5.18 | ~$0.43 |
| Reduction | — | **~12×** |

## RECOMMENDATIONS BEYOND THE MODEL SWITCH

1. **This change only takes effect on the next Paperclip container rebuild** — `start-cloud.sh` writes settings.json at container start. Pushing to a branch that Railway auto-builds (or a manual `railway up`) is required; until then agents keep using Sonnet.
2. The bigger cost lever is **agent pulse frequency** — confirm how often the 12 agents wake (the brief references "48 pulses/day"). Reducing cadence compounds with the model switch.
3. Consider capping `largeContextModel` usage — if agents routinely hit large-context, they'll still escalate to Sonnet and erode the savings.
