#!/usr/bin/env node
// REAL MONEY GATE 1 — evidence collector + checklist generator (Stage 31).
//
// READ-ONLY. This tool NEVER enables a flag, NEVER calls an exchange with real keys, NEVER touches
// production. It reads committed evidence files, evaluates them, and writes
// docs/trading-agent/gates/real-money-gate-1.md. Every item stays PENDING-HUMAN until two distinct
// humans approve the exact evidence bundle (evidenceHash). Even then the verdict is only
// "READY FOR FOUNDER DECISION": unlocking LIVE_TRADING is a separate, two-person-reviewed code change.
//
// Usage: node scripts/trading/real-money-gate.mjs [--check] [--out <md>] [--root <repo>] [--evidence <dir>] [--now <iso>]
//   exit 0 = every item has OK evidence AND two-person approval of this evidence hash
//   exit 1 = gate CLOSED (anything missing / not met / unapproved)   exit 2 = tool error
import { readFileSync, existsSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { REQUIRED_FALSE, REQUIRED_TRUE } from '../../apps/api/src/trading_agent/brokers/binance/key_validation.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = resolve(HERE, '../..');
const DAY = 86_400_000;

/** LIVE_SMALL hard ceilings (USDT minor units, 2 dp). FOUNDER DECISION — proposals until approved. */
export const LIVE_SMALL_CEILINGS = Object.freeze({ currency: 'USDT', decimals: 2, maxOrderNotionalMinor: 5_000n, maxDailyNotionalMinor: 20_000n, maxAccounts: 3, maxValidityDays: 30 });
export const REQUIRED_APPROVER_ROLES = Object.freeze(['founder', 'independent_reviewer']);

const ok = (detail, source) => ({ evidence: 'OK', detail, source });
const missing = (detail, source) => ({ evidence: 'MISSING', detail, source });
const notMet = (detail, source) => ({ evidence: 'NOT_MET', detail, source });
const readJson = (p) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null);

/** Gate 0 register rows (docs/trading-agent/BLOCKERS.md). */
export function parseBlockers(md) {
  return md.split('\n').filter((l) => /^\| B-\d{2} \|/.test(l)).map((l) => { const c = l.split('|').map((x) => x.trim()); return { id: c[1], status: c[2], title: c[3] }; });
}

