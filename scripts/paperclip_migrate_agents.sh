#!/usr/bin/env bash
set -euo pipefail

DB="postgresql://pradeepjakuraa@localhost:5432/paperclip_prod"
COMPANY_ID="2fb13f91-fa14-4a2f-9497-6601e9a171d9"
PAPERCLIP_BASE="/Users/pradeepjakuraa/.paperclip/instances/default/companies/${COMPANY_ID}/agents"
REPO_BASE="/Users/pradeepjakuraa/satelink/agent/memory/agents"

echo "=== Paperclip Agent Roster Migration ==="
echo "DB: $DB"
echo ""

# -------------------------------------------------------
# STEP 1: Terminate legacy agents
# -------------------------------------------------------
echo "[1/4] Terminating legacy agents..."
psql "$DB" -c "
UPDATE agents
SET status='terminated', updated_at=NOW()
WHERE company_id='${COMPANY_ID}'
  AND name IN ('BACKEND_WORKER','FRONTEND_WORKER','GROWTH_WORKER','ORCHESTRATOR','SENTINEL','CONVERSION_MONITOR','CONVERSION_MO')
  AND status != 'terminated';"

# -------------------------------------------------------
# STEP 2: Sync CEO instructions
# -------------------------------------------------------
echo "[2/4] Syncing CEO instructions..."
CEO_ID=$(psql "$DB" -t -A -c "SELECT id FROM agents WHERE name='CEO' AND company_id='${COMPANY_ID}';")
echo "  CEO ID: $CEO_ID"
mkdir -p "${PAPERCLIP_BASE}/${CEO_ID}/instructions"
cp "${REPO_BASE}/CEO/INSTRUCTIONS.md" "${PAPERCLIP_BASE}/${CEO_ID}/instructions/AGENTS.md"
echo "  CEO instructions written."

# -------------------------------------------------------
# STEP 3: Upsert the 4 commanders
# -------------------------------------------------------
echo "[3/4] Upserting commander agents..."

