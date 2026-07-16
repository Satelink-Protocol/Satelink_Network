# satelink-mcp

Give any AI agent **pay-per-call Polygon (chain 137) JSON-RPC** access through [Satelink](https://satelink.network) — a permissionless DePIN RPC network.

- **Free tier:** first 500 calls/day per network, no wallet, no email.
- **Then micropayments:** register a machine wallet and deposit USDT on Polygon, or pay per bundle via x402 (USDC on Base). No subscription, no commitment.
- **No API key required to start** — the free tier works out of the box.

## Install

Run directly with `npx` (no global install needed):

```bash
npx satelink-mcp
```

## Use with an MCP client

### Claude Desktop / Claude Code / Cursor

Add to your MCP config (e.g. `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "satelink": {
      "command": "npx",
      "args": ["-y", "satelink-mcp"]
    }
  }
}
```

To use a paid API key for higher limits, set it in the environment:

```json
{
  "mcpServers": {
    "satelink": {
      "command": "npx",
      "args": ["-y", "satelink-mcp"],
      "env": { "SATELINK_API_KEY": "sk_..." }
    }
  }
}
```

## Tools

### `satelink_rpc_call`
Send any JSON-RPC method to Satelink's Polygon RPC.

| Field | Required | Description |
|-------|----------|-------------|
| `method` | yes | JSON-RPC method, e.g. `eth_call`, `eth_getBalance`, `eth_blockNumber` |
| `params` | yes | Array of params for the method |
| `api_key` | no | Satelink API key for higher limits (free tier works without one) |

On `402 Payment Required`, the response includes exact instructions to register a free machine key or deposit to continue.

### `satelink_register_machine`
Register a wallet to receive an API key (and enable deposits that auto-credit).

| Field | Required | Description |
|-------|----------|-------------|
| `wallet_address` | yes | Your `0x`-prefixed wallet address |
| `signature` | yes | EIP-191 `personal_sign` of `satelink:register:<lowercase_wallet_address>` |

## Configuration

| Env var | Default |
|---------|---------|
| `SATELINK_RPC_URL` | `https://rpc.satelink.network/rpc/polygon` |
| `SATELINK_API_URL` | `https://rpc.satelink.network/v1/machine/register` |

## Links

- Website: https://satelink.network
- Docs: https://satelink.network/docs

## License

MIT
