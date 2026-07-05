# Satelink erpc Provider Adapter

Native [erpc](https://github.com/erpc/erpc) vendor for the Satelink RPC
gateway, adding a `satelink://` upstream URL scheme so erpc users can route
Polygon PoS (chainId 137) traffic through Satelink with one config line.

This directory is the staging area for the upstream contribution:

| File | Purpose |
|---|---|
| `satelink_provider.go` | The vendor implementation, to land as `thirdparty/satelink.go` in erpc (pattern: erpc PR #861, Blockdaemon) |
| `satelink.yaml` | Example erpc config using the `satelink://` scheme |
| `ERPC_PR_BODY.md` | Ready-to-submit PR description for the erpc repo |

## What the adapter does

- Registers a `satelink` vendor in erpc's provider registry.
- Translates `satelink://<api_key>@polygon` into the HTTPS endpoint
  `https://rpc.satelink.network/rpc/polygon` and injects the key as the
  `X-API-Key` header. `satelink://free@polygon` (or an empty key) selects the
  keyless free tier — no header is sent.
- All JSON-RPC methods pass through unmodified (`eth_blockNumber`, `eth_call`,
  `eth_getLogs`, `eth_getTransactionReceipt`, `eth_sendRawTransaction`,
  `eth_getBalance`, `eth_getCode`, …).
- Maps Satelink's HTTP errors to erpc's typed errors:
  - **402** (credits exhausted) → `ErrEndpointBillingIssue`, with the payment
    manifest URL, vault address, token address, chain id, and deposit-calldata
    URL attached to the error metadata so the operator can fund and resume.
  - **429** (free-tier daily limit) → `ErrEndpointCapacityExceeded`.
  - **401** (unknown key) → `ErrEndpointUnauthorized`.

## Pricing

- **Free tier:** 500 calls/day per IP — no key, no registration.
- **Paid tier:** $0.00003 per call, prepaid USDT credits, no minimums beyond
  the 0.50 USDT minimum deposit. Live pricing:
  <https://rpc.satelink.network/v1/pricing>

## Getting an API key

Registration is autonomous — no email, no dashboard:

```bash
# 1. Ask for the exact message to sign (POST without a signature):
curl -X POST https://rpc.satelink.network/v1/machine/register \
  -H 'Content-Type: application/json' \
  -d '{"wallet_address":"0xYOURWALLET"}'

# 2. EIP-191 personal_sign "satelink:register:<lowercase wallet>" and repeat
#    with the signature — the response contains your api_key (sk_…).
```

## Funding credits

Deposit USDT (Polygon, `0xc2132D05D31c914a87C6611C10748AEb04B58e8F`) to the
RevenueVault `0x577D3716d6Ad5b676d230f5409deF9838FABaCEF` from your registered
wallet. Ready-to-sign approve + deposit calldata for any amount:

```bash
curl 'https://rpc.satelink.network/credits/deposit/initiate?amount=1.00'
```

Credits appear automatically ~5 minutes after the deposit reaches
25 confirmations. Check balance:

```bash
curl https://rpc.satelink.network/api/keys/usage -H 'X-API-Key: sk_...'
```

## Configuring erpc

```yaml
projects:
  - id: my-project
    networks:
      - architecture: evm
        evm:
          chainId: 137
    upstreams:
      - id: satelink-polygon
        endpoint: satelink://sk_YOUR_API_KEY@polygon
        # Free tier:
        # endpoint: satelink://free@polygon
```

Until the native vendor ships in an erpc release, Satelink works today as a
plain HTTP upstream:

```yaml
      - id: satelink-polygon
        endpoint: https://rpc.satelink.network/rpc/polygon
```

(headers for the paid tier: `X-API-Key: sk_…` via `jsonRpc.headers`).

## What happens on credit exhaustion

The gateway returns **402** with a fully self-contained machine-readable body:
JSON-RPC `error.code -32005` plus top-level `deposit.vault_address`,
`deposit.usdt_contract`, `deposit.chain_id`, `deposit.calldata_url`,
`register.url`, and `manifest_url`. Deposit more USDT to the vault from the
registered wallet and calls resume automatically — no support ticket, no
manual credit step. The adapter surfaces these pointers in erpc's error
metadata.

## Machine-readable discovery

Everything above is published for automated integration at:
<https://rpc.satelink.network/.well-known/satelink.json>
