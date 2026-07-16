#!/usr/bin/env bash
# CI baseline guard (2026-07-16): run the apps/api test suite and fail ONLY
# on failures outside apps/api/test/known-failures-baseline.txt.
# Known failures that start passing are reported (prune the baseline) but
# do not fail the build. A collapsed run (<120 tests collected) fails hard
# so a broken loader can't pass green.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RESULTS="$(mktemp -d)/results.json"

cd "$ROOT/apps/api"
# Same invocation as npm run test:baseline (--no-config: .mocharc file bug;
# --exit: hanging handles), but with the JSON reporter for exact titles.
npx mocha --no-config --exit --reporter json --reporter-option output="$RESULTS" 'test/**/*.test.js' >/dev/null 2>&1

node - "$RESULTS" "$ROOT/apps/api/test/known-failures-baseline.txt" <<'EOF'
const fs = require('fs');
const [,, resultsPath, baselinePath] = process.argv;
const r = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
const known = fs.readFileSync(baselinePath, 'utf8')
  .split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
const failing = r.failures.map(f => f.fullTitle);
const newFailures = failing.filter(t => !known.includes(t));
const nowPassing = known.filter(t => !failing.includes(t));

console.log(`tests: ${r.stats.tests}, passes: ${r.stats.passes}, failures: ${r.stats.failures}, pending: ${r.stats.pending}`);

if (r.stats.tests < 120) {
  console.error(`FAIL: only ${r.stats.tests} tests collected (<120) — suite did not run fully`);
  process.exit(1);
}
if (nowPassing.length) {
  console.log(`NOTE: ${nowPassing.length} known-failing test(s) now pass — prune apps/api/test/known-failures-baseline.txt:`);
  nowPassing.forEach(t => console.log('  ✓ ' + t));
}
if (newFailures.length) {
  console.error(`FAIL: ${newFailures.length} NEW failure(s) outside the known baseline:`);
  newFailures.forEach(t => console.error('  ✗ ' + t));
  process.exit(1);
}
console.log('OK: no new failures outside the known baseline.');
EOF
