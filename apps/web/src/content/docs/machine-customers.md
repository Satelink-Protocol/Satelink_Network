Satelink is built so that a machine — an AI agent, a bot, a service — can
become a paying customer **without a human ever touching a dashboard**. The
mechanism is the HTTP `402 Payment Required` status code, used the way it was
always meant to be used.

## The 402 flow

1. **A machine calls the gateway anonymously** and eventually exhausts the
   free tier (500 calls/day per IP).
2. **The gateway answers 402** — and the response body is self-contained
   machine-readable onboarding:
   - the registration endpoint (`POST /v1/machine/register`),
   - the calldata endpoint for a USDT deposit (`GET /credits/initiate`),
   - the **real minimum deposit** (not a marketing number),
   - working example requests it can copy verbatim.
3. **The machine registers**, receives an API key, and has its operator
   wallet send USDT to the RevenueVault on Polygon PoS.
4. **The deposit listener** watches the chain; after ~25 confirmations the
   machine's balance is credited and its calls are metered at $0.00003 each.

No email. No credit card. No OAuth dance. The entire loop is HTTP + one
on-chain transfer.

## Try it

Exhaust the free tier (or just inspect a 402):

```bash
curl -i -X POST https://rpc.satelink.network/rpc \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'
```

Register a machine directly:

```bash
curl -X POST https://rpc.satelink.network/v1/machine/register \
  -H "Content-Type: application/json" \
  -d '{"label":"my-agent"}'
```

## Why this matters

Most infrastructure billing assumes a human with a browser and a credit card.
Autonomous agents can't do that. Satelink's answer: make the *error response
itself* the onboarding funnel, and make payment a plain ERC-20 transfer that
any wallet-holding agent can execute. This is the foundation for the machine
economy milestones on the [Roadmap](/docs/roadmap) — the first fully
autonomous machine-to-machine payment is an explicit target, honestly labeled
as not yet achieved.
