#!/usr/bin/env bash
# ============================================================
# SATELINK — ANTHROPIC ADMIN API SETUP
# Run this locally: bash anthropic_admin_setup.sh
# Requires: ANTHROPIC_ADMIN_KEY in your environment
# ============================================================
set -euo pipefail

ADMIN_KEY="${ANTHROPIC_ADMIN_KEY:?ERROR: Set ANTHROPIC_ADMIN_KEY in your shell first}"
BASE="https://api.anthropic.com/v1"
HEADERS=(
  -H "anthropic-admin-key: $ADMIN_KEY"
  -H "anthropic-version: 2023-06-01"
  -H "Content-Type: application/json"
)

log()  { echo -e "\033[0;36m[INFO]\033[0m $*"; }
ok()   { echo -e "\033[0;32m[OK]\033[0m $*"; }
err()  { echo -e "\033[0;31m[ERR]\033[0m $*"; }
head() { echo -e "\n\033[1;33m=== $* ===\033[0m"; }

# ---- 1. LIST WORKSPACES -----------------------------------
head "1. CHECKING WORKSPACES"
WORKSPACES=$(curl -sf "${BASE}/workspaces" "${HEADERS[@]}" 2>/dev/null || echo '{"error":"fetch_failed"}')
echo "$WORKSPACES" | python3 -m json.tool 2>/dev/null || echo "$WORKSPACES"

# Extract default workspace ID for key scoping
DEFAULT_WS_ID=$(echo "$WORKSPACES" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    ws = data.get('data', [])
    for w in ws:
        if w.get('is_default') or w.get('name','').lower() in ['default','primary']:
            print(w['id']); break
    else:
        if ws: print(ws[0]['id'])
except: pass
" 2>/dev/null || echo "")

if [ -n "$DEFAULT_WS_ID" ]; then
  ok "Default workspace: $DEFAULT_WS_ID"
else
  log "No workspace ID extracted — keys will be org-scoped"
fi

# ---- 2. LIST EXISTING API KEYS ----------------------------
head "2. EXISTING API KEYS"
EXISTING_KEYS=$(curl -sf "${BASE}/api_keys?limit=20" "${HEADERS[@]}" 2>/dev/null || echo '{"data":[]}')
echo "$EXISTING_KEYS" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    keys = data.get('data', [])
    if not keys:
        print('  (no keys found)')
    for k in keys:
        status = k.get('status','unknown')
        name   = k.get('name','unnamed')
        kid    = k.get('id','?')
        print(f'  [{status}] {name}  ({kid})')
except Exception as e:
    print(f'  parse error: {e}')
" 2>/dev/null

# ---- 3. CREATE SCOPED KEYS --------------------------------
head "3. CREATING SCOPED SERVICE KEYS"

create_key() {
  local NAME="$1"
  local ROLE="${2:-developer}"   # developer | admin
  log "Creating key: $NAME (role=$ROLE)"

  PAYLOAD="{\"name\":\"$NAME\",\"role\":\"$ROLE\""
  if [ -n "$DEFAULT_WS_ID" ]; then
    PAYLOAD="$PAYLOAD,\"workspace_id\":\"$DEFAULT_WS_ID\""
  fi
  PAYLOAD="$PAYLOAD}"

  RESP=$(curl -sf -X POST "${BASE}/api_keys" "${HEADERS[@]}" -d "$PAYLOAD" 2>/dev/null || echo '{"error":"create_failed"}')
  
  KEY_VAL=$(echo "$RESP" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    print(d.get('key','') or d.get('secret_key','') or d.get('api_key','') or 'NOT_RETURNED')
except: print('PARSE_ERROR')
" 2>/dev/null)
  KEY_ID=$(echo "$RESP" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    print(d.get('id',''))
except: print('')
" 2>/dev/null)

  if [[ "$KEY_VAL" == sk-ant-* ]]; then
    ok "Created [$NAME]: $KEY_VAL"
    echo ""
    echo "  ┌──────────────────────────────────────────────────────"
    echo "  │  SERVICE  : $NAME"
    echo "  │  KEY ID   : $KEY_ID"
    echo "  │  API KEY  : $KEY_VAL"
    echo "  │  ACTION   : Set in Railway → Variables → ANTHROPIC_API_KEY"
    echo "  └──────────────────────────────────────────────────────"
    echo ""
  else
    err "Key creation response for [$NAME]:"
    echo "$RESP" | python3 -m json.tool 2>/dev/null || echo "$RESP"
  fi
}

# Create keys for each service
create_key "satelink-paperclip-railway-prod"  "developer"
create_key "satelink-api-backend-prod"        "developer"
create_key "satelink-claude-code-cli-local"   "developer"

# ---- 4. CHECK USAGE / SPEND --------------------------------
head "4. USAGE & SPEND CHECK"
USAGE=$(curl -sf "${BASE}/usage" "${HEADERS[@]}" 2>/dev/null \
  || curl -sf "${BASE}/organizations/usage" "${HEADERS[@]}" 2>/dev/null \
  || echo '{"note":"usage endpoint varies — check console.anthropic.com/usage"}')
echo "$USAGE" | python3 -m json.tool 2>/dev/null || echo "$USAGE"

# ---- 5. RATE LIMIT CHECK -----------------------------------
head "5. MODELS & RATE LIMIT CHECK"
MODELS=$(curl -sf "${BASE}/models" \
  -H "x-api-key: ${ANTHROPIC_API_KEY:-NOT_SET}" \
  -H "anthropic-version: 2023-06-01" 2>/dev/null || echo '{"error":"api_key_not_set_in_env"}')
echo "$MODELS" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    models = data.get('data',[])
    for m in models:
        print(f\"  {m.get('id','?')}\")
except Exception as e:
    print(json.load(open('/dev/stdin')) if False else sys.stdin.read())
" 2>/dev/null || echo "$MODELS"

head "SETUP COMPLETE"
echo ""
echo "NEXT STEPS:"
echo "  1. Copy 'satelink-paperclip-railway-prod' key → Railway → Satelink_Network → ANTHROPIC_API_KEY"
echo "  2. Copy 'satelink-api-backend-prod' key → Railway → Satelink-api → ANTHROPIC_API_KEY (if used)"
echo "  3. Copy 'satelink-claude-code-cli-local' key → export ANTHROPIC_API_KEY=sk-ant-... in ~/.zshrc"
echo "  4. Redeploy Satelink_Network on Railway (agents should start within 60s)"
echo "  5. Run: curl https://agents.satelink.network/health"
echo ""