upsert_commander() {
  local NAME="$1"
  local TITLE="$2"
  local CAPABILITIES="$3"
  local ICON="$4"
  local MAX_TURNS="${5:-20}"

  echo ""
  echo "  -> $NAME"

  # Check if agent already exists (no unique constraint on name+company, use SELECT)
  EXISTING_ID=$(psql "$DB" -t -A -c "
    SELECT id FROM agents
    WHERE company_id='${COMPANY_ID}' AND name='${NAME}'
    LIMIT 1;")

  if [ -n "$EXISTING_ID" ]; then
    # Agent exists — update capabilities, icon, reports_to, and ensure claude_local
    echo "     Exists (${EXISTING_ID}), updating fields..."
    AGENT_ID="$EXISTING_ID"

    # Sync instructions file (idempotent)
    mkdir -p "${PAPERCLIP_BASE}/${AGENT_ID}/instructions"
    cp "${REPO_BASE}/${NAME}/INSTRUCTIONS.md" "${PAPERCLIP_BASE}/${AGENT_ID}/instructions/AGENTS.md"

    psql "$DB" -c "
    UPDATE agents SET
      title        = '${TITLE}',
      capabilities = '${CAPABILITIES}',
      icon         = '${ICON}',
      reports_to   = '${CEO_ID}',
      status       = CASE WHEN status='terminated' THEN 'idle' ELSE status END,
      paused_at    = NULL,
      pause_reason = NULL,
      adapter_type = 'claude_local',
      adapter_config = jsonb_build_object(
        'mode',                   '',
        'model',                  'claude-sonnet-4-6',
        'effort',                 '',
        'variant',                '',
        'maxTurnsPerRun',         ${MAX_TURNS},
        'instructionsFilePath',   '${PAPERCLIP_BASE}/${AGENT_ID}/instructions/AGENTS.md',
        'instructionsRootPath',   '${PAPERCLIP_BASE}/${AGENT_ID}/instructions',
        'modelReasoningEffort',   '',
        'instructionsEntryFile',  'AGENTS.md',
        'instructionsBundleMode', 'managed'
      ),
      runtime_config = '{\"heartbeat\": {\"enabled\": false, \"wakeOnDemand\": true, \"maxConcurrentRuns\": 1}}'::jsonb,
      updated_at   = NOW()
    WHERE id='${AGENT_ID}';"
  else
    # Agent does not exist — generate UUID, create files, insert
    AGENT_ID=$(uuidgen | tr '[:upper:]' '[:lower:]')
    echo "     New agent (${AGENT_ID}), inserting..."

    mkdir -p "${PAPERCLIP_BASE}/${AGENT_ID}/instructions"
    cp "${REPO_BASE}/${NAME}/INSTRUCTIONS.md" "${PAPERCLIP_BASE}/${AGENT_ID}/instructions/AGENTS.md"

    psql "$DB" -c "
    INSERT INTO agents (
      id, company_id, name, role, title, status, reports_to,
      capabilities, adapter_type, adapter_config,
      budget_monthly_cents, spent_monthly_cents,
      metadata, created_at, updated_at, runtime_config, permissions, icon
    ) VALUES (
      '${AGENT_ID}',
      '${COMPANY_ID}',
      '${NAME}',
      'general',
      '${TITLE}',
      'idle',
      '${CEO_ID}',
      '${CAPABILITIES}',
      'claude_local',
      jsonb_build_object(
        'mode',                   '',
        'model',                  'claude-sonnet-4-6',
        'effort',                 '',
        'variant',                '',
        'maxTurnsPerRun',         ${MAX_TURNS},
        'instructionsFilePath',   '${PAPERCLIP_BASE}/${AGENT_ID}/instructions/AGENTS.md',
        'instructionsRootPath',   '${PAPERCLIP_BASE}/${AGENT_ID}/instructions',
        'modelReasoningEffort',   '',
        'instructionsEntryFile',  'AGENTS.md',
        'instructionsBundleMode', 'managed'
      ),
      0, 0, '{}'::jsonb,
      NOW(), NOW(),
      '{\"heartbeat\": {\"enabled\": false, \"wakeOnDemand\": true, \"maxConcurrentRuns\": 1}}'::jsonb,
      '{\"canCreateAgents\": false}'::jsonb,
      '${ICON}'
    ) ON CONFLICT (id) DO NOTHING;"
  fi
  echo "     Done."
}

upsert_commander \
  "ENGINEERING_COMMANDER" \
  "Engineering Commander" \
  "Engineering execution, QA, deployment, incident response, SRE" \
  "gear" \
  20

upsert_commander \
  "ECONOMY_COMMANDER" \
  "Economy Commander" \
  "Revenue, customer acquisition, funnel conversion, pricing, customer zero" \
  "chart-line" \
  20

upsert_commander \
  "SECURITY_COMMANDER" \
  "Security Commander" \
  "Treasury protection, secrets management, adversarial review, deployment security gate" \
  "shield" \
  20

upsert_commander \
  "AUTONOMY_COMMANDER" \
  "Autonomy Commander" \
  "Founder independence, automation backlog, manual action capture" \
  "robot" \
  15

# -------------------------------------------------------
# STEP 4: Verify final roster
# -------------------------------------------------------
echo ""
echo "[4/4] Final agent roster:"
psql "$DB" -c "
SELECT name, status, adapter_config->>'model' AS model,
       COALESCE(icon, '(none)') AS icon,
       CASE WHEN reports_to IS NOT NULL THEN 'CEO' ELSE '(none)' END AS reports_to
FROM agents
WHERE company_id='${COMPANY_ID}'
ORDER BY
  CASE WHEN status IN ('idle','running') THEN 0 ELSE 1 END,
  name;"

echo ""
echo "=== Migration complete ==="
