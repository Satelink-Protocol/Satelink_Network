#!/usr/bin/env node
// Trading security scans (Stage 28, option 1) — secret patterns + dependency licences.
// REPORT-ONLY by default (exit 0) so it can run in CI without breaking builds; --strict exits 1 on
// any finding. Never prints a matched secret: only file, line and pattern name.
//
// Usage: node scripts/trading/security-scan.mjs [secrets|licences|all] [--strict] [--json]
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const j = (...p) => p.join(''); // keeps literal key markers out of this file (pre-commit gate)

// name → regex. Built from parts so this file never contains a literal secret marker.
export const SECRET_PATTERNS = Object.freeze({
  aws_access_key_id: new RegExp(j('\\b(AKIA|ASIA)', '[0-9A-Z]{16}\\b')),
  pem_key_block: new RegExp(j('-----BEGIN (RSA |EC |OPENSSH |)', 'PRIV', 'ATE KEY-----')),
  stripe_live: new RegExp(j('\\bsk_', 'live_[A-Za-z0-9]{24,}')),
  razorpay_live: new RegExp(j('\\brzp_', 'live_[A-Za-z0-9]{10,}')),
  anthropic_key: new RegExp(j('\\bsk-', 'ant-[A-Za-z0-9_-]{20,}')),
  groq_key: new RegExp(j('\\bgsk_', '[A-Za-z0-9]{32,}')),
  discord_webhook: new RegExp(j('discord(app)?\\.com/api/', 'webhooks/\\d{6,}/[A-Za-z0-9_-]{20,}')),
  github_token: new RegExp(j('\\bgh', '[pousr]_[A-Za-z0-9]{36,}')),
  binance_secret_assignment: /\b(BINANCE|binance)[A-Za-z_]*(SECRET|secret)[A-Za-z_]*\s*[:=]\s*['"][A-Za-z0-9]{48,}['"]/,
});

/** AGPL / GPL / SSPL / BUSL / unknown in a production dependency → finding. */
export const LICENCE_DENY = /\b(AGPL|GPL|SSPL|BUSL|Commons-Clause)\b/i;

const SKIP = /(^|\/)(node_modules|\.git|\.next|dist|coverage)\/|package-lock\.json$|\.(png|jpg|jpeg|gif|webp|ico|pdf|woff2?|ttf|lock)$/;

export function scanText(path, text) {
  const out = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    for (const [name, re] of Object.entries(SECRET_PATTERNS)) if (re.test(lines[i])) out.push({ file: path, line: i + 1, pattern: name });
  }
  return out;
}

export function scanSecrets(root = ROOT) {
  const files = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).split('\n').filter((f) => f && !SKIP.test(f));
  const findings = [];
  for (const f of files) {
    let text;
    try { text = readFileSync(resolve(root, f), 'utf8'); } catch { continue; }
    if (text.includes('\u0000')) continue; // binary
    findings.push(...scanText(f, text));
  }
  return findings;
}

/** An SPDX expression is denied only when EVERY OR-alternative is denied (dual MIT/GPL is fine). */
export function deniedExpression(expr) {
  return String(expr).replace(/[()]/g, '').split(/\s+OR\s+/i).every((alt) => LICENCE_DENY.test(alt));
}

/** Production (non-dev) packages in package-lock.json with a denied or missing licence. */
export function scanLicences(lock) {
  const findings = [];
  for (const [p, meta] of Object.entries(lock.packages ?? {})) {
    if (!p.includes('node_modules/') || meta.dev || meta.link) continue;
    const lic = typeof meta.license === 'string' ? meta.license : meta.license?.type;
    if (!lic) findings.push({ package: p.split('node_modules/').pop(), version: meta.version, licence: 'UNKNOWN' });
    else if (deniedExpression(lic)) findings.push({ package: p.split('node_modules/').pop(), version: meta.version, licence: lic });
  }
  return findings;
}

function main(argv) {
  const mode = argv.find((a) => !a.startsWith('--')) ?? 'all';
  const strict = argv.includes('--strict');
  const report = {};
  if (mode === 'secrets' || mode === 'all') report.secrets = scanSecrets();
  if (mode === 'licences' || mode === 'all') report.licences = scanLicences(JSON.parse(readFileSync(resolve(ROOT, 'package-lock.json'), 'utf8')));
  const n = (report.secrets?.length ?? 0) + (report.licences?.length ?? 0);
  if (argv.includes('--json')) process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  else {
    for (const s of report.secrets ?? []) console.log(`::warning file=${s.file},line=${s.line}::possible secret (${s.pattern})`);
    for (const l of report.licences ?? []) console.log(`::warning::licence ${l.licence} in production dependency ${l.package}@${l.version}`);
    console.log(`security-scan: ${report.secrets?.length ?? '-'} secret finding(s), ${report.licences?.length ?? '-'} licence finding(s)${strict ? '' : ' (report-only)'}`);
  }
  process.exit(strict && n > 0 ? 1 : 0);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
