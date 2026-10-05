// Stage 26 — broker and feature status, from ONE config that follows a state machine. Public copy
// is derived from the state, so a page can never say more than the state allows (e.g. nothing
// reads "available" unless a connector is LIVE, and LIVE is impossible while live trading is
// locked — LOCKED in apps/api/src/trading_agent/flags.mjs; B-06/B-08/B-09 open).
export const CONNECTOR_STAGES = ["not_started", "implemented", "tested", "sandbox_verified", "pilot", "live"] as const;
export type ConnectorStage = (typeof CONNECTOR_STAGES)[number];

/** What must be true (evidence) before a connector may be in a stage. */
export const STAGE_REQUIREMENTS: Record<ConnectorStage, string[]> = {
  not_started: [],
  implemented: ["code"],
  tested: ["code", "tests"],
  sandbox_verified: ["code", "tests", "sandboxRun"],
  pilot: ["code", "tests", "sandboxRun", "brokerAgreement", "legalReview", "liveTradingUnlocked"],
  live: ["code", "tests", "sandboxRun", "brokerAgreement", "legalReview", "liveTradingUnlocked", "pilotComplete"],
};

export type Connector = {
  id: "binance" | "upstox" | "alpaca";
  name: string;
  region: string;
  stage: ConnectorStage;
  environment: string;
  howOrdersWork: string;
  evidence: Partial<Record<string, string>>;
  next: string;
};

/** Platform switches (truth, 2026-10-06). */
export type Platform = { liveTradingLocked: boolean; publicSignupOpen: boolean; apiPublic: boolean; paperPreviewOpen: boolean };
export const PLATFORM: Readonly<Platform> = Object.freeze({
  liveTradingLocked: true,
  publicSignupOpen: false,
  apiPublic: false,
  paperPreviewOpen: false,
});

export const CONNECTORS: readonly Connector[] = Object.freeze([
  { id: "binance", name: "Binance", region: "Crypto (spot)", stage: "tested", environment: "Test network",
    howOrdersWork: "The agent may send an order only after you approve it; keys that can withdraw are refused.",
    evidence: { code: "stage 21 (PR #476)", tests: "adapter suite + mutation checks" }, next: "A run on the test network with real test keys." },
  { id: "upstox", name: "Upstox", region: "India (equities)", stage: "tested", environment: "Sandbox",
    howOrdersWork: "Copilot only: you confirm every single order. Without a registered static IP for your own account, Satelink only prepares the order and you place it yourself.",
    evidence: { code: "stage 22 (PR #477)", tests: "adapter suite + mutation checks" }, next: "A run in the Upstox sandbox with a real sandbox token." },
  { id: "alpaca", name: "Alpaca", region: "United States (equities)", stage: "tested", environment: "Sandbox",
    howOrdersWork: "Orders are sent only after your approval and can be looked up by our reference, so a lost connection never creates a second order.",
    evidence: { code: "stage 23 (PR #478)", tests: "adapter suite + mutation checks" }, next: "A run in the Alpaca sandbox with real sandbox credentials." },
].map((c) => Object.freeze(c as Connector)));

export function stageIndex(stage: ConnectorStage): number { return CONNECTOR_STAGES.indexOf(stage); }

/** Only forward, one step at a time, and only with the required evidence. */
export function canAdvance(c: Connector, to: ConnectorStage, platform: Readonly<Platform> = PLATFORM): { ok: boolean; missing: string[] } {
  const missing = STAGE_REQUIREMENTS[to].filter((k) => (k === "liveTradingUnlocked" ? platform.liveTradingLocked : !c.evidence[k]));
  return { ok: stageIndex(to) === stageIndex(c.stage) + 1 && missing.length === 0, missing };
}

/** Every requirement of the CURRENT stage is evidenced (config can't claim more than it shows). */
export function stageIsEvidenced(c: Connector, platform: Readonly<Platform> = PLATFORM): boolean {
  return STAGE_REQUIREMENTS[c.stage].every((k) => (k === "liveTradingUnlocked" ? !platform.liveTradingLocked : Boolean(c.evidence[k])));
}

/** Public wording, derived from the state — never hand-written per page. */
export function stageLabel(stage: ConnectorStage): { text: string; available: boolean } {
  switch (stage) {
    case "not_started": return { text: "Not started", available: false };
    case "implemented": return { text: "In development — not available", available: false };
    case "tested": return { text: "In development, tested internally — not available", available: false };
    case "sandbox_verified": return { text: "Checked in the broker's test environment — not available", available: false };
    case "pilot": return { text: "Private pilot — invitation only", available: false };
    case "live": return { text: "Available", available: true };
  }
}
