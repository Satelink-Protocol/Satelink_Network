import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { AGENT_NAV, AGENT_NAV_GROUPS, IA_AREAS, agentNav } from "@/lib/trading/nav";
import { apiStateText, formatMinor, modeLabel, orderStateText, receiptText } from "@/lib/trading/states";
import { agentIaEnabled, isRevenueAdmin } from "@/lib/trading/flags";
import { ApiState, ModeBadge, OrderState, TradingDisclosure } from "@/components/trading/parts";

vi.mock("next/navigation", () => ({ usePathname: () => "/trading", useRouter: () => ({ push: () => {} }), notFound: () => { throw new Error("NEXT_NOT_FOUND"); }, redirect: () => { throw new Error("NEXT_REDIRECT"); } }));
vi.mock("next/link", () => ({ default: ({ href, children, ...p }: { href: string; children: React.ReactNode }) => <a href={href} {...p}>{children}</a> }));

const SRC = path.resolve(__dirname, "../src");
const APP = path.join(SRC, "app/(console)");
const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
const TRADING_PAGES = walk(path.join(APP, "trading")).filter((f) => f.endsWith("page.tsx")).concat(path.join(APP, "security/page.tsx"));
const pageExists = (href: string) => fs.existsSync(path.join(APP, href === "/" ? "" : href, "page.tsx"));

describe("layer 5 — flags and the information architecture", () => {
  it("CONSOLE_AGENT_IA is off unless exactly 'true'; Revenue admins come only from the server allowlist", () => {
    expect(agentIaEnabled({})).toBe(false);
    expect(agentIaEnabled({ CONSOLE_AGENT_IA: "1" })).toBe(false);
    expect(agentIaEnabled({ CONSOLE_AGENT_IA: "true" })).toBe(true);
    expect(isRevenueAdmin("u1", {})).toBe(false);
    expect(isRevenueAdmin("u1", { CONSOLE_REVENUE_ADMIN_IDS: "u0, u1" })).toBe(true);
    expect(isRevenueAdmin(null, { CONSOLE_REVENUE_ADMIN_IDS: "u1" })).toBe(false);
  });

  it("the nav covers all 14 IA areas, Revenue is admin-only, and every link has a page", () => {
    expect(IA_AREAS).toHaveLength(14);
    for (const area of IA_AREAS) expect(AGENT_NAV.map((i) => i.label), area).toContain(area);
    expect(agentNav({ revenueAdmin: false }).map((i) => i.label)).not.toContain("Revenue");
    expect(agentNav({ revenueAdmin: true }).map((i) => i.label)).toContain("Revenue");
    for (const i of AGENT_NAV) expect(pageExists(i.href), i.href).toBe(true);
    expect(new Set(AGENT_NAV.map((i) => i.key)).size).toBe(AGENT_NAV.length); // keyboard shortcuts unique
    for (const i of AGENT_NAV) expect(AGENT_NAV_GROUPS as readonly string[]).toContain(i.group);
  });

  it("Option 1: the live RPC / x402 / keys / requests / usage pages stay reachable; no DePIN or marketplace entry", () => {
    const dev = AGENT_NAV.filter((i) => i.group === "Developer & payments").map((i) => i.href);
    expect(dev).toEqual(expect.arrayContaining(["/rpc", "/x402", "/keys", "/requests", "/usage"]));
    expect(AGENT_NAV.map((i) => i.href).filter((h) => /^\/(node|network|builder|distributor|satelink)/.test(h))).toEqual([]);
    for (const legacy of ["rpc", "x402", "keys", "requests", "usage", "agents", "alerts", "data", "spend", "billing", "settings"]) expect(fs.existsSync(path.join(APP, legacy, "page.tsx")), legacy).toBe(true); // nothing deleted
  });

  it("every trading page is a 404 unless the flag is on; Revenue also checks the admin allowlist", () => {
    for (const f of TRADING_PAGES) expect(fs.readFileSync(f, "utf8"), f).toMatch(/requireAgentIa\(\)/);
    expect(fs.readFileSync(path.join(APP, "trading/revenue/page.tsx"), "utf8")).toMatch(/if \(!isRevenueAdmin\(session\?\.user\.id\)\) notFound\(\)/);
    for (const f of ["actions.ts"]) expect(fs.readFileSync(path.join(APP, "trading", f), "utf8").match(/if \(!agentIaEnabled\(\)\) redirect/g)).toHaveLength(4);
  });
});

