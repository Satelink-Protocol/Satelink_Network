// Stage 26 — claims lint (honest positioning) + the broker-status state machine + page gates.
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { lintClaims, lintSource } from "../scripts/claims-lint.mjs";
import DISCLAIMERS from "../src/lib/trading-agent/disclaimers.json";
import { CONNECTORS, PLATFORM, STAGE_REQUIREMENTS, canAdvance, stageIndex, stageIsEvidenced, stageLabel, CONNECTOR_STAGES } from "../src/lib/trading-agent/status";
import { TA_PAGES, LEGAL_PLACEHOLDERS } from "../src/lib/trading-agent/copy";
import { siteTradingAgentEnabled } from "../src/lib/trading-agent/flag";

const WEB = resolve(__dirname, "..");
const APP = join(WEB, "src/app/(marketing)");
const pageFile = (href: string) => join(APP, href, "page.tsx");
type Finding = { rule: string; match: string };
const lint = (src: string, file = "x.tsx"): Finding[] => lintSource(file, src, Object.values(DISCLAIMERS)) as Finding[];

describe("claims lint — acceptance: green on the Trading Agent pages", () => {
  it("scans every page, component and copy module and finds nothing", () => {
    const { files, findings } = lintClaims(WEB);
    expect(files.length).toBeGreaterThanOrEqual(16);
    for (const p of TA_PAGES) expect(files, p.href).toContain(join("src/app/(marketing)", p.href, "page.tsx"));
    expect(findings).toEqual([]);
  });
});

describe("claims lint — it actually catches bad copy", () => {
  const cases: [string, string][] = [
    ["<p>Official Binance partner</p>", "PARTNERSHIP"],
    ["<p>Approved by SEBI</p>", "PARTNERSHIP"],
    ["const t = 'Integrated with Upstox, trusted by traders';", "PARTNERSHIP"],
    ["<p>Backed by leading exchanges</p>", "PARTNERSHIP"],
    ["<p>Earn steady monthly returns</p>", "PERFORMANCE"],
    ["<p>Our strategies are profitable</p>", "PERFORMANCE"],
    ["<p>Guaranteed, risk-free</p>", "PERFORMANCE"],
    ["<p>Find alpha with AI</p>", "PERFORMANCE"],
    ["<p>Start trading in minutes</p>", "AVAILABILITY"],
    ["<p>Available now for everyone</p>", "AVAILABILITY"],
    ["<p>Our AI predicts the market</p>", "AI_OVERCLAIM"],
    ["<p>Fully automated trading bot</p>", "AI_OVERCLAIM"],
    ["<p>Up 40% this year</p>", "UNLABELLED_NUMBER"],
    ["<p>Made $1,200 last week</p>", "UNLABELLED_NUMBER"],
    ["<p>Limit 30,000 USDT</p>", "UNLABELLED_NUMBER"],
  ];
  for (const [src, rule] of cases) {
    it(`flags ${rule}: ${src}`, () => expect(lint(src).map((f) => f.rule)).toContain(rule));
  }

  it("does not flag code, class names, links, approved disclaimers or labelled hypotheticals", () => {
    expect(lint("export function f() { return 1; }")).toEqual([]);
    expect(lint('<div className="partner-grid"><a href="/partners">Docs</a></div>')).toEqual([]);
    expect(lint(`<p>{"${DISCLAIMERS.noAffiliation}"}</p>`)).toEqual([]);
    expect(lint(`<Hypothetical><p>Buy 0.001 BTC at 30,000 USDT, up 5%</p></Hypothetical>`)).toEqual([]);
    expect(lint(`<div><Hypothetical><p>ok 5%</p></Hypothetical><p>not ok 5%</p></div>`).map((f) => f.rule)).toEqual(["UNLABELLED_NUMBER"]);
  });

  it("a legal placeholder must be marked RPrC", () => {
    expect(lint("export function LegalPlaceholder() { return <p>Terms go here</p>; }").map((f) => f.rule)).toContain("LEGAL_WITHOUT_REVIEW");
    expect(lint("export function LegalPlaceholder() { return <p>RPrC — review</p>; }")).toEqual([]);
  });

  it("the disclaimers themselves deny every relationship and promise", () => {
    expect(DISCLAIMERS.noAffiliation).toMatch(/not affiliated with, endorsed by or a partner of/);
    expect(DISCLAIMERS.noAffiliation).toMatch(/no broker, exchange or regulator has reviewed or approved/);
    expect(DISCLAIMERS.notAdvice).toMatch(/^Nothing on these pages is investment advice/);
    expect(DISCLAIMERS.notAdvice).toMatch(/nobody can promise any outcome/);
    expect(DISCLAIMERS.aiCanBeWrong).toMatch(/can be wrong/);
    expect(DISCLAIMERS.notAvailable).toMatch(/not available to the public/);
  });
});

