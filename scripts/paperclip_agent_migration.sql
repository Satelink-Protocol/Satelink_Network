-- Paperclip Agent Roster Migration
-- Migrates from legacy workers to 5 Enterprise OS commanders
-- Applied to: postgresql://localhost:5432/paperclip_prod
-- Date: 2026-06-03

-- ============================================================
-- PHASE 1: Disable legacy agents
-- ============================================================

UPDATE agents
SET
  status       = 'paused',
  paused_at    = NOW(),
  pause_reason = 'Retired: replaced by Enterprise OS commanders',
  updated_at   = NOW()
WHERE name IN (
  'BACKEND_WORKER',
  'FRONTEND_WORKER',
  'GROWTH_WORKER',
  'ORCHESTRATOR',
  'CONVERSION_MONITOR',
  'SENTINEL'
);

-- ============================================================
-- PHASE 2: Update CEO (existing agent — upgrade to claude_local)
-- ============================================================

UPDATE agents
SET
  adapter_type   = 'claude_local',
  adapter_config = jsonb_build_object(
    'mode',                    '',
    'model',                   'claude-sonnet-4-6',
    'effort',                  '',
    'variant',                 '',
    'maxTurnsPerRun',          15,
    'instructionsFilePath',    '/Users/pradeepjakuraa/.paperclip/instances/default/companies/2fb13f91-fa14-4a2f-9497-6601e9a171d9/agents/98b26884-f2c2-4e5c-8cc0-d91a8c1109c3/instructions/AGENTS.md',
    'instructionsRootPath',    '/Users/pradeepjakuraa/.paperclip/instances/default/companies/2fb13f91-fa14-4a2f-9497-6601e9a171d9/agents/98b26884-f2c2-4e5c-8cc0-d91a8c1109c3/instructions',
    'modelReasoningEffort',    '',
    'instructionsEntryFile',   'AGENTS.md',
    'instructionsBundleMode',  'managed'
  ),
  runtime_config = jsonb_build_object(
    'heartbeat', jsonb_build_object(
      'enabled',            false,
      'wakeOnDemand',       true,
      'maxConcurrentRuns',  1
    )
  ),
  status     = 'idle',
  paused_at  = NULL,
  pause_reason = NULL,
  updated_at = NOW()
WHERE id = '98b26884-f2c2-4e5c-8cc0-d91a8c1109c3';

-- ============================================================
-- PHASE 3: Insert new commanders
-- ============================================================

-- ENGINEERING_COMMANDER
INSERT INTO agents (
  id, company_id, name, role, title, status,
  adapter_type, adapter_config, runtime_config,
  created_at, updated_at
) VALUES (
  '85e00acf-7c98-4a0a-97b7-0e22c12e3167',
  '2fb13f91-fa14-4a2f-9497-6601e9a171d9',
  'ENGINEERING_COMMANDER',
  'commander',
  'Engineering Commander',
  'idle',
  'claude_local',
  jsonb_build_object(
    'mode',                    '',
    'model',                   'claude-sonnet-4-6',
    'effort',                  '',
    'variant',                 '',
    'maxTurnsPerRun',          20,
    'instructionsFilePath',    '/Users/pradeepjakuraa/.paperclip/instances/default/companies/2fb13f91-fa14-4a2f-9497-6601e9a171d9/agents/85e00acf-7c98-4a0a-97b7-0e22c12e3167/instructions/AGENTS.md',
    'instructionsRootPath',    '/Users/pradeepjakuraa/.paperclip/instances/default/companies/2fb13f91-fa14-4a2f-9497-6601e9a171d9/agents/85e00acf-7c98-4a0a-97b7-0e22c12e3167/instructions',
    'modelReasoningEffort',    '',
    'instructionsEntryFile',   'AGENTS.md',
    'instructionsBundleMode',  'managed'
  ),
  jsonb_build_object(
    'heartbeat', jsonb_build_object(
      'enabled',           false,
      'wakeOnDemand',      true,
      'maxConcurrentRuns', 1
    )
  ),
  NOW(), NOW()
)
ON CONFLICT (id) DO UPDATE SET
  adapter_type   = EXCLUDED.adapter_type,
  adapter_config = EXCLUDED.adapter_config,
  runtime_config = EXCLUDED.runtime_config,
  status         = EXCLUDED.status,
  paused_at      = NULL,
  pause_reason   = NULL,
  updated_at     = NOW();

