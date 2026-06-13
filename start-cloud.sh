#!/bin/sh
echo "Starting Paperclip on Railway... (claude-code enabled)"
cd /app/satelink && git pull origin main 2>/dev/null || true
cd /app
NODE_OPTIONS="--max-old-space-size=64" node -e "
const http = require('http');
const server = http.createServer((req, res) => {
  if (req.url === '/health' || req.url === '/api/health') {
    res.writeHead(200, {'Content-Type':'application/json'});
    res.end(JSON.stringify({status:'ok'}));
    return;
  }
  const opts = {hostname:'127.0.0.1', port:3101, path:req.url, method:req.method, headers:req.headers};
  const p = http.request(opts, r => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
  p.on('error', e => { res.writeHead(502); res.end(e.message); });
  req.pipe(p);
});
server.listen(3100, '0.0.0.0', () => console.log('[proxy] ready'));
" &
sleep 3

# ── Satelink: configure Claude CLI auth from Railway env var ──────────────
# The claude CLI (claude_local adapter) checks ~/.claude/credentials.json
# ANTHROPIC_API_KEY in Railway env is not enough — must be written to file
if [ -n "${ANTHROPIC_API_KEY}" ]; then
  mkdir -p "${HOME}/.claude"

  # Write credentials — try primary format first
  node -e "
    const fs = require('fs');
    const home = process.env.HOME || '/root';
    const dir = home + '/.claude';
    fs.mkdirSync(dir, { recursive: true });

    // Write credentials in all known formats (defensive)
    const creds = {
      primaryApiKey: process.env.ANTHROPIC_API_KEY,
      api_key: process.env.ANTHROPIC_API_KEY,
      claudeAiOauthTokenClaude: null,
      claudeAiOauthRefreshToken: null
    };
    fs.writeFileSync(dir + '/credentials.json', JSON.stringify(creds, null, 2));

    const settings = {
      hasCompletedOnboarding: true,
      autoUpdaterStatus: 'disabled',
      model: 'claude-sonnet-4-6',
      largeContextModel: 'claude-sonnet-4-6',
      smallModel: 'claude-haiku-4-5-20251001',
      theme: 'dark'
    };
    fs.writeFileSync(dir + '/settings.json', JSON.stringify(settings, null, 2));

    console.log('[satelink] Claude CLI credentials written to ' + dir);
    console.log('[satelink] ANTHROPIC_API_KEY prefix: ' + (process.env.ANTHROPIC_API_KEY || '').slice(0, 20) + '...');
  " 2>&1 || echo "[satelink] WARNING: credentials write failed"

  # Verify claude CLI can authenticate (non-interactive test)
  TEST_RESULT=$(ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY}" \
    claude -p "reply with exactly: SATELINK_AUTH_OK" \
    --no-streaming 2>&1 | head -3 || echo "CLI_TEST_FAILED")
  echo "[satelink] Claude CLI auth test: ${TEST_RESULT}"

  if echo "${TEST_RESULT}" | grep -q "SATELINK_AUTH_OK\|auth_ok\|OK"; then
    echo "[satelink] ✅ Claude CLI authenticated successfully"
  else
    echo "[satelink] ⚠️  Auth test did not return expected response — check: ${TEST_RESULT}"
    echo "[satelink] Continuing startup anyway (may succeed via env var fallback)"
  fi
else
  echo "[satelink] WARNING: ANTHROPIC_API_KEY not set in environment"
fi
# ── End Satelink Claude CLI auth ──────────────────────────────────────────

PORT=3101 NODE_OPTIONS="--max-old-space-size=384" exec paperclipai onboard --yes --run
