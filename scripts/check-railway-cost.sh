#!/usr/bin/env bash
# Run weekly to monitor Railway costs
# Usage: bash scripts/check-railway-cost.sh

echo "=== SATELINK RAILWAY COST CHECK ==="
echo "Date: $(date)"
echo ""
echo "Service health checks:"
echo ""

API_HEALTH=$(curl -sf https://rpc.satelink.network/rpc/health 2>/dev/null && echo "UP" || echo "DOWN")
PAPERCLIP_HEALTH=$(curl -sf https://agents.satelink.network/health 2>/dev/null && echo "UP" || echo "DOWN")

echo "  Satelink-api:    $API_HEALTH"
echo "  Paperclip AI OS: $PAPERCLIP_HEALTH"
echo ""

echo "Memory usage (Paperclip target: <512MB after optimization):"
# Check if Railway CLI is available for metrics
if command -v railway &>/dev/null; then
  railway metrics 2>/dev/null || echo "  (install railway CLI for live metrics)"
else
  echo "  (install: npm i -g @railway/cli)"
fi

echo ""
echo "Agent status:"
curl -sf "https://agents.satelink.network/api/companies/2fb13f91-fa14-4a2f-9497-6601e9a171d9/agents" \
  2>/dev/null | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    agents = d if isinstance(d, list) else d.get('agents', d.get('data', []))
    errors = sum(1 for a in agents if a.get('status') == 'error')
    idle   = sum(1 for a in agents if a.get('status') in ['idle','active'])
    print(f'  Running: {idle}/12  |  Errors: {errors}/12')
except: print('  (could not fetch agent status)')
" 2>/dev/null

echo ""
echo "Conversion targets (warm leads):"
# Check conversion_targets table
node -e "
import pg from 'pg';
const pool = new (pg.Pool)({ connectionString: process.env.DATABASE_URL, ssl:{rejectUnauthorized:false} });
pool.query('SELECT COUNT(*) as total, SUM(CASE WHEN intent_score>=100 THEN 1 ELSE 0 END) as hot FROM conversion_targets WHERE converted=false')
  .then(r => {
    console.log('  Total leads:', r.rows[0].total, ' | Hot (3+ days):', r.rows[0].hot);
    pool.end();
  }).catch(e => { console.log('  DB unavailable'); pool.end(); });
" 2>/dev/null

echo ""
echo "=== Budget estimate ==="
echo "  Railway Hobby:    \$5.00 included free"
echo "  Target bill:      \$15-20/month total"
echo "  Review usage at:  railway.com/workspace/usage"
echo ""
echo "Budget rule: if estimated bill > \$18, check Paperclip memory and reduce NODE_OPTIONS."
