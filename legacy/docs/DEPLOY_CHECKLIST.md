# Satelink Deploy Checklist

Last updated: 2026-05-11

## Pre-Deploy Verification

### 1. Backend (Railway) - API at rpc.satelink.network

- [ ] CORS middleware attached in `app_factory.mjs` (line 23: `attachBaseMiddleware(app)`)
- [ ] PUBLIC_PATHS includes: `/rpc`, `/health`, `/healthz`, `/api/pricing`, `/api/status`, `/api/epochs`, `/api/nodes`, `/api/settlement`, `/os`, `/provider.json`
- [ ] Verify CORS headers:
  ```bash
  curl -I https://rpc.satelink.network/api/status 2>&1 | grep -i access-control
  # Expected: Access-Control-Allow-Origin: *
  ```
- [ ] Verify revenue data exists:
  ```bash
  curl -s https://rpc.satelink.network/api/epochs | jq '.epochs | length'
  # Expected: 10+ epochs with non-zero revenue
  ```

### 2. Frontend (Vercel) - satelink.network

- [ ] AuthProvider wraps app in `src/app/layout.tsx`
- [ ] Toaster included in Providers component
- [ ] /login page has Suspense boundary for useSearchParams
- [ ] API base URL correct in `src/lib/api/satelink-api.ts`: `https://rpc.satelink.network`

### 3. Critical Pages Status

| Page | Status | Notes |
|------|--------|-------|
| `/` | OK | Landing page |
| `/login` | FIXED | Added AuthProvider + Suspense |
| `/satelink/os/overview` | OK | Admin command center - wired to real API |
| `/satelink/os/billing` | OK | Node operator billing - wired to real API |
| `/dashboard` | OK | Requires auth |
| `/admin` | OK | Requires admin role |

## Deploy Sequence

### Step 1: Push to develop branch
```bash
git add -A
git commit -m "fix: AuthProvider in root layout, Suspense in login page"
git push origin develop
```

### Step 2: Verify Railway deploy
Railway auto-deploys from `develop`. Wait 2-3 minutes, then:
```bash
curl -s https://rpc.satelink.network/health
# Expected: {"status":"ok"}

curl -I https://rpc.satelink.network/api/epochs 2>&1 | grep access-control
# Expected: access-control-allow-origin: *
```

### Step 3: Verify Vercel deploy
Vercel auto-deploys from `develop` or manual deploy:
```bash
cd apps/web
vercel --prod
```

### Step 4: End-to-end verification
1. Open https://satelink.network/login in browser
2. Confirm page loads without 500 error
3. Open https://satelink.network/satelink/os/overview
4. Confirm revenue shows $0.78+ (not $0)
5. Confirm nodes_online shows 1+
6. Confirm epochs shows 10+

## Rollback

If issues occur:
```bash
# Railway - redeploy previous commit
railway up --service api --commit <previous-sha>

# Vercel - use dashboard to rollback or:
vercel rollback
```

## Environment Variables Required

### Backend (Railway)
- `DATABASE_URL` - PostgreSQL connection
- `REDIS_URL` - Redis connection
- `CORS_ORIGINS` - Comma-separated allowed origins (empty = allow all)

### Frontend (Vercel)
- `NEXT_PUBLIC_API_BASE` - https://rpc.satelink.network
- `INTERNAL_API_URL` - For SSR (Docker: http://api:8080)

## Commits This Session

1. `44d773e` - fix: add CORS for /api/epochs, /api/nodes, /os
2. `f7ac176` - fix: attach CORS middleware (was defined but never called)
3. Pending - fix: AuthProvider in root layout, Suspense in login page
