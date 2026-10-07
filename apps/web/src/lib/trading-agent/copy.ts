// Stage 26 — Trading Agent page copy (the claims lint scans this file and the pages).
// Rules: plain words; no performance, partnership, approval or availability claims; anything
// numeric that is not a fact is inside a "Hypothetical" block; legal text is NOT written here —
// it is a marked placeholder (RPrC: requires professional review) until a lawyer reviews it.
export const TA_PAGES = [
  { href: "/trading-agent", label: "Home" },
  { href: "/trading-agent/product", label: "Product" },
  { href: "/trading-agent/how-it-works", label: "How it works" },
  { href: "/trading-agent/brokers", label: "Brokers" },
  { href: "/trading-agent/ai", label: "AI" },
  { href: "/trading-agent/risk", label: "Risk" },
  { href: "/trading-agent/pricing", label: "Pricing" },
  { href: "/trading-agent/security", label: "Security" },
  { href: "/trading-agent/docs", label: "Documentation" },
  { href: "/trading-agent/status", label: "Status" },
  { href: "/trading-agent/login", label: "Log in" },
] as const;

export const HOME = {
  eyebrow: "Satelink Trading Agent · in development",
  title: "Trading rules you write, limits you sign, orders you approve",
  lede: "The Trading Agent follows rules you set, inside limits you sign, at a broker that keeps your money. It suggests; you decide. It is not available yet.",
  points: [
    { title: "You stay in control", body: "Every order needs your approval and must fit limits you signed. A single switch pauses everything." },
    { title: "Your money stays with your broker", body: "Satelink never holds customer money. Broker keys that could withdraw funds are refused." },
    { title: "Every decision has a receipt", body: "For each order you can see who asked for it, which limits were checked and what the broker said." },
  ],
};

export const PRODUCT = {
  title: "What the Trading Agent is — and is not",
  is: [
    "Software that reads market data and your positions, and suggests orders that fit rules you wrote.",
    "A set of limits (size, instruments, daily loss) that every order is checked against before it can be sent.",
    "A record of every step, so you can always answer \"why did this happen?\".",
  ],
  isNot: [
    "Not a fund, and not a place to keep money.",
    "Not advice. It does not tell you what to buy or sell.",
    "Not able to send an order on its own: a person approves each one.",
    "Not available yet. Live trading is off for every account.",
  ],
};

export const HOW = {
  title: "How an order moves",
  steps: [
    { title: "1. You set the rules", body: "Write a strategy in a simple rule format. Each saved version is locked, so you always know exactly what ran." },
    { title: "2. You sign your limits", body: "You sign a permission that says which broker account, which instruments and how much. Signing needs a code from your authenticator app." },
    { title: "3. The agent suggests", body: "The agent can read data and suggest an order. It cannot send one." },
    { title: "4. Checks run", body: "Every order is checked against your signed limits and a stop switch before it can be sent." },
    { title: "5. You approve, it is sent once", body: "After approval the order goes to your broker once. If a connection drops, we look the order up instead of sending it again." },
    { title: "6. You get a receipt", body: "The receipt shows the rule, the checks, your permission and the broker's answer." },
  ],
};

export const AI = {
  title: "How AI is used",
  rows: [
    ["Reads market data, positions and your limits", "Yes"],
    ["Suggests an order for you to review", "Yes — it waits for your approval"],
    ["Sends, changes or cancels an order", "No, never"],
    ["Moves money, sees passwords or broker keys", "No, never"],
    ["Learns from your data to train models", "No"],
  ],
};

export const RISK = {
  title: "Risk, and how it is limited",
  controls: [
    { title: "Signed limits", body: "Order size, daily amount, daily loss, instruments and open positions are capped by limits you sign." },
    { title: "Stop switch", body: "One switch pauses all trading and asks your broker to cancel open orders. Turning it back on needs a code." },
    { title: "Checks that fail closed", body: "If a check cannot run, the order is refused rather than sent." },
    { title: "Paper first", body: "Results shown before live trading are simulated and labelled that way." },
  ],
};

export const PRICING = {
  title: "Pricing",
  body: "There is no price for the Trading Agent yet, and nobody can be charged for it while it is in development. When pricing is decided it will be published here before anyone is asked to pay.",
};

export const SECURITY = {
  title: "Security",
  items: [
    { title: "Trade-only broker keys", body: "Keys that can withdraw or transfer money are refused before any order is sent." },
    { title: "Codes for sensitive steps", body: "Signing a permission, approving a suggestion and resuming trading each need a fresh code from your authenticator app." },
    { title: "Secrets stay on the server", body: "Broker keys and tokens are never sent to your browser and are encrypted per user." },
    { title: "Every request once", body: "Changes carry a one-time request key, so a double click or a retry cannot create a second order." },
  ],
};

export const DOCS = {
  title: "Documentation",
  body: "The Trading Agent API is not public yet. When it opens, its reference will be published here. Until then, these pages describe how the product works.",
};

export const LEGAL_PLACEHOLDERS = [
  { id: "ta-risk-disclosure", title: "Risk disclosure" },
  { id: "ta-terms", title: "Trading Agent terms" },
] as const;