describe("broker status — one config, a state machine, copy derived from state", () => {
  it("every connector's current stage is fully evidenced; none is beyond 'sandbox_verified' while live trading is locked", () => {
    expect(PLATFORM.liveTradingLocked).toBe(true);
    for (const c of CONNECTORS) {
      expect(stageIsEvidenced(c), c.id).toBe(true);
      expect(stageIndex(c.stage), c.id).toBeLessThanOrEqual(stageIndex("sandbox_verified"));
      expect(stageLabel(c.stage).available, c.id).toBe(false);
    }
  });

  it("advancing is forward, one step, with evidence; pilot/live need live trading unlocked", () => {
    const b = CONNECTORS.find((c) => c.id === "binance")!;
    expect(canAdvance(b, "sandbox_verified")).toEqual({ ok: false, missing: ["sandboxRun"] });
    expect(canAdvance({ ...b, evidence: { ...b.evidence, sandboxRun: "2026-10-07" } }, "sandbox_verified").ok).toBe(true);
    expect(canAdvance(b, "pilot").ok).toBe(false); // skipping a step
    const verified = { ...b, stage: "sandbox_verified" as const, evidence: { ...b.evidence, sandboxRun: "x", brokerAgreement: "x", legalReview: "x" } };
    expect(canAdvance(verified, "pilot").missing).toEqual(["liveTradingUnlocked"]);
    expect(canAdvance(verified, "pilot", { ...PLATFORM, liveTradingLocked: false }).ok).toBe(true);
    expect(canAdvance(b, "implemented").ok).toBe(false); // never backwards
  });

  it("only LIVE reads as available; every stage has requirements that only grow", () => {
    expect(CONNECTOR_STAGES.filter((s) => stageLabel(s).available)).toEqual(["live"]);
    for (let i = 1; i < CONNECTOR_STAGES.length; i++) {
      for (const r of STAGE_REQUIREMENTS[CONNECTOR_STAGES[i - 1]]) expect(STAGE_REQUIREMENTS[CONNECTOR_STAGES[i]]).toContain(r);
    }
  });
});

describe("pages — gated, noindex, disclosures, legal placeholders", () => {
  it("the flag is off unless exactly 'true'; every page and the layout 404 without it and are noindex", () => {
    expect(siteTradingAgentEnabled({})).toBe(false);
    expect(siteTradingAgentEnabled({ SITE_TRADING_AGENT: "1" })).toBe(false);
    expect(siteTradingAgentEnabled({ SITE_TRADING_AGENT: "true" })).toBe(true);
    const layout = readFileSync(join(APP, "trading-agent/layout.tsx"), "utf8");
    expect(layout).toMatch(/requireSiteTradingAgent\(\)/);
    expect(layout).toMatch(/index: false/);
    for (const p of TA_PAGES) {
      expect(existsSync(pageFile(p.href)), p.href).toBe(true);
      const src = readFileSync(pageFile(p.href), "utf8");
      expect(src, p.href).toMatch(/requireSiteTradingAgent\(\)/);
      expect(src, p.href).toMatch(/robots: \{ index: false, follow: false \}/);
    }
    expect(readFileSync(join(WEB, "src/app/robots.ts"), "utf8")).toMatch(/"\/trading-agent"/);
    expect(readFileSync(join(WEB, "src/app/sitemap.ts"), "utf8")).not.toMatch(/trading-agent/);
  });

  it("all 11 brief pages exist; the AI page carries the AI disclosure; every page frame carries advice + independence notes", () => {
    expect(TA_PAGES.map((p) => p.label)).toEqual(["Home", "Product", "How it works", "Brokers", "AI", "Risk", "Pricing", "Security", "Documentation", "Status", "Log in"]);
    expect(readFileSync(pageFile("/trading-agent/ai"), "utf8")).toMatch(/<Disclosure title="AI disclosure"[^>]*>\{AI_NOTE\}/);
    const parts = readFileSync(join(WEB, "src/components/trading-agent/Parts.tsx"), "utf8");
    expect(parts).toMatch(/DISCLAIMERS\.notAdvice/);
    expect(parts).toMatch(/DISCLAIMERS\.noAffiliation/);
    expect(parts).toMatch(/DISCLAIMERS\.notAvailable/);
  });

  it("legal text is not written: Risk and Pricing show RPrC placeholders only", () => {
    expect(LEGAL_PLACEHOLDERS.map((l) => l.title)).toEqual(["Risk disclosure", "Trading Agent terms"]);
    expect(readFileSync(pageFile("/trading-agent/risk"), "utf8")).toMatch(/<LegalPlaceholder \{\.\.\.LEGAL_PLACEHOLDERS\[0\]\} \/>/);
    expect(readFileSync(pageFile("/trading-agent/pricing"), "utf8")).toMatch(/<LegalPlaceholder \{\.\.\.LEGAL_PLACEHOLDERS\[1\]\} \/>/);
    expect(readFileSync(join(WEB, "src/components/trading-agent/Parts.tsx"), "utf8")).toMatch(/RPrC — this section requires professional \(legal\) review/);
  });

  it("broker and status pages read the one config (no hand-written status strings)", () => {
    for (const p of ["/trading-agent/brokers", "/trading-agent/status"]) {
      const src = readFileSync(pageFile(p), "utf8");
      expect(src, p).toMatch(/CONNECTORS/);
      expect(src, p).toMatch(/<StageBadge stage=\{c\.stage\} \/>/);
    }
  });
});
