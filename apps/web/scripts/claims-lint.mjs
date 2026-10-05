#!/usr/bin/env node
// Stage 26 — claims lint for the Trading Agent public pages (honest positioning).
// Scans rendered copy (pages, components, copy module) with comments, imports and class names
// removed, and the approved disclaimer sentences (src/lib/trading-agent/disclaimers.json)
// exempted word for word. Fails on:
//   PARTNERSHIP / APPROVAL  — partner, affiliated, endorsed, approved by, certified, licensed, regulated, official, backed by, trusted by …
//   PERFORMANCE / GUARANTEE — returns, profit, gains, earn, income, yield, win rate, beat the market, alpha, guarantee, risk-free …
//   AVAILABILITY            — available now, start trading, trade now, sign up to trade, live trading is on …
//   AI OVERCLAIM            — predicts the market, never wrong, autonomous trading, fully automated, AI-powered profits …
//   UNLABELLED NUMBERS      — a % figure or a currency amount outside a <Hypothetical> block
//   LEGAL WITHOUT REVIEW    — a legal placeholder that is not marked RPrC
// Usage: node scripts/claims-lint.mjs   (exit 1 on any finding)
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const WEB = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const SCOPE = ["src/app/(marketing)/trading-agent", "src/components/trading-agent", "src/lib/trading-agent"];

export const RULES = [
  ["PARTNERSHIP", /\bpartner(s|ed|ship|ships)?\b|\baffiliat(e|ed|ion)\b|\bendorse(d|ment)?\b|\bapproved by\b|\bapproval (from|of) (the )?(sebi|sec|finra|fca|rbi|regulator)|\bcertified\b|\blicensed\b|\bregulated\b|\bofficial\b|\bbacked by\b|\btrusted by\b|\bin collaboration with\b|\bintegrated with\b|\bas seen (in|on)\b|\bsebi\b|\bfinra\b/i],
  ["PERFORMANCE", /\breturns?\b|\bprofit(s|able)?\b|\bgains?\b|\bearn(s|ed|ing|ings)?\b|\bincome\b|\byield\b|\bapy\b|\broi\b|\bwin rate\b|\bbeat the market\b|\boutperform/i],
  ["PERFORMANCE", /\balpha\b|\bguarantee(d|s)?\b|\brisk[- ]free\b|\bpassive\b|\bget rich\b|\bsignals to (buy|sell|trade|profit)\b/i],
  ["AVAILABILITY", /\bavailable now\b|\bnow available\b|\bavailable today\b|\bstart trading\b|\btrade now\b|\bsign up to trade\b|\bjoin now\b|\blive trading is (on|open|available)\b|\bget started\b/i],
  ["AI_OVERCLAIM", /\bpredicts? (the )?(market|prices?)\b|\bnever (wrong|loses?)\b|\bautonomous trading\b|\bfully automated\b|\bai[- ]powered (profits?|returns?|trading)\b|\bsmart money\b/i],
];
const NUMBER = /\d[\d,.]*\s?%|[$₹€£]\s?\d|\b\d[\d,.]*\s?(USDT|USD|INR|USDC)\b/i;

function walk(dir, out = []) {
  let names;
  try { names = readdirSync(dir); } catch { return out; }
  for (const n of names) {
    const f = join(dir, n);
    if (statSync(f).isDirectory()) walk(f, out);
    else if (/\.(tsx?|json)$/.test(f) && !f.endsWith("disclaimers.json")) out.push(f);
  }
  return out;
}

function disclaimerSentences() {
  return Object.values(JSON.parse(readFileSync(join(WEB, "src/lib/trading-agent/disclaimers.json"), "utf8")));
}

// Attribute values that are not rendered copy.
const NON_COPY_ATTRS = new Set(["className", "href", "id", "key", "variant", "align", "as", "data-rprc", "aria-label", "rel", "target", "src", "type", "name"]);

/**
 * Rendered copy only, via the TypeScript AST: string literals, template text and JSX text —
 * minus imports, type positions, non-copy attributes, object keys and the approved disclaimers.
 * Each piece knows whether it sits inside a <Hypothetical> element.
 */
export function copyPieces(file, source, exempt = disclaimerSentences()) {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const pieces = [];
  const inHypothetical = (node) => {
    for (let p = node.parent; p; p = p.parent) if (ts.isJsxElement(p) && p.openingElement.tagName.getText(sf) === "Hypothetical") return true;
    return false;
  };
  const skip = (node) => {
    const p = node.parent;
    if (!p) return false;
    if (ts.isImportDeclaration(p) || ts.isExportDeclaration(p) || ts.isLiteralTypeNode(p) || ts.isExternalModuleReference(p)) return true;
    if (ts.isJsxAttribute(p) && NON_COPY_ATTRS.has(p.name.getText(sf))) return true;
    if (ts.isPropertyAssignment(p) && p.name === node) return true; // object keys
    if (ts.isElementAccessExpression(p) || ts.isCaseClause(p)) return true; // lookups / switch labels
    if (ts.isBinaryExpression(p) && /===|!==|==|!=/.test(p.operatorToken.getText(sf))) return true; // comparisons
    if (ts.isCallExpression(p) && /\b(includes|startsWith|endsWith|indexOf|test|match|replace|split|get)$/.test(p.expression.getText(sf))) return true;
    return false;
  };
  const visit = (node) => {
    let text = null;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) text = skip(node) ? null : node.text;
    else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) text = node.text;
    else if (ts.isJsxText(node)) text = node.text;
    if (text && text.trim()) {
      let t = text;
      for (const d of exempt) t = t.split(d).join(" ");
      const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
      pieces.push({ text: t, line: line + 1, hypothetical: inHypothetical(node) });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return pieces;
}

export function lintSource(file, source, exempt) {
  const findings = [];
  for (const p of copyPieces(file, source, exempt)) {
    for (const [rule, re] of RULES) { const m = p.text.match(re); if (m) findings.push({ file, line: p.line, rule, match: m[0] }); }
    if (!p.hypothetical && !/stage \d+ \(PR #\d+\)/.test(p.text)) { const m = p.text.match(NUMBER); if (m) findings.push({ file, line: p.line, rule: "UNLABELLED_NUMBER", match: m[0] }); }
  }
  if (/function LegalPlaceholder/.test(source) && !/RPrC/.test(source)) findings.push({ file, line: 1, rule: "LEGAL_WITHOUT_REVIEW", match: "LegalPlaceholder" });
  return findings;
}

export function lintClaims(root = WEB) {
  const exempt = disclaimerSentences();
  const files = SCOPE.flatMap((d) => walk(join(root, d)));
  return { files: files.map((f) => relative(root, f)), findings: files.flatMap((f) => lintSource(relative(root, f), readFileSync(f, "utf8"), exempt)) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { files, findings } = lintClaims();
  for (const f of findings) console.log(`${f.file}:${f.line}  ${f.rule}  "${f.match}"`);
  console.log(`claims-lint: ${files.length} files, ${findings.length} finding(s)`);
  process.exit(findings.length ? 1 : 0);
}
