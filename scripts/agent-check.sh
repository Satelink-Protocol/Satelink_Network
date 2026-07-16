#!/usr/bin/env bash
# agent-check.sh — pre-push summary: env check, lint, tests, npm audit.
# Quiet by default (one line per check) — full output only on VERBOSE=1.
# Everything is non-blocking (exit 0) until the founder flips a check to hard-fail;
# a non-blocking wall of output is pure noise for agents, so we print verdicts only.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

VERBOSE="${VERBOSE:-0}"
run() { # run <label> <cmd...> — print one ✅/⚠️ line; full output if VERBOSE=1
  local label="$1"; shift
  local out
  if out="$("$@" 2>&1)"; then
    echo "  ✅ $label"
  else
    echo "  ⚠️  $label (non-blocking) — rerun with VERBOSE=1 or: $*"
  fi
  [ "$VERBOSE" = "1" ] && echo "$out"
  return 0
}

echo "── agent-check ($(date '+%Y-%m-%d %H:%M')) ──"
bash "$REPO_ROOT/scripts/agent-env-check.sh" >/dev/null 2>&1 && echo "  ✅ env" || echo "  ⚠️  env (JWT_SECRET/NODE_ENV — see scripts/agent-env-check.sh)"
run "lint" npm run lint --if-present
run "tests (root turbo; api baseline is 128/9 — see CLAUDE.md)" npm test
run "npm audit (high+)" npm audit --audit-level=high
exit 0
