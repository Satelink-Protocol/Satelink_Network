# Contributing to Satelink

## Branch Strategy

- `main` — the **only** integration branch (protected, auto-deploys to Railway/Vercel).
  There is no `develop` — do not create PRs against it or assume it exists.
- `feat/*`, `fix/*`, `chore/*`, `docs/*` — short-lived branches off `main`.
- **Delete feature branches immediately after merge.** "Automatically delete head
  branches" is enabled in Settings → General, so merged branches are removed
  automatically; this (not periodic manual cleanup) is what keeps branches from
  piling up.
- **Dependabot branches:** leave them alone — auto-delete-on-merge handles them.
- **Protected:** `add-satelink-polygon-rpc` (Chainlist submission) — never
  force-push or delete.

## Commit Format

```
feat(task-id): description
fix(task-id): what was broken
chore(task-id): maintenance
docs(task-id): documentation only
test(task-id): test additions
```

## Pull Request Process

1. Branch from `main`
2. Run tests: `npm test`
3. Run lint: `npm run lint`
4. Create PR to `main`
5. Merge after CI passes (the head branch auto-deletes on merge)

## Security

**Never commit:**
- Private keys or mnemonics
- JWT secrets
- API keys (Alchemy, Ankr, Groq, etc.)
- `.env` files
- `token.txt` or credential files

## Testing

```bash
# Backend
cd apps/api && npm test

# Contracts
forge test -vvv

# Frontend build check
cd apps/web && npm run build
```

## Code Style

- Use async/await (never raw promises without await)
- All DB queries must use `await`
- No SQLite anywhere — PostgreSQL only
- No hardcoded secrets — use `process.env`

## Documentation

Update relevant docs when changing:
- API endpoints → `docs/README.md`
- Architecture → `docs/architecture/`
- Progress → `agent/memory/PROGRESS.md`
