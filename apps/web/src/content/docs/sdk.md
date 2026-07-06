The official JavaScript/TypeScript SDK is published on npm as
[`@satelink/sdk`](https://www.npmjs.com/package/@satelink/sdk) (currently
v0.2.x) and developed in the open in the
[monorepo](https://github.com/Satelink-Protocol/Satelink_Network) under
`packages/sdk`.

## Install

```bash
npm install @satelink/sdk
```

## First call

```js
import { Satelink } from "@satelink/sdk";

const satelink = new Satelink("YOUR_API_KEY");

const block = await satelink.rpc.polygon.eth_blockNumber();
console.log("Current block:", block);
```

The SDK wraps the metered gateway — the same $0.00003/call economics as raw
HTTP, with typed helpers per chain.

## Raw HTTP is always available

The SDK is a convenience, not a requirement. Everything it does maps to the
public [API Reference](/docs/api-reference); any HTTP client in any language
works:

```python
import requests

r = requests.post(
    "https://rpc.satelink.network/rpc",
    headers={"X-API-Key": "YOUR_API_KEY"},
    json={"jsonrpc": "2.0", "method": "eth_blockNumber", "params": [], "id": 1},
)
print(r.json())
```

## Versioning

The SDK follows semver. Pre-1.0, minor versions may contain breaking changes —
pin the version in production and read the
[Changelog](/docs/changelog) before upgrading.
