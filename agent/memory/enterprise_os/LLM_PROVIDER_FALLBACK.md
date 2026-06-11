# LLM PROVIDER FALLBACK — NVIDIA Nemotron (free tier)
# Status: PREPARED, not yet applied (Paperclip adapter config lives in the
# Paperclip DB/UI, not in this repo)

## Current state (audited 2026-06-12)

- All Paperclip agents use `adapter_type = 'claude_local'`
  (see scripts/paperclip_agent_migration.sql) — they do NOT call OpenRouter.
- OPENROUTER_API_KEY appears only in the migration plan
  (OPENROUTER_MIGRATION.md). The key was EXPOSED — treat as invalid, do
  not wire it into any new code. Rotate before any OpenRouter migration.

## Fallback provider: NVIDIA Nemotron

| Setting   | Value |
|-----------|-------|
| Base URL  | https://integrate.api.nvidia.com/v1 |
| Model     | nvidia/llama-3.1-nemotron-ultra-253b-v1 |
| Env var   | NVIDIA_API_KEY |
| Protocol  | OpenAI-compatible chat completions |

## How to apply

1. Get a free API key at https://build.nvidia.com and set it on the
   Paperclip Railway service:
     railway variables set "NVIDIA_API_KEY=nvapi-..."
2. In the Paperclip UI (agents.satelink.network), for each agent that
   should fall back when its primary adapter is unavailable, add an
   OpenAI-compatible adapter:
     adapter_type:  openai_compatible
     base_url:      https://integrate.api.nvidia.com/v1
     model:         nvidia/llama-3.1-nemotron-ultra-253b-v1
     api_key_env:   NVIDIA_API_KEY
3. Fallback order: claude_local → nemotron. Only use the fallback when
   OPENROUTER_API_KEY is unset/invalid (it currently is) and the local
   Claude adapter is unavailable.

## Guardrails

- Nemotron is a free tier: rate limits are tight. Keep it for the
  low-frequency pulse agents (REVENUE_PULSE, HEALTH_PULSE,
  SECURITY_PULSE), not the commanders.
- Never hardcode the key — env var only, hard-fail if missing.
