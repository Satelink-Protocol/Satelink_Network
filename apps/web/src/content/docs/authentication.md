Satelink has three ways to identify a caller, in increasing order of
capability. None of them require a password or an email.

## 1. Anonymous (free tier)

No credentials at all. The gateway meters by source IP: **500 calls/day per
IP**, also capped per /24 subnet. Exceeding the limit returns HTTP 402 with
machine-readable onboarding instructions.

## 2. API key

Create a key with one HTTP call (see [Quick Start](/docs/quick-start)) and
send it on every request:

```
X-API-Key: sk_free_...
```

Keys are the billing identity: usage, spend, and credit balance attach to the
key. The full key string is shown once at creation and stored hashed.

## 3. Wallet-bound key (MetaMask sign-to-create)

In the [developer console](/satelink/os/keys), connect MetaMask and sign a
single message — no transaction, no gas. This creates an API key bound to
your wallet address, which means:

- **USDT deposits from that wallet credit your key automatically.** The
  deposit listener matches the sending address on-chain.
- The console warns you before depositing from a wallet that doesn't match a
  registered key, and blocks deposits from the wrong network (anything other
  than Polygon PoS 137).

## Machine identity (HTTP 402)

Autonomous machines register through `POST /v1/machine/register` — typically
driven by the self-contained HTTP 402 response body they receive when
unauthenticated. The body includes the registration endpoint, deposit
calldata, the real minimum deposit, and working example requests. Details:
[Machine Customers](/docs/machine-customers).

## What we never ask for

- No passwords, no OAuth, no KYC for API usage.
- Your wallet's private keys never leave your wallet — key binding uses a
  signature, deposits are transactions you send yourself.
