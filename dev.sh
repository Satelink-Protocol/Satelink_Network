#!/bin/bash
echo ""
echo "  Satelink Dev Launcher"
echo ""

# Kill existing processes on our ports
lsof -ti:8080 2>/dev/null | xargs kill -9 2>/dev/null || true
lsof -ti:3000 2>/dev/null | xargs kill -9 2>/dev/null || true
sleep 1

# Check .env
if [ ! -f .env ]; then
  echo "❌ .env file not found. Creating from .env.example..."
  cp .env.example .env 2>/dev/null || echo "PORT=8080
NODE_ENV=development
JWT_SECRET=$(openssl rand -hex 32)
JWT_REFRESH_SECRET=$(openssl rand -hex 32)
SQLITE_PATH=./satelink.db
FEATURE_REAL_SETTLEMENT=false
FEATURE_MOONPAY=false" > .env
fi

# Install deps if needed
[ ! -d node_modules ] && echo "📦 Installing backend deps..." && npm install
[ ! -d apps/web/node_modules ] && echo "📦 Installing frontend deps..." && (cd apps/web && npm install)

# Start backend
echo "🔧 Starting backend on :8080..."
node server.js > /tmp/satelink-backend.log 2>&1 &
BACKEND_PID=$!

# Wait for backend ready
echo "⏳ Waiting for backend..."
for i in $(seq 1 30); do
  curl -s http://localhost:8080/health > /dev/null 2>&1 && break
  sleep 1
done

if ! curl -s http://localhost:8080/health > /dev/null 2>&1; then
  echo "❌ Backend failed to start. Check /tmp/satelink-backend.log"
  cat /tmp/satelink-backend.log | tail -20
  exit 1
fi
echo "✅ Backend running on http://localhost:8080"

# Seed data
echo "🌱 Seeding test data..."
curl -s -X POST http://localhost:8080/__test/seed/admin > /dev/null 2>&1 || true
curl -s -X POST http://localhost:8080/__test/seed/nodes > /dev/null 2>&1 || true

# Mint tokens
echo ""
echo "🔑 Login Tokens — paste into browser console at http://localhost:3000:"
echo "────────────────────────────────────────────────────────────────────"

for ROLE_DATA in \
  "admin_super:0xadmin_super:Admin" \
  "node_operator:0xnode_op_1:NodeOp" \
  "builder:0xbuilder_1:Builder" \
  "distributor_lco:0xdist_1:Distributor"; do
  
  ROLE=$(echo $ROLE_DATA | cut -d: -f1)
  WALLET=$(echo $ROLE_DATA | cut -d: -f2)
  LABEL=$(echo $ROLE_DATA | cut -d: -f3)
  
  TOKEN=$(curl -s -X POST http://localhost:8080/__test/auth/login \
    -H "Content-Type: application/json" \
    -d "{\"wallet\":\"${WALLET}\",\"role\":\"${ROLE}\"}" 2>/dev/null | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).token' 2>/dev/null)
  
  if [ -n "$TOKEN" ] && [ "$TOKEN" != "undefined" ]; then
    echo "  $LABEL: localStorage.setItem('satelink_token','$TOKEN'); location.reload()"
  else
    echo "  $LABEL: ⚠️ Failed to mint token"
  fi
done

echo "────────────────────────────────────────────────────────────────────"
echo ""

# Start frontend
echo "🎨 Starting frontend on :3000..."
cd apps/web && npm run dev > /tmp/satelink-frontend.log 2>&1 &
FRONTEND_PID=$!
cd ../..

sleep 3
echo ""
echo "  ✅ Satelink Running!"
echo "  Frontend: http://localhost:3000"
echo "  Backend:  http://localhost:8080"
echo "  Login:    http://localhost:3000/login"
echo "  Admin:    http://localhost:3000/admin"
echo "  Swagger:  http://localhost:8080/api-docs"
echo ""
echo "Press Ctrl+C to stop"
echo ""

trap "echo 'Stopping...'; kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit 0" SIGINT SIGTERM
wait
