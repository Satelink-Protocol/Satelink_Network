Practical guidance for integrating Satelink into an application.

## Choose your integration

1. **Raw HTTP** — any language, no dependency. See the
   [API Reference](/docs/api-reference).
2. **`@satelink/sdk`** — typed JS/TS client. See [SDK](/docs/sdk).

## Keys and environments

- Create one key per environment (`my-app-dev`, `my-app-prod`) so usage and
  spend are separable. Keys are free.
- Store keys in environment variables. The full key is shown only once at
  creation.
- Prefer the wallet-bound flow (MetaMask sign-to-create in the
  [console](/satelink/os/keys)) for production keys — deposits from your
  wallet then credit the right account automatically.

## Handle the two billing statuses

```text
402 Payment Required  → free tier exhausted or zero credits.
                        The body contains exact remediation steps + calldata.
429 Too Many Requests → abuse limiter for automated non-developer traffic.
                        Honor Retry-After.
```

Treat 402 as a signal to top up (or to run the machine onboarding flow), not
as an outage.

## Failover strategy

Satelink publishes measured uptime and per-provider health
(`/rpc/health`) instead of a contractual SLA. For critical production paths
during this stage of the network, configure Satelink as primary with a
fallback RPC provider — standard multi-provider hygiene.

## Monitor usage

- Per-key: `GET /api/keys/usage` (requests today, spend, credits remaining).
- Console: the [Usage Metering page](/satelink/os/usage) charts calls and
  spend per key per day.
- Set your own alerts on `credits_remaining` — at $0.00003/call, $1 of
  headroom is ≈ 33,333 calls.

## Cost planning

Flat rate means projections are one multiplication: expected monthly calls ×
$0.00003. One million calls = $30. The
[deposit console](/satelink/os/deposit) has a capacity estimator built in.
