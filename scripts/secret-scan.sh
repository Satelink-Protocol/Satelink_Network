#!/usr/bin/env bash
# secret-scan.sh — pre-push guard (A7). Unlike agent-check.sh (deliberately
# non-blocking), this HARD-FAILS the push if the outgoing diff contains a
# real-looking Cloudflare, Vercel, Dodo, or Resend token/secret value —
# never just the env VAR NAME (which legitimately appears all over
# INFRA_SETUP.md, docs, and .env.example with no real value attached).
#
# Reads the standard git pre-push stdin: one line per ref being pushed,
# "<local ref> <local sha1> <remote ref> <remote sha1>". For each ref, diffs
# remote_sha1..local_sha1 (or, for a brand-new ref with no remote sha, against
# origin/main, falling back to the empty tree) and scans ADDED lines only.
#
# This intentionally matches on VALUE SHAPE, not variable names, so that
# `RESEND_API_KEY=<something>` in a doc never trips it, but a real-looking
# `re_XXXXXXXXXXXXXXXXXXXXXXXXXXXX` value does.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

ZERO_SHA="0000000000000000000000000000000000000000"
found=0

# Patterns: vendor-distinctive prefixes/shapes where known (Resend: `re_...`),
# and env-assignment-to-a-real-looking-value for the rest (Cloudflare/Vercel/
# Dodo don't have one universally documented, stable prefix this scan can rely
# on, so those are matched by "ENV_VAR_NAME = <20+ char high-entropy value>",
# excluding obvious placeholders).
PATTERNS='re_[A-Za-z0-9_-]{20,}'
PATTERNS="${PATTERNS}|CLOUDFLARE_API_TOKEN[[:space:]]*[:=][[:space:]]*['\"]?[A-Za-z0-9_-]{30,}"
PATTERNS="${PATTERNS}|VERCEL_TOKEN[[:space:]]*[:=][[:space:]]*['\"]?[A-Za-z0-9_-]{20,}"
PATTERNS="${PATTERNS}|DODO_(API_KEY|WEBHOOK_SECRET|INTERNAL_SECRET)[[:space:]]*[:=][[:space:]]*['\"]?[A-Za-z0-9_.-]{16,}"
PLACEHOLDER_RE='<.*>|YOUR_|CHANGEME|[Xx]{8,}|\.\.\.|^\$\{|placeholder|EXAMPLE'
# Never scan this script's own source — it legitimately contains the patterns
# above as literal text (regexes, example redacted values, this file's own
# past diffs), which would otherwise trip on itself.
SELF_PATH="scripts/secret-scan.sh"

scan_range() {
  local range="$1"
  local diff_out
  diff_out="$(git diff "$range" -- . 2>/dev/null)" || return 0
  [ -z "$diff_out" ] && return 0

  # Added lines only, with the file header they belong to.
  local file=""
  while IFS= read -r line; do
    case "$line" in
      "+++ b/"*) file="${line#+++ b/}" ;;
      "+"*)
        [ "$file" = "$SELF_PATH" ] && continue
        content="${line#+}"
        if echo "$content" | grep -qE "$PATTERNS"; then
          if ! echo "$content" | grep -qE "$PLACEHOLDER_RE"; then
            echo "  ❌ possible secret in $file: ${content:0:80}..."
            found=1
          fi
        fi
        ;;
    esac
  done <<< "$diff_out"
}

while read -r local_ref local_sha remote_ref remote_sha; do
  [ -z "${local_sha:-}" ] && continue
  if [ "$remote_sha" = "$ZERO_SHA" ] || [ -z "${remote_sha:-}" ]; then
    if git rev-parse --verify origin/main >/dev/null 2>&1; then
      scan_range "origin/main..$local_sha"
    else
      scan_range "$(git hash-object -t tree /dev/null)..$local_sha"
    fi
  else
    scan_range "$remote_sha..$local_sha"
  fi
done

if [ "$found" = "1" ]; then
  echo ""
  echo "🛑 secret-scan: push blocked — a real-looking Cloudflare/Vercel/Dodo/Resend"
  echo "   token was found in the outgoing diff. If this is a false positive,"
  echo "   fix the pattern in scripts/secret-scan.sh — never bypass with --no-verify"
  echo "   to push a real secret."
  exit 1
fi
exit 0
