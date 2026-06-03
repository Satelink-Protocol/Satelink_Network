# RUFLO INTEGRATION SETUP
Date: 2026-05-30

## Installation
Version: 3.10.13
CLI: npx claude-flow@latest (ruflo path fix in progress)
Daemon: running in background (PID 18116)

## Memory Namespaces

### satelink namespace (5 entries)
| Key | Size | Description |
|-----|------|-------------|
| project/context | 251 B | Original project context |
| project/identity | 185 B | Satelink identity, live URL, 92% complete |
| project/production | 216 B | RevenueVault, epoch info, auth endpoints |
| project/codebase | 251 B | Key file paths, route mounting, Railway config |
| project/open_issues | 288 B | Current P0 issues to fix |

### agents namespace (7 entries)
| Key | Size | Description |
|-----|------|-------------|
| agents/ceo | 155 B | CEO routing rules, 12 turns max |
| agents/backend_worker | 142 B | BACKEND_WORKER scope, 20 turns |
| agents/frontend_worker | 155 B | FRONTEND_WORKER scope, 25 turns |
| agents/sentinel | 129 B | SENTINEL config, Gemini, 3 turns |
| agents/conversion_monitor | 129 B | CONVERSION_MONITOR, Gemini, 4 turns |
| agents/rules | 321 B | Global rotational model rules |
| agents/progress_file | 186 B | Progress file location and format |

### production namespace (1 entry)
| Key | Size | Description |
|-----|------|-------------|
| production/status | 286 B | Live production status |

## Swarm Config
- Topology: hierarchical
- Max agents: 7
- Coordination: sequential (matches Paperclip rotational model)
- Memory namespace: satelink
- Swarm ID: swarm-1780141754450-l8xfgy

## Daemon Status
- Status: RUNNING (background)
- PID: 18116
- Workers Enabled: 5 (map, audit, optimize, consolidate, testgaps)
- Max Concurrent: 2
- Logs: .claude-flow/daemon.log

## How Ruflo Helps Paperclip Agents
1. **TOKEN SAVING**: Agents read from memory cache instead of re-processing files
2. **CONTEXT PERSISTENCE**: CLAUDE.md injected at start of every Claude Code session
3. **NO CONTEXT LOSS**: Ruflo archives session state before context window compacts
4. **BACKGROUND WORKERS**: Daemon manages memory without burning Claude quota
5. **VECTOR SEARCH**: All entries have 384-dim embeddings for semantic search

## Usage Commands

### Memory Operations
```bash
# Store new memory
npx claude-flow@latest memory store --key "KEY" --value "VALUE" --namespace NAMESPACE

# List entries
npx claude-flow@latest memory list --namespace satelink
npx claude-flow@latest memory list --namespace agents

# Search memory (semantic)
npx claude-flow@latest memory search --query "SEARCH_TERM" --namespace NAMESPACE
```

### Daemon Operations
```bash
npx claude-flow@latest daemon status
npx claude-flow@latest daemon start --background
npx claude-flow@latest daemon stop
```

### Swarm Operations
```bash
npx claude-flow@latest status
npx claude-flow@latest swarm init --topology hierarchical --max-agents 7
```

## Cloud Migration (Day 5)
Add to Dockerfile.paperclip:
```dockerfile
COPY .claude-flow/ /app/.claude-flow/
```

Add Railway Volume:
- Mount path: /app/.claude-flow
- This persists swarm memory across Railway deploys.

## Verification Checklist
- [x] Ruflo v3.10.13 installed
- [x] .claude-flow directory exists
- [x] satelink namespace: 5 entries
- [x] agents namespace: 7 entries
- [x] production namespace: 1 entry
- [x] Swarm initialized (hierarchical, 7 max agents)
- [x] Daemon running (PID 18116)
- [x] CLAUDE.md exists with agent context
