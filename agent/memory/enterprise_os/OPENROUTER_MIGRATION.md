# OPENROUTER MIGRATION PLAN

## Why migrate
- Current: Claude Pro plan (limited API calls, no billing control)
- Target: OpenRouter API (pay-per-token, any model, full control)

## Model mapping (current → OpenRouter)
Commanders (Sonnet):
  claude-sonnet-4-6 → anthropic/claude-sonnet-4-5 (or latest)

Sub-agents (Gemini Flash):
  gemini-2.5-flash-lite → google/gemini-flash-1.5

Future options on OpenRouter:
  Complex reasoning → anthropic/claude-opus-4 (expensive, rare)
  Fast cheap tasks → google/gemini-flash-1.5 ($0.075/1M tokens input)
  Code tasks → deepseek/deepseek-coder (very cheap)
  Security analysis → anthropic/claude-sonnet-4-5

## Migration steps (when ready)
1. Get OpenRouter API key: https://openrouter.ai/keys
2. Set in Railway: railway variables set "OPENROUTER_API_KEY=sk-or-..."
3. Update Paperclip adapter from claude_local/gemini_local to openrouter adapter
4. Update model strings in all agent adapter_configs
5. Set spending limits per agent per month in OpenRouter dashboard

## Cost estimate (current usage)
Commanders (Sonnet): ~5 runs/day × 2000 tokens = 10K tokens/day = ~$0.03/day
Sub-agents (Gemini): ~48 runs/day × 500 tokens = 24K tokens/day = ~$0.002/day
Monthly: ~$1/month at current usage, scales with activity
