# satelink-mcp

Give any AI agent **pay-per-call Polygon (chain 137) JSON-RPC** through [Satelink](https://satelink.network) — settled automatically over **x402** (USDC on Base). One tool, no account, no subscription.

- **Free tier:** the first calls each day are free — no wallet, no email.
- **Then micropayments:** configure a Base-funded USDC wallet and the server pays for you the moment the free tier is exhausted. `$0.10` buys a **1,000-call bundle**; subsequent calls draw it down with no new payment.
- **Reuses the production rail end-to-end.** This server is an x402 *client* of the already-deployed Satelink RPC endpoint. Payment verification, on-chain settlement, and revenue recording all happen server-side in production — nothing is re-implemented here.

## What was missing before v2

v1 forwarded requests to Satelink's x402-enabled `/rpc/polygon` but **never signed a payment** — a `402` was only shown to the agent as text, so an external paid call could never actually complete. v2 closes that loop: [`src/pay.mjs`](./src/pay.mjs) wraps `fetch` with [`@x402/fetch`](https://www.npmjs.com/package/@x402/fetch), signs the USDC-on-Base authorization on a `402`, and retries. That is the entire delta.

## Install / run

```bash
# stdio (for MCP clients like Claude Desktop / Cursor)
npx satelink-mcp

# HTTP (POST /execute + POST /mcp), default port 8402
npx -p satelink-mcp satelink-mcp-http
```

## Enable automatic payment

Set one env var — the `0x` private key of a wallet holding **USDC on Base**:

```bash
export SATELINK_WALLET_PRIVATE_KEY=0xYOUR_BASE_FUNDED_WALLET
```

> ⚠️ Use a wallet you control that is **not** a Satelink/founder wallet. Founder-funded payers are ledger-flagged `is_test_data` and do not count as external revenue.

Without a wallet the server still runs — it serves the free tier and surfaces the `402` payment requirements when the free tier is exhausted.

## Use with an MCP client (Claude Desktop / Cursor / Claude Code)

```json
{
  "mcpServers": {
    "satelink": {
      "command": "npx",
      "args": ["-y", "satelink-mcp"],
      "env": { "SATELINK_WALLET_PRIVATE_KEY": "0x..." }
    }
  }
}
```

## The tool — `polygon_rpc`

| Field | Required | Description |
|-------|----------|-------------|
| `method` | yes | JSON-RPC method, e.g. `eth_blockNumber`, `eth_getBalance`, `eth_call` |
| `params` | no | Array of params (default `[]`) |

Also exposes `resources/list` (`satelink://pricing`) and `prompts/list` (`check_wallet_balance`).

## HTTP: `POST /execute`

```bash
curl -s -X POST http://localhost:8402/execute \
  -H 'Content-Type: application/json' \
  -d '{"method":"eth_blockNumber","params":[]}'
```

Response (paid call):

```json
{
  "ok": true,
  "status": 200,
  "result": { "jsonrpc": "2.0", "id": 1, "result": "0x568004a" },
  "paid": true,
  "payment_response": "<x402 settlement>",
  "credited": { "wallet": "0x...", "calls_remaining": 999 }
}
```

Other routes: `GET /healthz`, `GET /.well-known/mcp.json`, `POST /mcp` (MCP Streamable HTTP).

## Configuration

| Env var | Default |
|---------|---------|
| `SATELINK_WALLET_PRIVATE_KEY` | *(none — free tier only)* |
| `SATELINK_RPC_URL` | `https://rpc.satelink.network/rpc/polygon` |
| `SATELINK_API_KEY` | *(optional — higher free-tier limits)* |
| `PORT` | `8402` (HTTP server) |

## How to verify the first paid call

1. Fund a fresh Base wallet with a little USDC (a few cents is enough for one `$0.10` bundle).
2. Run the demo (talks to the exact code path the MCP tool uses):
   ```bash
   SATELINK_WALLET_PRIVATE_KEY=0x... node client-example.mjs
   ```
   It calls `eth_blockNumber` until production returns `402`, at which point the payment is signed and settled. On success it prints the **settlement tx hash** and **calls remaining**.
3. Confirm the revenue was recorded server-side:
   - Ledger: a `revenue_events_v2` row with `demand_source = 'x402'`, `is_test_data = false`, `request_id = 'x402:<txHash>'`.
   - On-chain: the USDC transfer to the Satelink treasury `0x966E1Ae22996545015b1414B35234b10719d7Ad4` on Base ([basescan](https://basescan.org/address/0x966E1Ae22996545015b1414B35234b10719d7Ad4)).

Success is exactly this: an external wallet paid, the tool executed, and a non-test revenue event was recorded.

## Deployment

Docker (self-contained — no DB/contracts/facilitator creds needed):

```bash
docker build -f apps/mcp-server/Dockerfile -t satelink-mcp .
docker run -p 8402:8402 -e SATELINK_WALLET_PRIVATE_KEY=0x... satelink-mcp
```

Publish the stdio package for public discovery:

```bash
cd apps/mcp-server && npm publish --access public
```

## Links

- Website: https://satelink.network
- x402: https://www.x402.org

## License

MIT
