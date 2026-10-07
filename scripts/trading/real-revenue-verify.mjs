#!/usr/bin/env node
// REAL REVENUE GATE 1 — read-only three-way matcher (Stage 34).
//
//   journal txn (real book export)  ↔  statement line (founder's bank / wallet)  ↔  gateway / broker record
//
// READ-ONLY. It never posts, corrects or deletes a ledger entry; it has no database, network or env
// access. Inputs are founder-supplied exports kept OUTSIDE git (an input inside the repository is
// refused) and the report is written outside git too. Only real money counts: test-mode, simulated,
// founder-funded, unsettled and unmatched amounts are refused, never counted. A path (subscription or
// rebate) is REAL-REVENUE-VERIFIED only when every one of its items matches with zero variance.
// Moving receivable → revenue is NOT done here: matched items are listed as eligible for the approved
// ledger process (Stage 20); corrections are correcting entries, never deletes.
//
// Usage: node scripts/trading/real-revenue-verify.mjs --input <bundle.json> [--out <report.json>] [--rows]
//   exit 0 = no issue (every path with items verified)   exit 1 = STOP (any refusal / mismatch)   exit 2 = tool error
import { readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { resolve, dirname, relative, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const PATHS = Object.freeze({ subscription: 'razorpay_payment', rebate: 'binance_rebate' });
const ROLES = new Set(['revenue', 'receivable', 'cash', 'fee_expense', 'other']);
const INT = /^\d+$/;

/** Issue codes. Every one is a STOP for the path it belongs to. */
export const Issue = Object.freeze({
  SIMULATED_OR_TEST: 'SIMULATED_OR_TEST', FOUNDER_FUNDED: 'FOUNDER_FUNDED', FUNDING_UNVERIFIED: 'FUNDING_UNVERIFIED',
  NOT_SETTLED: 'NOT_SETTLED', UNMATCHED_JOURNAL: 'UNMATCHED_JOURNAL', UNMATCHED_STATEMENT: 'UNMATCHED_STATEMENT',
  ORPHAN_STATEMENT_LINE: 'ORPHAN_STATEMENT_LINE', ORPHAN_JOURNAL: 'ORPHAN_JOURNAL', DUPLICATE: 'DUPLICATE',
  VARIANCE: 'VARIANCE', CURRENCY_MISMATCH: 'CURRENCY_MISMATCH', JOURNAL_NOT_POSTED: 'JOURNAL_NOT_POSTED',
  JOURNAL_UNBALANCED: 'JOURNAL_UNBALANCED', FEE_NOT_BOOKED: 'FEE_NOT_BOOKED', INVALID: 'INVALID',
});

const big = (v, where, issues, path) => {
  if (typeof v !== 'string' || !INT.test(v)) { issues.push({ path, code: Issue.INVALID, ref: where, detail: 'amounts must be integer minor units as strings' }); return null; }
  return BigInt(v);
};

export function verify(bundle) {
  const issues = [];
  const add = (path, code, ref, detail) => issues.push({ path, code, ref, detail });
  if (bundle?.schema !== 'real-revenue-input/1.0') throw new Error('input schema must be real-revenue-input/1.0');
  const roles = bundle.accounts ?? {};
  for (const [a, r] of Object.entries(roles)) if (!ROLES.has(r)) throw new Error(`account ${a}: unknown role ${r}`);
  const journal = bundle.journal ?? [];
  const sources = bundle.sources ?? [];
  const lines = bundle.statementLines ?? [];
  const pathOfType = Object.fromEntries(Object.entries(PATHS).map(([p, t]) => [t, p]));

  const seen = new Set();
  for (const s of sources) { const k = `${s.type}|${s.id}`; if (seen.has(k)) add(pathOfType[s.type] ?? '?', Issue.DUPLICATE, s.id, 'source listed twice'); seen.add(k); }
  const lineBySettlement = new Map();
  for (const l of lines) {
    if (lineBySettlement.has(l.settlementId)) add(l.path, Issue.DUPLICATE, l.ref, `two statement lines for settlement ${l.settlementId}`);
    else lineBySettlement.set(l.settlementId, l);
  }
  const journalByRef = new Map();
  for (const t of journal) { const k = `${t.refType}|${t.refId}`; journalByRef.set(k, [...(journalByRef.get(k) ?? []), t]); }

  const items = [];
  const netBySettlement = new Map();
  const usedJournal = new Set();
  for (const s of sources) {
    const path = pathOfType[s.type];
    if (!path) { add('?', Issue.INVALID, s.id, `unknown source type ${s.type}`); continue; }
    const before = issues.length;
    if (s.mode !== 'live') add(path, Issue.SIMULATED_OR_TEST, s.id, `mode "${s.mode}" is not live money`);
    if (s.fundedBy === 'founder') add(path, Issue.FOUNDER_FUNDED, s.id, 'founder-funded amounts never count');
    else if (s.fundedBy !== 'customer') add(path, Issue.FUNDING_UNVERIFIED, s.id, 'funding source must be verified as an external customer or broker');
    if (s.status !== 'settled') add(path, Issue.NOT_SETTLED, s.id, `status "${s.status}" is expected, not received`);
    const gross = big(s.grossMinor, `${s.id}.grossMinor`, issues, path);
    const fee = big(s.feeMinor ?? '0', `${s.id}.feeMinor`, issues, path);
    const tax = big(s.taxMinor ?? '0', `${s.id}.taxMinor`, issues, path);
    const net = gross !== null && fee !== null && tax !== null ? gross - fee - tax : null;
    if (net !== null && s.settlementId) {
      const acc = netBySettlement.get(s.settlementId) ?? { net: 0n, currency: s.currency, path, sources: [] };
      if (acc.currency !== s.currency) add(path, Issue.CURRENCY_MISMATCH, s.id, `settlement ${s.settlementId} mixes currencies`);
      acc.net += net; acc.sources.push(s.id); netBySettlement.set(s.settlementId, acc);
    }
    if (!s.settlementId || !lineBySettlement.has(s.settlementId)) add(path, Issue.UNMATCHED_STATEMENT, s.id, `no statement line for settlement ${s.settlementId ?? '(none)'}`);
    const txns = journalByRef.get(`${s.type}|${s.id}`) ?? [];
    if (txns.length === 0) add(path, Issue.UNMATCHED_JOURNAL, s.id, 'no journal transaction references this record');
    if (txns.length > 1) add(path, Issue.DUPLICATE, s.id, `${txns.length} journal transactions reference this record`);
    const t = txns[0];
    if (t) {
      usedJournal.add(t.txnId);
      checkTxn(t, { path, gross, feeTotal: fee !== null && tax !== null ? fee + tax : null, currency: s.currency, roles, add });
    }
    items.push({ path, sourceType: s.type, sourceId: s.id, settlementId: s.settlementId ?? null, journalTxnId: t?.txnId ?? null, statementLineRef: lineBySettlement.get(s.settlementId)?.ref ?? null, matched: issues.length === before, bookedTo: t ? bookedTo(t, roles) : null });
  }
  for (const [sid, l] of lineBySettlement) {
    const acc = netBySettlement.get(sid);
    if (!acc) { add(l.path, Issue.ORPHAN_STATEMENT_LINE, l.ref, `statement line ${l.ref} matches no gateway or broker record`); continue; }
    const amount = big(l.amountMinor, `${l.ref}.amountMinor`, issues, acc.path);
    if (l.direction !== 'credit') add(acc.path, Issue.INVALID, l.ref, 'statement line must be a credit');
    if (l.currency !== acc.currency) add(acc.path, Issue.CURRENCY_MISMATCH, l.ref, `statement ${l.currency} vs records ${acc.currency}`);
    else if (amount !== null && amount !== acc.net) add(acc.path, Issue.VARIANCE, l.ref, `statement ${amount} vs settled net ${acc.net} (variance ${amount - acc.net})`);
  }
  for (const t of journal) {
    if (usedJournal.has(t.txnId)) continue;
    const touchesRevenue = (t.entries ?? []).some((e) => ['revenue', 'receivable'].includes(roles[e.accountId]) || /^sim:/.test(e.accountId));
    if (touchesRevenue) add(pathOfType[t.refType] ?? '?', Issue.ORPHAN_JOURNAL, t.txnId, 'revenue or receivable journal with no matching gateway or broker record');
  }
  // an issue on a matched item's settlement (variance, orphan) un-matches every item in it
  const bad = new Set(issues.map((i) => i.ref));
  for (const it of items) if (bad.has(it.statementLineRef) || bad.has(it.journalTxnId)) it.matched = false;

  const verdicts = {};
  for (const p of Object.keys(PATHS)) {
    const mine = items.filter((i) => i.path === p);
    const pathIssues = issues.filter((i) => i.path === p);
    verdicts[p] = mine.length === 0 && pathIssues.length === 0 ? 'NO_EVIDENCE' : pathIssues.length === 0 && mine.every((i) => i.matched) ? 'REAL-REVENUE-VERIFIED' : 'STOP';
  }
  const recognition = items.filter((i) => i.matched && verdicts[i.path] === 'REAL-REVENUE-VERIFIED').map((i) => ({
    journalTxnId: i.journalTxnId, sourceId: i.sourceId,
    action: i.bookedTo === 'receivable' ? 'eligible: reclassify receivable → revenue through the approved ledger process (Stage 20); not posted by this tool' : 'already in revenue; matched',
  }));
  return { verdicts, issues, items, recognition, stop: issues.length > 0 };
}

function bookedTo(t, roles) {
  const credited = new Set((t.entries ?? []).filter((e) => e.direction === 'credit').map((e) => roles[e.accountId]));
  return credited.has('revenue') ? 'revenue' : credited.has('receivable') ? 'receivable' : 'none';
}

function checkTxn(t, { path, gross, feeTotal, currency, roles, add }) {
  if (t.state !== 'posted' || (t.entries ?? []).some((e) => e.state !== 'posted')) add(path, Issue.JOURNAL_NOT_POSTED, t.txnId, 'transaction and every entry must be posted');
  if ((t.entries ?? []).some((e) => /^sim:/.test(e.accountId) || roles[e.accountId] === undefined)) add(path, Issue.SIMULATED_OR_TEST, t.txnId, 'simulated or unclassified account in the journal');
  if (t.currency !== currency || (t.entries ?? []).some((e) => e.currency !== currency)) { add(path, Issue.CURRENCY_MISMATCH, t.txnId, `journal currency vs record ${currency}`); return; }
  let dr = 0n; let cr = 0n; let revenue = 0n; let fees = 0n;
  for (const e of t.entries ?? []) {
    if (typeof e.amount !== 'string' || !INT.test(e.amount)) { add(path, Issue.INVALID, t.txnId, 'entry amounts must be integer strings'); return; }
    const a = BigInt(e.amount);
    if (e.direction === 'debit') dr += a; else cr += a;
    if (e.direction === 'credit' && ['revenue', 'receivable'].includes(roles[e.accountId])) revenue += a;
    if (e.direction === 'debit' && roles[e.accountId] === 'fee_expense') fees += a;
  }
  if (dr !== cr) add(path, Issue.JOURNAL_UNBALANCED, t.txnId, `debits ${dr} ≠ credits ${cr}`);
  if (gross !== null && revenue !== gross) add(path, Issue.VARIANCE, t.txnId, `journal revenue/receivable ${revenue} vs record gross ${gross} (variance ${revenue - gross})`);
  if (feeTotal !== null && fees !== feeTotal) add(path, Issue.FEE_NOT_BOOKED, t.txnId, `journal fees ${fees} vs record fee + tax ${feeTotal}`);
}

/** Refuse inputs / outputs inside the repository: statements stay outside git. */
export function assertOutsideRepo(p, repo = REPO) {
  const abs = resolve(p);
  let real = abs; try { real = realpathSync(abs); } catch { real = resolve(realpathSync(dirname(abs)), abs.split('/').pop()); }
  const rel = relative(realpathSync(repo), real);
  if (!rel.startsWith('..') && !isAbsolute(rel)) throw new Error(`${p} is inside the repository; statements and reports stay outside git`);
  return abs;
}

/** Evidence rows for the committed doc: ids only, no amounts. */
export function evidenceRows(report) {
  return report.items.map((i) => `| ${i.path} | \`${i.journalTxnId ?? '—'}\` | \`${i.statementLineRef ?? '—'}\` | \`${i.sourceType}:${i.sourceId}\` | ${i.matched ? 'MATCHED' : '**NOT MATCHED**'} |`).join('\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
    if (!opt('--input')) throw new Error('--input <bundle.json> is required');
    const input = assertOutsideRepo(opt('--input'));
    const report = verify(JSON.parse(readFileSync(input, 'utf8')));
    const text = `${JSON.stringify(report, null, 2)}\n`;
    const hash = `sha256:${createHash('sha256').update(text).digest('hex')}`;
    if (opt('--out')) writeFileSync(assertOutsideRepo(opt('--out')), text);
    for (const [p, v] of Object.entries(report.verdicts)) console.log(`${p}: ${v}`);
    for (const i of report.issues) console.log(`STOP ${i.path} ${i.code} ${i.ref}: ${i.detail}`);
    console.log(`items ${report.items.length}, matched ${report.items.filter((i) => i.matched).length}, issues ${report.issues.length}; report ${hash}`);
    if (args.includes('--rows')) console.log(evidenceRows(report));
    process.exit(report.stop ? 1 : 0);
  } catch (e) {
    console.error(`real-revenue-verify: ${e.message}`);
    process.exit(2);
  }
}