describe("layer 3 — plain-language states", () => {
  it("every OMS status has a sentence; UNKNOWN says 'Confirming with Binance…' and promises no resend", () => {
    for (const s of ["approved", "submitted", "unknown", "acknowledged", "partially_filled", "filled", "cancel_requested", "cancelled", "rejected"]) {
      const t = orderStateText(s, "binance");
      expect(t.text, s).not.toMatch(/_/); // no raw machine words
      expect(t.text.length, s).toBeGreaterThan(5);
    }
    expect(orderStateText("unknown", "binance").text).toBe("Confirming with Binance… We never send it twice while we check.");
    expect(orderStateText("submitted", "upstox").text).toBe("Sending to Upstox…");
    expect(orderStateText("cancel_requested", "alpaca").text).toBe("Cancelling with Alpaca…");
    expect(orderStateText("acknowledged", null).text).toBe("The broker has your order — waiting for a fill");
    expect(orderStateText("acknowledged", "mock").text).toBe("The simulator has your order — waiting for a fill");
    expect(orderStateText("weird", "binance").text).toMatch(/checking what this means/);
    expect(orderStateText("filled").pending).toBe(false);
  });

  it("receipt completeness reads as a sentence without internal names", () => {
    expect(receiptText({ completeness: { complete: true, missing: [] } }).text).toMatch(/^Complete/);
    expect(receiptText({ completeness: { complete: false, missing: ["trace", "mandate"] } }).text).toBe("Incomplete — missing: linked history, signed permission.");
    expect(receiptText(null).complete).toBe(false);
  });

  it("API failures read as plain states, never raw codes", () => {
    expect(apiStateText(404, "NOT_FOUND").title).toBe("Trading Agent isn't switched on yet");
    expect(apiStateText(501, "NOT_IMPLEMENTED").body).toMatch(/rather than made-up numbers/);
    expect(apiStateText(0).title).toMatch(/Can't reach/);
    for (const s of [401, 403, 429, 500]) expect(apiStateText(s).title).not.toMatch(/[A-Z_]{4,}/);
  });
});

describe("layer 2 — simulated / hypothetical labels; layer 1 — exact numbers", () => {
  it("paper and backtest are labelled; unknown modes are treated as simulated", () => {
    expect(modeLabel("paper")).toMatchObject({ text: "Paper — simulated, no real money", simulated: true });
    expect(modeLabel("backtest")).toMatchObject({ text: "Hypothetical — backtest on past data", simulated: true });
    expect(modeLabel("live").simulated).toBe(false);
    expect(modeLabel(undefined).simulated).toBe(true);
  });

  it("minor units format exactly (no floats)", () => {
    expect(formatMinor("123456", 2)).toBe("1234.56");
    expect(formatMinor("-5", 2)).toBe("-0.05");
    expect(formatMinor("900719925474099312345", 8)).toBe("9007199254740.99312345");
    expect(formatMinor("12.3", 2)).toBe(null);
    expect(formatMinor("1", null)).toBe(null);
  });
});

describe("components (server-rendered)", () => {
  it("OrderState is a polite live region with the plain sentence; ModeBadge and the disclosure render", () => {
    const os = renderToStaticMarkup(<OrderState status="unknown" venue="binance" />);
    expect(os).toContain('role="status"');
    expect(os).toContain('aria-live="polite"');
    expect(os).toContain("Confirming with Binance…");
    expect(renderToStaticMarkup(<ModeBadge mode="paper" />)).toContain("Paper — simulated, no real money");
    const d = renderToStaticMarkup(<TradingDisclosure />);
    expect(d).toContain('role="note"');
    expect(d).toContain("Nothing here is a recommendation to buy or sell");
    expect(renderToStaticMarkup(<ApiState status={501} code="NOT_IMPLEMENTED" what="order history" />)).toContain("Not available yet");
  });

  it("Shell: flag on ⇒ agent-first nav (+Revenue only for admins); flag off ⇒ today's navigation unchanged", async () => {
    const { Shell } = await import("@/components/Shell");
    const base = { user: { name: "A", email: "a@example.invalid" }, keys: [], activeFp: null, theme: "dark" as const, mode: "advanced" as const };
    const on = renderToStaticMarkup(<Shell {...base} agentIa={{ revenueAdmin: false }}><p>x</p></Shell>);
    for (const label of ["Home", "Agent", "Markets", "Strategies", "Risk", "Brokers", "Positions", "Orders", "Executions", "P&amp;L", "Activity", "Billing", "Security", "Settings", "Developer &amp; payments", "RPC", "x402"]) expect(on, label).toContain(label);
    expect(on).not.toContain(">Revenue<");
    expect(renderToStaticMarkup(<Shell {...base} agentIa={{ revenueAdmin: true }}><p>x</p></Shell>)).toContain("Revenue");
    const off = renderToStaticMarkup(<Shell {...base}><p>x</p></Shell>);
    expect(off).toContain("Market data"); // today's advanced-mode label
    expect(off).not.toContain("/trading/risk");
  });
});

describe("layer 4 — safety and claims (static)", () => {
  const files = [...TRADING_PAGES, path.join(APP, "trading/actions.ts"), ...walk(path.join(SRC, "lib/trading")), path.join(SRC, "components/trading/parts.tsx")];
  const text = (f: string) => fs.readFileSync(f, "utf8");
  const code = (f: string) => text(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

  it("the trading API client is server-side only: never imported by a client component; no env or secrets in pages/components", () => {
    for (const f of walk(SRC).filter((x) => /\.(tsx|ts)$/.test(x))) {
      const s = text(f);
      if (/^["']use client["']/.test(s.trimStart())) expect(s, f).not.toMatch(/lib\/trading\/client/);
    }
    for (const f of [...TRADING_PAGES, path.join(SRC, "components/trading/parts.tsx")]) expect(code(f), f).not.toMatch(/process\.env|apiKey|secret|NEXT_PUBLIC/i);
  });

  it("every mutation form carries a server-generated Idempotency-Key and the client sends the CSRF header", () => {
    for (const f of TRADING_PAGES.filter((x) => /action=\{/.test(text(x)))) expect(text(f), f).toMatch(/name="idempotencyKey" value=\{randomUUID\(\)\}/);
    expect(text(path.join(SRC, "lib/trading/client.ts"))).toMatch(/X-Satelink-Client/);
    expect(text(path.join(APP, "trading/actions.ts"))).toMatch(/mode: "paper"/); // the console cannot ask for live
  });

  it("customer copy avoids banned claims (truth-lint list) and every customer trading page shows the disclosure", () => {
    const BANNED = [/signals to profit/i, /beat the market/i, /\bwin rate\b/i, /guaranteed (returns|profits|income|earnings|results|roi|gains)/i, /buy recommendation|sell recommendation/i, /get rich/i, /\balpha\b/i, /risk-free/i, /financial advice/i];
    for (const f of files) for (const re of BANNED) expect(text(f), `${path.basename(f)} ${re}`).not.toMatch(re);
    for (const f of TRADING_PAGES.filter((x) => !/revenue|security/.test(x))) expect(text(f), f).toMatch(/<TradingDisclosure \/>/); // admin Revenue + Security carry no trading figures
  });
});
