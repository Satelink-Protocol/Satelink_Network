# PR: feat: add Satelink third-party provider

> Submit at: https://github.com/erpc/erpc/compare — base `erpc:main`, from a
> fork branch containing `thirdparty/satelink.go` (this repo's
> `docs/erpc-adapter/satelink_provider.go`), the `vendors_registry.go`
> registration line, the `common/defaults.go` `buildProviderSettings` case,
> a `thirdparty/satelink_test.go`, and a providers.mdx docs entry — the same
> file set as #861.

---

## Summary

- Adds `SatelinkVendor` to `thirdparty/` — implements `SupportsNetwork`,
  `GenerateConfigs`, `GetVendorSpecificErrorIfAny`, and `OwnsUpstream`
  (same shape as the Blockdaemon vendor in #861)
- Registers the vendor in `thirdparty/vendors_registry.go` and adds the
  `satelink` case to `buildProviderSettings` in `common/defaults.go`
- Adds a configuration example to `docs/pages/config/projects/providers.mdx`
- Follow-up to #960, where we introduced the endpoint and offered this adapter

## What Satelink is

[Satelink](https://rpc.satelink.network/.well-known/satelink.json) is a
fault-tolerant Polygon PoS (chainId 137) RPC gateway: 16 upstream providers
behind latency-sorted routing with EMA weighting and 3-state circuit-breaker
failover. It has a keyless free tier (500 calls/day per IP) and a prepaid
paid tier ($0.00003/call, settled in USDT on Polygon) with fully autonomous
machine onboarding — registration, funding, and key issuance are all API-only,
no dashboard or human step. We already see erpc instances routing through the
plain HTTPS endpoint; this PR makes it a first-class provider.

## What this PR adds

**URL scheme** (`satelink://…`):

| Endpoint | Meaning |
|---|---|
| `satelink://<api_key>@polygon` | Paid tier — key sent as `X-API-Key` header |
| `satelink://free@polygon` | Keyless free tier (500 calls/day per IP) |

**Supported networks**

| Chain | ID | Resolved endpoint |
|---|---|---|
| Polygon PoS mainnet | 137 | `https://rpc.satelink.network/rpc/polygon` |

**Error mapping**

| Gateway response | erpc error |
|---|---|
| 402 credits exhausted | `ErrEndpointBillingIssue` — payment manifest URL, USDT vault address, chain id, and deposit-calldata URL attached to error details so operators can fund and resume |
| 429 free-tier daily limit | `ErrEndpointCapacityExceeded` |
| 401 unknown key | `ErrEndpointUnauthorized` |

Satelink's 402 body is itself machine-readable (JSON-RPC `error.code -32005`
plus `deposit.vault_address` / `deposit.calldata_url` / `register.url`), so an
automated payer can recover without external docs.

## Configuration example

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

## Machine-readable discovery

The full provider surface (pricing, payment token/vault, registration flow,
error contract) is published at
`https://rpc.satelink.network/.well-known/satelink.json` for programmatic
registration.

## Test evidence (live endpoint, 2026-07-05)

```console
$ curl -s -X POST https://rpc.satelink.network/rpc/polygon \
    -H "Content-Type: application/json" \
    -H "X-API-Key: sk_free_…" \
    -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'
{"id":1,"jsonrpc":"2.0","result":"0x558d852"}

$ curl -s … -d '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":3}'
{"jsonrpc":"2.0","result":"0x89","id":3}

$ curl -s … -d '{"jsonrpc":"2.0","method":"eth_getBalance","params":["0x966E1Ae22996545015b1414B35234b10719d7Ad4","latest"],"id":2}'
{"jsonrpc":"2.0","id":2,"result":"0x32c8b3b6c83a29b"}

$ curl -s … -d '{"jsonrpc":"2.0","method":"eth_call","params":[{"to":"0xc2132D05D31c914a87C6611C10748AEb04B58e8F","data":"0x95d89b41"},"latest"],"id":4}'
{"jsonrpc":"2.0","id":4,"result":"0x…5553445430000…"}   # "USDT"
```

Anonymous (free-tier, no key) requests also return 200 until the daily limit.

## Test plan

- [ ] `go test ./thirdparty/ -run TestSatelink` passes
- [ ] Configure a Satelink upstream in `erpc.yaml` with a real API key and
      verify requests route correctly
- [ ] Verify `satelink://free@polygon` sends no `X-API-Key` header
- [ ] Verify a 402 from the gateway surfaces `ErrEndpointBillingIssue` with
      payment metadata in details
