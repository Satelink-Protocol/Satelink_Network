# Stage 26 — Website repositioning (Trading Agent public pages)

**Branch:** `trading-agent/stage-26-website` (PR #481), stacked on Stage 25 (#480).

**State:** built and tested behind **`SITE_TRADING_AGENT`** (default off ⇒ every page is a 404). Pages are noindex and disallowed in `robots.ts`, are not in the sitemap, and nothing in the live navigation links to them.

**Code** (`apps/web`):
- pages: `src/app/(marketing)/trading-agent/**` (layout + 11 pages);
- parts: `src/components/trading-agent/Parts.tsx`;
- content: `src/lib/trading-agent/` (`copy.ts`, `status.ts`, `disclaimers.json`, `flag.ts`);
- lint: `scripts/claims-lint.mjs` (`npm run lint:claims`);
- tests: `test/claims-lint.test.ts`;
- one line in `src/app/robots.ts`.

**Evidence:** this doc, plus screenshots in `docs/trading-agent/stages/26-website/`.

**DB / API:** none.

## Inspection and STOP evaluation

> STOP if: copy implies partnership/approval not evidenced.

**Not triggered.**
- **New copy:** it names Binance, Upstox and Alpaca only to describe compatibility work. Every page carries the approved "Independence" note: *not affiliated with, endorsed by or a partner of any of them, and no broker, exchange or regulator has reviewed or approved Satelink*. The claims lint bans partnership and approval wording everywhere else.
- **Existing live copy:** I ran the same partnership rule over all of `(marketing)`, `src/lib` and `src/content` in report-only mode. Every hit was a false positive: "MIT-licensed x402-kit", "tutorials backed by live endpoints", "the official … SDK" (Satelink's own SDK), and "regulated payment value" (the card-vs-crypto lane rule). This matches audit 03 §6.2: no partnership claims.

**Framework:** Next.js 15 app router.
- The `(marketing)` layout supplies the CMS-driven header and footer. The existing `test/truth-lint.test.ts` already scans `(marketing)`, so it covers the new pages too.
- The flag pattern copies `TASKS_PRODUCT_ENABLED` (a server-only env, `notFound()` when off).

**Live pages are untouched.** `/`, `/pricing`, `/security`, `/status`, `/docs` and `/login` already exist and describe the live RPC / x402 / Trading Intelligence products (founder decision, Option 1: the live product stays). The Trading Agent pages therefore live under **`/trading-agent/*`** rather than replacing them.

**Legal:** no legal text is written. "Risk disclosure" (on Risk) and "Trading Agent terms" (on Pricing) are **RPrC placeholders**: *requires professional (legal) review before publication*, intentionally empty.

## Pages

| Brief page | Route | Content |
|---|---|---|
| HOME | `/trading-agent` | what it is in three points: you stay in control; money stays with your broker; every decision has a receipt |
| PRODUCT | `/trading-agent/product` | "It is" / "It is not" (not a fund, not advice, can't send orders alone, **not available yet**) |
| HOW IT WORKS | `/trading-agent/how-it-works` | 6 steps (rules → signed limits → suggest → checks → approve, sent once → receipt), plus one **Hypothetical example** block |
| BROKERS | `/trading-agent/brokers` | read from the status config: environment, how orders work, state label, next step |
| AI | `/trading-agent/ai` | **AI disclosure** (third-party models, can be wrong, read and suggest only) and an allowed/never table |
| RISK | `/trading-agent/risk` | controls (signed limits, stop switch, fail-closed checks, paper first) + RPrC risk-disclosure placeholder |
| PRICING | `/trading-agent/pricing` | **no price exists**; nobody can be charged while it's in development + RPrC terms placeholder |
| SECURITY | `/trading-agent/security` | trade-only keys, codes for sensitive steps, secrets server-side, one-time request keys |
| DOCUMENTATION | `/trading-agent/docs` | API not public yet; links to the explanatory pages |
| STATUS | `/trading-agent/status` | platform switches + broker states from the **same config**; uptime stays on the main `/status` |
| LOGIN | `/trading-agent/login` | link to the console sign-in; says the agent isn't switched on for any account |

Every page also shows "in development, not available to the public; live trading off", plus "Not investment advice" and "Independence".

## Broker status: one config, a state machine

`src/lib/trading-agent/status.ts`.

**Stages:** `not_started → implemented → tested → sandbox_verified → pilot → live`. Each stage lists the evidence it needs:

| Stage | Needs everything before it, plus |
|---|---|
| `implemented` | code |
| `tested` | tests |
| `sandbox_verified` | a sandbox run |
| `pilot` | broker agreement, legal review, live trading unlocked |
| `live` | a completed pilot |

**Rules:**
- `canAdvance` allows only one step forward, and only with that evidence.
- `stageIsEvidenced` checks that the config claims no more than it shows.
- Public wording comes **only** from `stageLabel(stage)`; only `live` reads as "Available".

**Today:** all three connectors are `tested` (Stages 21–23). The next step for each is its sandbox or testnet run with founder credentials. `PLATFORM.liveTradingLocked = true` makes `pilot` and `live` unreachable.

## Claims lint (acceptance: green)

`scripts/claims-lint.mjs` walks the **TypeScript AST** of every page, component and copy module. It checks only rendered copy (string literals, template text, JSX text). Imports, type positions, non-copy attributes (`className`, `href`, `id` …), object keys, lookups and comparisons are excluded, and the four approved disclaimer sentences are exempt word for word.

| Rule | Bans |
|---|---|
| PARTNERSHIP | partner(s/ed/ship), affiliate(d), endorse(d), approved by, approval from a regulator, certified, licensed, regulated, official, backed by, trusted by, in collaboration with, integrated with, as seen in, SEBI, FINRA |
| PERFORMANCE | returns, profit(able), gains, earn(ings), income, yield, APY, ROI, win rate, beat the market, outperform, alpha, guarantee(d), risk-free, passive, get rich, signals to buy/sell/trade/profit |
| AVAILABILITY | available now/today, now available, start trading, trade now, sign up to trade, join now, live trading is on, get started |
| AI_OVERCLAIM | predicts the market/prices, never wrong/loses, autonomous trading, fully automated, AI-powered profits/returns/trading, smart money |
| UNLABELLED_NUMBER | a `%` figure, a currency amount, or an amount in USDT/USD/INR/USDC **outside** a `<Hypothetical>` element (decided from the JSX tree) |
| LEGAL_WITHOUT_REVIEW | a legal placeholder component not marked RPrC |

**Result:** 16 files, **0 findings** (`npm run lint:claims`).

**Scope:** the lint covers only the Trading Agent surfaces. The existing `truth-lint.test.ts` keeps guarding all of `(marketing)`, `(checkout)` and `console`. Applying the partnership rule site-wide would flag the compliant "MIT-licensed" and "official SDK" phrases above.

**CI:** CI's test job runs `npm test` → `turbo test --filter=web` → vitest, which includes `test/claims-lint.test.ts`. **However, that CI step pipes into `| tail -20` without `pipefail`, so a failing web test does not fail CI today.** This is the masked-steps problem under **B-10**. Unmasking it is a CI change that needs founder approval (register open question), and CI workflows are outside this stage's allowed paths. Until then, `npm run lint:claims` exits non-zero on any finding, and is suitable for a dedicated CI step once approved.

## Test evidence (2026-10-06)

| Check | Result |
|---|---|
| `test/claims-lint.test.ts` | **26 passing**: lint green on all pages; 15 seeded violations each caught (partner, SEBI approval, integrated/trusted by, backed by, earn returns, profitable, guaranteed/risk-free, alpha, start trading, available now, AI predicts, fully automated, unlabelled %, $, USDT); no false positives on code, class names, links, disclaimers or labelled hypotheticals; RPrC enforced; disclaimer content; state machine (evidenced, ≤ sandbox_verified while locked, forward one step with evidence, only `live` = available, requirements only grow); flag off by default; every page gated + noindex; robots disallow; not in sitemap; AI disclosure; advice / independence / not-available notes; RPrC placeholders on Risk and Pricing; Brokers and Status read the config |
| Full `apps/web` vitest | **18 files, 144 passing** (includes the existing truth-lint, which now also scans these pages) |
| Mutation checks (13) | all caught: partnership rule dropped, numbers allowed everywhere, Hypothetical scope leaking, JSX text not scanned, RPrC check removed, Binance claimed `live`, `tested` reading "Available", flag default on, a page gate removed, robots line removed, and three copy regressions ("our partner broker", "a way to earn more", an unlabelled "30,000 USDT a month") |
| Rendering (`next dev`) | flag on: all 11 pages **200**, noindex, both disclaimers, RPrC on Risk and Pricing; phone (360 px) has no horizontal scroll. Flag off: every `/trading-agent/*` **404**; live `/pricing` 200 |
| `tsc` | no errors in the new files (64 errors exist elsewhere in `apps/web`, e.g. `(builder)` `DashboardSection`, unrelated; CI pipes `tsc` through `head`) |
| `next build` in this worktree | **fails on many unrelated existing pages too** (`/404`, `/products/rpc`, `/developers/api`, `/changelog/*` …) with the Next.js `workUnitAsyncStorage` invariant. The worktree's `node_modules` is a symlink to the main checkout (Next warns about multiple lockfiles / the inferred workspace root). It is not caused by this stage, and is reported rather than worked around. The pages were verified with `next dev` instead |

**Screenshots** (`docs/trading-agent/stages/26-website/`, rendered with `next dev`, so the Next.js dev badge is visible):
- `01-home.png`, `02-how-it-works.png`, `03-brokers.png`, `04-ai.png`;
- `05-risk.png`, `06-status.png`, `07-brokers-phone.png`.

## Blocker impact

| Blocker | Touched? | Why the stage stays inside the accepted isolation |
|---|---|---|
| B-09 (scope / legal) | yes, **not resolved** | copy makes no partnership, approval, performance or availability claim; legal sections are RPrC placeholders; publishing needs the founder/legal review |
| B-10 (CI) | yes, **not resolved** | the claims lint runs in CI's test job, but that job's failure is masked (`\| tail`); unmasking is a founder-approved CI change |
| B-06 (no staging) | no | flag off; nothing deployed (the PR targets the integration chain, not `main`) |
| others | no | |

No blocker changes status. The Stage 26 row is added to the acceptance log in `docs/trading-agent/BLOCKERS.md`.

## Follow-ups (not in this stage)

- **Legal review (RPrC):** risk disclosure and Trading Agent terms. Publish only after professional review.
- **B-10:** unmask the CI test step (or add a `npm run lint:claims` step) so a claims finding fails CI.
- **Before turning `SITE_TRADING_AGENT` on:** legal review; update the connector config as evidence arrives (sandbox runs); decide navigation (still unlinked from the live menus).
- **Audit 03 items** still open: the public "Network (run a node)" link and `/node*`, and the earnings claims C1–C6.
- **`next build` in worktrees:** use a real install (not a symlinked `node_modules`) to get a clean production build.

## Rollback

Flag off (the default): every page is a 404. Or revert the commit; no live page changed except one robots disallow line.