/** Broker connectors from the public status config (apps/web/src/lib/trading-agent/status.ts). */
export function parseConnectors(ts) {
  const out = [];
  for (const m of ts.matchAll(/\{\s*id:\s*"([a-z]+)",\s*name:\s*"([^"]+)",[\s\S]*?stage:\s*"([a-z_]+)",\s*environment:\s*"([^"]+)"/g)) out.push({ id: m[1], name: m[2], stage: m[3], environment: m[4] });
  return out;
}

/** The Stage 21 adapter's apiRestrictions rule (imported, not copied). */
export function evaluateRestrictions(r) {
  const v = [];
  for (const k of REQUIRED_FALSE) if (r?.[k] !== false) v.push(`${k} must be false`);
  for (const k of REQUIRED_TRUE) if (r?.[k] !== true) v.push(`${k} must be true`);
  return v;
}

export function checks(ctx) {
  const { root, ev, now } = ctx;
  const src = (p) => relative(root, p);
  return [
    { id: 'G1-01', title: 'Gate 0: every blocker in the register is RESOLVED', run() {
      const p = join(root, 'docs/trading-agent/BLOCKERS.md');
      if (!existsSync(p)) return missing('blocker register not found', 'docs/trading-agent/BLOCKERS.md');
      const open = parseBlockers(readFileSync(p, 'utf8')).filter((b) => b.status !== 'RESOLVED');
      return open.length ? notMet(`${open.length} not resolved: ${open.map((b) => `${b.id} ${b.status}`).join(', ')}`, src(p)) : ok('all resolved', src(p));
    } },
    { id: 'G1-02', title: 'Gate 6: 5 consecutive green nightly E2E runs (paper loop + Binance Spot Testnet), with run links', run() {
      const p = join(ev, 'gate-6.json'); const g = readJson(p);
      if (!g) return missing('no nightly run evidence (Stage 30 job not yet running: needs main + trading-testnet secrets)', src(p));
      const runs = Array.isArray(g.runs) ? g.runs : [];
      const lastFive = runs.slice(-5);
      if (lastFive.length < 5 || lastFive.some((r) => r.conclusion !== 'success' || r.testnet !== 'exercised' || !/^https:\/\/github\.com\/.+\/actions\/runs\/\d+/.test(r.url ?? ''))) return notMet('fewer than 5 consecutive green runs with the testnet exercised and a run link', src(p));
      return ok(`5 consecutive green runs (latest ${lastFive.at(-1).url})`, src(p));
    } },
    { id: 'G1-03', title: 'Gate 7: security hardening (KMS envelope encryption, DB role separation, static egress IP, secret + licence scan in CI, daily key re-check, admin step-up)', run() {
      const p = join(ev, 'gate-7.json'); const g = readJson(p);
      const need = ['kmsEnvelopeEncryption', 'dbRoleSeparation', 'staticEgressIp', 'ciSecretScan', 'ciLicenceScan', 'dailyKeyRecheck', 'adminStepUp', 'prodSecretsRotated'];
      if (!g) return missing('no Gate 7 evidence (Stage 28 paused on its KMS STOP)', src(p));
      const bad = need.filter((k) => !(g[k]?.done === true && typeof g[k]?.evidence === 'string' && g[k].evidence.length > 0));
      return bad.length ? notMet(`not evidenced: ${bad.join(', ')}`, src(p)) : ok('all Gate 7 controls evidenced', src(p));
    } },
    { id: 'G1-04', title: 'Broker key permissions snapshot (apiRestrictions): no withdrawals / internal / universal transfer; trade + read only; ≤ 24 h old', run() {
      const dir = join(ev, 'broker-keys');
      const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')) : [];
      if (!files.length) return missing('no key snapshot (captured by the founder with the adapter validateKey(); never the key itself)', src(dir));
      const problems = [];
      for (const f of files) {
        const s = readJson(join(dir, f));
        if (!/^[0-9a-f]{16}$/.test(s?.keyFingerprint ?? '')) problems.push(`${f}: keyFingerprint (16 hex) required`);
        if (s?.apiKey || s?.secret) problems.push(`${f}: must not contain key material`);
        const age = now - Date.parse(s?.capturedAt ?? '');
        if (!(age >= 0 && age <= DAY)) problems.push(`${f}: snapshot older than 24 h or undated`);
        for (const v of evaluateRestrictions(s?.restrictions)) problems.push(`${f}: ${v}`);
      }
      return problems.length ? notMet(problems.join('; '), src(dir)) : ok(`${files.length} key snapshot(s) compliant`, src(dir));
    } },
    { id: 'G1-05', title: 'IP restriction: every key is bound to the execution service static egress IP (one customer per IP where the broker requires it)', run() {
      const eg = readJson(join(ev, 'egress.json'));
      if (!eg?.ip) return missing('no static egress IP recorded (B-08)', src(join(ev, 'egress.json')));
      const dir = join(ev, 'broker-keys');
      const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')) : [];
      if (!files.length) return missing('no key snapshot to compare', src(dir));
      const bad = files.filter((f) => !(readJson(join(dir, f))?.whitelistedIps ?? []).includes(eg.ip));
      return bad.length ? notMet(`keys not bound to ${eg.ip}: ${bad.join(', ')}`, src(dir)) : ok(`all keys bound to ${eg.ip} (${eg.region ?? 'region?'})`, src(join(ev, 'egress.json')));
    } },
    { id: 'G1-06', title: 'Test suites green on the gate commit (trading unit + integration + CI baseline)', run() {
      const p = join(ev, 'suites.json'); const s = readJson(p);
      if (!s) return missing('no recorded suite results for the gate commit', src(p));
      const bad = ['tradingUnit', 'tradingIntegration', 'baseline'].filter((k) => !(s[k]?.failures === 0 && s[k]?.passes > 0));
      const age = now - Date.parse(s.recordedAt ?? '');
      if (!(age >= 0 && age <= 7 * DAY)) bad.push('results older than 7 days');
      return bad.length ? notMet(`not green: ${bad.join(', ')}`, src(p)) : ok(`green at ${s.commit}`, src(p));
    } },
    { id: 'G1-07', title: `LIVE_SMALL allowlist present and within ceilings (≤ ${LIVE_SMALL_CEILINGS.maxAccounts} accounts; per order ≤ ${LIVE_SMALL_CEILINGS.maxOrderNotionalMinor} minor, per day ≤ ${LIVE_SMALL_CEILINGS.maxDailyNotionalMinor} minor ${LIVE_SMALL_CEILINGS.currency}; ≤ ${LIVE_SMALL_CEILINGS.maxValidityDays} days)`, run() {
      const p = join(root, 'docs/trading-agent/gates/live-small-allowlist.json'); const a = readJson(p);
      if (!a || !Array.isArray(a.accounts) || a.accounts.length === 0) return missing('allowlist empty', src(p));
      const bad = [];
      if (a.accounts.length > LIVE_SMALL_CEILINGS.maxAccounts) bad.push(`more than ${LIVE_SMALL_CEILINGS.maxAccounts} accounts`);
      for (const x of a.accounts) {
        const tag = x.brokerAccountId ?? '?';
        if (!/^prn_[A-Za-z0-9_-]{3,64}$/.test(x.principalId ?? '') || !/^bka_[A-Za-z0-9_-]{4,64}$/.test(x.brokerAccountId ?? '')) bad.push(`${tag}: principal / broker account ids`);
        if (!Array.isArray(x.instruments) || !x.instruments.length) bad.push(`${tag}: instruments`);
        try { if (BigInt(x.maxOrderNotionalMinor) > LIVE_SMALL_CEILINGS.maxOrderNotionalMinor || BigInt(x.maxDailyNotionalMinor) > LIVE_SMALL_CEILINGS.maxDailyNotionalMinor) bad.push(`${tag}: caps above ceiling`); } catch { bad.push(`${tag}: caps must be integer minor units`); }
        const days = (Date.parse(x.expiresAt ?? '') - now) / DAY;
        if (!(days > 0 && days <= LIVE_SMALL_CEILINGS.maxValidityDays)) bad.push(`${tag}: expiresAt within ${LIVE_SMALL_CEILINGS.maxValidityDays} days`);
      }
      return bad.length ? notMet(bad.join('; '), src(p)) : ok(`${a.accounts.length} account(s) within ceilings`, src(p));
    } },
    { id: 'G1-08', title: 'Flags: LIVE_TRADING / AUTONOMOUS_MODE / UPSTOX_AUTOMATED still LOCKED in code (unlock = separate two-person PR); LIVE_SMALL defined', run() {
      const p = join(root, 'apps/api/src/trading_agent/flags.mjs');
      const t = existsSync(p) ? readFileSync(p, 'utf8') : '';
      const locked = (t.match(/LOCKED_TRADING_FLAGS = Object\.freeze\(new Set\(\[([\s\S]*?)\]\)\)/) ?? [])[1] ?? '';
      const bad = ['LIVE_TRADING', 'AUTONOMOUS_MODE', 'UPSTOX_AUTOMATED'].filter((f) => !locked.includes(`'${f}'`));
      if (!t.includes("'LIVE_SMALL'")) bad.push('LIVE_SMALL flag not defined');
      return bad.length ? notMet(`unexpected flag state: ${bad.join(', ')}`, src(p)) : ok('locked as required before the gate decision', src(p));
    } },
    { id: 'G1-09', title: 'Legal / scope sign-off (B-09) and professional review of RPrC items (GST invoices, Trading Agent terms, risk disclosure)', run() {
      const p = join(ev, 'legal.json'); const l = readJson(p);
      const need = ['scopeDecision', 'brokerTermsReview', 'riskDisclosure', 'tradingAgentTerms', 'gstInvoiceFormat'];
      if (!l) return missing('no legal / professional sign-off recorded', src(p));
      const bad = need.filter((k) => !(l[k]?.signedOffBy && l[k]?.date));
      return bad.length ? notMet(`not signed off: ${bad.join(', ')}`, src(p)) : ok('all signed off', src(p));
    } },
  ];
}

/** Hash over every item's evaluated evidence: approvals bind to this exact bundle. */
export function evidenceHash(results) {
  return `sha256:${createHash('sha256').update(JSON.stringify(results.map((r) => [r.id, r.evidence, r.detail]))).digest('hex')}`;
}

/** Two-person rule: ≥ 2 distinct humans (distinct GitHub logins), roles founder + independent reviewer, both on this hash. */
export function evaluateApprovals(approvals, hash) {
  const list = Array.isArray(approvals?.approvals) ? approvals.approvals.filter((a) => a.evidenceHash === hash) : [];
  const logins = new Set(list.map((a) => String(a.githubLogin ?? '').toLowerCase()).filter(Boolean));
  const roles = new Set(list.map((a) => a.role));
  const problems = [];
  if (logins.size < 2) problems.push('two distinct approvers (GitHub logins) on this evidence hash required');
  for (const r of REQUIRED_APPROVER_ROLES) if (!roles.has(r)) problems.push(`missing role ${r}`);
  return { ok: problems.length === 0, problems, approvers: [...logins] };
}

export function runGate({ root = DEFAULT_ROOT, evidenceDir, now = Date.now() } = {}) {
  const ev = evidenceDir ?? join(root, 'docs/trading-agent/gates/evidence');
  const results = checks({ root, ev, now }).map((c) => { let r; try { r = c.run(); } catch (e) { r = notMet(`check error: ${e.message}`, '—'); } return { id: c.id, title: c.title, ...r }; });
  const hash = evidenceHash(results);
  const approvals = evaluateApprovals(readJson(join(ev, 'approvals.json')), hash);
  const allOk = results.every((r) => r.evidence === 'OK');
  for (const r of results) r.status = allOk && approvals.ok ? 'APPROVED (two-person)' : 'PENDING-HUMAN';
  const connectors = existsSync(join(root, 'apps/web/src/lib/trading-agent/status.ts')) ? parseConnectors(readFileSync(join(root, 'apps/web/src/lib/trading-agent/status.ts'), 'utf8')) : [];
  const verdict = allOk && approvals.ok ? 'READY FOR FOUNDER DECISION (nothing is enabled by this tool)' : 'CLOSED';
  return { results, hash, approvals, allOk, verdict, connectors, generatedAt: new Date(now).toISOString() };
}

const STATE_COLUMNS = ['Broker', 'Code', 'Test environment run', 'Paper-validated (Gate 6)', 'How orders work', 'Live-small eligible', 'Live', 'Real money today'];
const MODE = { binance: 'agent suggests, user approves each order', upstox: 'COPILOT: user confirms every order; prepare-order only without a per-customer static IP', alpaca: 'user approves each order; commission via correspondent' };

export function renderGateDoc(g) {
  const L = [];
  L.push('# REAL MONEY GATE 1 — checklist', '', '> **Generated by `scripts/trading/real-money-gate.mjs` — do not edit by hand.** This document never enables anything. Live trading stays **LOCKED in code**; unlocking it is a separate, two-person-reviewed change made by humans after this gate is approved. **STOP before any live action and ask the founder.**', '');
  L.push(`**Verdict: ${g.verdict}**`, '', `Generated: ${g.generatedAt} · evidence hash \`${g.hash}\``, '');
  L.push('## Checklist', '', '| ID | Item | Evidence | Detail | Source | Status |', '|---|---|---|---|---|---|');
  for (const r of g.results) L.push(`| ${r.id} | ${r.title} | **${r.evidence}** | ${r.detail.replace(/\|/g, '\\|')} | \`${r.source}\` | **${r.status}** |`);
  L.push('', `Two-person approval of this evidence hash: ${g.approvals.ok ? `recorded (${g.approvals.approvers.join(', ')})` : `**not recorded** — ${g.approvals.problems.join('; ')}`}.`, '');
  L.push('## State separation per broker', '', 'Code state comes from the public status configuration (`apps/web/src/lib/trading-agent/status.ts`); paper validation from Gate 6; nothing is live.', '', `| ${STATE_COLUMNS.join(' | ')} |`, `|${STATE_COLUMNS.map(() => '---').join('|')}|`);
  const g6 = g.results.find((r) => r.id === 'G1-02')?.evidence === 'OK';
  for (const c of g.connectors) {
    L.push(`| ${c.name} | ${c.stage === 'tested' ? 'IMPLEMENTED/TESTED' : c.stage.toUpperCase()} | ${c.environment}: **pending** (founder credentials) | ${c.id === 'binance' ? (g6 ? 'yes' : '**no**') : 'n/a (Gate 6 covers Binance)'} | ${MODE[c.id] ?? '—'} | **no** (gate ${g.verdict === 'CLOSED' ? 'closed' : 'pending decision'}) | **LOCKED** | **NO** |`);
  }
  L.push('', '## LIVE_SMALL ceilings (proposed — founder decision)', '', `| Ceiling | Value |`, '|---|---|',
    `| Accounts | ≤ ${LIVE_SMALL_CEILINGS.maxAccounts} |`, `| Per order | ≤ ${LIVE_SMALL_CEILINGS.maxOrderNotionalMinor} minor ${LIVE_SMALL_CEILINGS.currency} (${Number(LIVE_SMALL_CEILINGS.maxOrderNotionalMinor) / 100} ${LIVE_SMALL_CEILINGS.currency}) |`,
    `| Per day | ≤ ${LIVE_SMALL_CEILINGS.maxDailyNotionalMinor} minor ${LIVE_SMALL_CEILINGS.currency} (${Number(LIVE_SMALL_CEILINGS.maxDailyNotionalMinor) / 100} ${LIVE_SMALL_CEILINGS.currency}) |`, `| Allowlist entry validity | ≤ ${LIVE_SMALL_CEILINGS.maxValidityDays} days |`, '');
  L.push('## Two-person flag-enable procedure (humans only)', '',
    '1. **Collect evidence** (each by a human; this tool never calls an exchange or reads secrets): Gate 6 run links (`evidence/gate-6.json`), Gate 7 controls (`evidence/gate-7.json`), key-permission snapshots from the adapter `validateKey()` with a 16-hex key fingerprint and the whitelisted IPs, never the key (`evidence/broker-keys/*.json`, ≤ 24 h old), the static egress IP (`evidence/egress.json`), suite results on the gate commit (`evidence/suites.json`), legal sign-offs (`evidence/legal.json`), and the LIVE_SMALL allowlist (`live-small-allowlist.json`).',
    '2. **Regenerate** this document and read the evidence hash. Any later evidence change produces a new hash and voids earlier approvals.',
    '3. **Approver A (founder)** and **approver B (independent reviewer: security or legal, a different person)** each add an entry to `evidence/approvals.json` `{ approver, role, githubLogin, evidenceHash, approvedAt }` in a PR that the *other* approver reviews. The tool accepts only two distinct GitHub logins with roles `founder` and `independent_reviewer` on the **current** hash.',
    '4. **Unlock in code:** a separate PR removes `LIVE_TRADING` from `LOCKED_TRADING_FLAGS`, approved by both people. Branch protection must require two reviews (B-10).',
    '5. **Enable in staging first** (B-06): `TRADING_FLAG_LIVE_SMALL=true` for allowlisted accounts only, observe one full day, then production, set by the founder in the hosting console. Never by an agent, a script or CI.',
    '6. **Rollback** at any time: unset `TRADING_FLAG_LIVE_SMALL`, engage the global kill switch, and revert the unlock PR.', '');
  return `${L.join('\n')}\n`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
    const root = resolve(opt('--root') ?? DEFAULT_ROOT);
    const g = runGate({ root, evidenceDir: opt('--evidence') ? resolve(opt('--evidence')) : undefined, now: opt('--now') ? Date.parse(opt('--now')) : Date.now() });
    if (!args.includes('--check')) {
      const out = resolve(opt('--out') ?? join(root, 'docs/trading-agent/gates/real-money-gate-1.md'));
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, renderGateDoc(g));
      console.log(`wrote ${relative(process.cwd(), out)}`);
    }
    for (const r of g.results) console.log(`${r.id}  ${r.evidence.padEnd(8)} ${r.status}  ${r.title.slice(0, 70)}`);
    console.log(`verdict: ${g.verdict}`);
    process.exit(g.verdict === 'CLOSED' ? 1 : 0);
  } catch (e) {
    console.error(`real-money-gate: ${e.message}`);
    process.exit(2);
  }
}
