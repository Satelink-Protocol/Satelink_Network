// Import-boundary lint for agent code (Stage 12).
//
// Agent code must not be able to reach credentials or side-effecting code. Checked
// statically over apps/api/src/trading_agent/agent/** (run by a test in CI):
//   * no import of the credentials subdomain, execution subdomain, broker adapter
//     / MockBroker (anything that can place orders), or a credential loader;
//   * no DB / Redis / process / filesystem / network-client modules;
//   * no process.env access; no dynamic import(); no require().
// Allowed: node:crypto, relative imports within agent/, read-only market_data
// types, and brokers/types.mjs + brokers/decimal.mjs (pure values).
import fs from 'node:fs';
import path from 'node:path';

export const FORBIDDEN_SPECIFIERS = Object.freeze([
  /(^|\/)credentials(\/|\.mjs$|$)/,
  /(^|\/)execution(\/|\.mjs$|$)/,
  /(^|\/)brokers\/(adapter|mock_broker|index)\.mjs$/,
  /(^|\/)brokers\/?$/,
  /credential[_-]?loader/i,
  /^(pg|ioredis|redis|bullmq|child_process|node:child_process|fs|node:fs|net|node:net|http|node:http|https|node:https|node:worker_threads|worker_threads)$/,
  /(^|\/)(app_factory|server)(\.mjs|\.js)?$/,
  /shared_redis|redisClient|ai_gateway|settlement|ledger|billing/,
]);

const ALLOWED_BARE = new Set(['node:crypto', 'express']);

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1');
}

/** Analyse one source string. @returns string[] violations */
export function checkSource(file, src) {
  const code = stripComments(src);
  const v = [];
  for (const m of code.matchAll(/\bimport\s*(?:[^'"()]*?\bfrom\s*)?['"]([^'"]+)['"]|\bexport\s+[^'"]*?\bfrom\s*['"]([^'"]+)['"]/g)) {
    const spec = m[1] ?? m[2];
    if (FORBIDDEN_SPECIFIERS.some((re) => re.test(spec))) v.push(`${file}: forbidden import "${spec}"`);
    else if (!spec.startsWith('.') && !ALLOWED_BARE.has(spec)) v.push(`${file}: bare import "${spec}" not in allowlist`);
  }
  if (/\bimport\s*\(/.test(code)) v.push(`${file}: dynamic import() is not allowed`);
  if (/\brequire\s*\(/.test(code)) v.push(`${file}: require() is not allowed`);
  if (/\bprocess\s*\.\s*env\b|\bprocess\s*\[\s*['"]env['"]\s*\]/.test(code)) v.push(`${file}: process.env access is not allowed`);
  if (/\bglobalThis\s*\.\s*process\b/.test(code)) v.push(`${file}: globalThis.process is not allowed`);
  return v;
}

/** Walk a directory of .mjs/.js files. @returns string[] violations */
export function checkAgentBoundary(dir, { skipFiles = ['boundary.mjs'] } = {}) {
  const out = [];
  (function walk(d) {
    for (const n of fs.readdirSync(d)) {
      const p = path.join(d, n);
      if (fs.statSync(p).isDirectory()) walk(p);
      else if (/\.(m?js)$/.test(n) && !skipFiles.includes(n)) out.push(...checkSource(path.relative(dir, p), fs.readFileSync(p, 'utf8')));
    }
  })(dir);
  return out;
}