-- ECONOMY_COMMANDER
INSERT INTO agents (
  id, company_id, name, role, title, status,
  adapter_type, adapter_config, runtime_config,
  created_at, updated_at
) VALUES (
  '3e6e6a26-668f-425c-b44f-fbf2217edf3b',
  '2fb13f91-fa14-4a2f-9497-6601e9a171d9',
  'ECONOMY_COMMANDER',
  'commander',
  'Economy Commander',
  'idle',
  'claude_local',
  jsonb_build_object(
    'mode',                    '',
    'model',                   'claude-sonnet-4-6',
    'effort',                  '',
    'variant',                 '',
    'maxTurnsPerRun',          20,
    'instructionsFilePath',    '/Users/pradeepjakuraa/.paperclip/instances/default/companies/2fb13f91-fa14-4a2f-9497-6601e9a171d9/agents/3e6e6a26-668f-425c-b44f-fbf2217edf3b/instructions/AGENTS.md',
    'instructionsRootPath',    '/Users/pradeepjakuraa/.paperclip/instances/default/companies/2fb13f91-fa14-4a2f-9497-6601e9a171d9/agents/3e6e6a26-668f-425c-b44f-fbf2217edf3b/instructions',
    'modelReasoningEffort',    '',
    'instructionsEntryFile',   'AGENTS.md',
    'instructionsBundleMode',  'managed'
  ),
  jsonb_build_object(
    'heartbeat', jsonb_build_object(
      'enabled',           false,
      'wakeOnDemand',      true,
      'maxConcurrentRuns', 1
    )
  ),
  NOW(), NOW()
)
ON CONFLICT (id) DO UPDATE SET
  adapter_type   = EXCLUDED.adapter_type,
  adapter_config = EXCLUDED.adapter_config,
  runtime_config = EXCLUDED.runtime_config,
  status         = EXCLUDED.status,
  paused_at      = NULL,
  pause_reason   = NULL,
  updated_at     = NOW();

-- SECURITY_COMMANDER
INSERT INTO agents (
  id, company_id, name, role, title, status,
  adapter_type, adapter_config, runtime_config,
  created_at, updated_at
) VALUES (
  '7bc2c16a-ca25-4a0d-8b63-fc3c504e5142',
  '2fb13f91-fa14-4a2f-9497-6601e9a171d9',
  'SECURITY_COMMANDER',
  'commander',
  'Security Commander',
  'idle',
  'claude_local',
  jsonb_build_object(
    'mode',                    '',
    'model',                   'claude-sonnet-4-6',
    'effort',                  '',
    'variant',                 '',
    'maxTurnsPerRun',          20,
    'instructionsFilePath',    '/Users/pradeepjakuraa/.paperclip/instances/default/companies/2fb13f91-fa14-4a2f-9497-6601e9a171d9/agents/7bc2c16a-ca25-4a0d-8b63-fc3c504e5142/instructions/AGENTS.md',
    'instructionsRootPath',    '/Users/pradeepjakuraa/.paperclip/instances/default/companies/2fb13f91-fa14-4a2f-9497-6601e9a171d9/agents/7bc2c16a-ca25-4a0d-8b63-fc3c504e5142/instructions',
    'modelReasoningEffort',    '',
    'instructionsEntryFile',   'AGENTS.md',
    'instructionsBundleMode',  'managed'
  ),
  jsonb_build_object(
    'heartbeat', jsonb_build_object(
      'enabled',           false,
      'wakeOnDemand',      true,
      'maxConcurrentRuns', 1
    )
  ),
  NOW(), NOW()
)
ON CONFLICT (id) DO UPDATE SET
  adapter_type   = EXCLUDED.adapter_type,
  adapter_config = EXCLUDED.adapter_config,
  runtime_config = EXCLUDED.runtime_config,
  status         = EXCLUDED.status,
  paused_at      = NULL,
  pause_reason   = NULL,
  updated_at     = NOW();

-- AUTONOMY_COMMANDER
INSERT INTO agents (
  id, company_id, name, role, title, status,
  adapter_type, adapter_config, runtime_config,
  created_at, updated_at
) VALUES (
  '2325e0bb-1dc5-409a-82a0-d674461ef793',
  '2fb13f91-fa14-4a2f-9497-6601e9a171d9',
  'AUTONOMY_COMMANDER',
  'commander',
  'Autonomy Commander',
  'idle',
  'claude_local',
  jsonb_build_object(
    'mode',                    '',
    'model',                   'claude-sonnet-4-6',
    'effort',                  '',
    'variant',                 '',
    'maxTurnsPerRun',          15,
    'instructionsFilePath',    '/Users/pradeepjakuraa/.paperclip/instances/default/companies/2fb13f91-fa14-4a2f-9497-6601e9a171d9/agents/2325e0bb-1dc5-409a-82a0-d674461ef793/instructions/AGENTS.md',
    'instructionsRootPath',    '/Users/pradeepjakuraa/.paperclip/instances/default/companies/2fb13f91-fa14-4a2f-9497-6601e9a171d9/agents/2325e0bb-1dc5-409a-82a0-d674461ef793/instructions',
    'modelReasoningEffort',    '',
    'instructionsEntryFile',   'AGENTS.md',
    'instructionsBundleMode',  'managed'
  ),
  jsonb_build_object(
    'heartbeat', jsonb_build_object(
      'enabled',           false,
      'wakeOnDemand',      true,
      'maxConcurrentRuns', 1
    )
  ),
  NOW(), NOW()
)
ON CONFLICT (id) DO UPDATE SET
  adapter_type   = EXCLUDED.adapter_type,
  adapter_config = EXCLUDED.adapter_config,
  runtime_config = EXCLUDED.runtime_config,
  status         = EXCLUDED.status,
  paused_at      = NULL,
  pause_reason   = NULL,
  updated_at     = NOW();
