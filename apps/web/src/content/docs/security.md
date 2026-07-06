## Responsible disclosure

**Do not open a public GitHub issue for security vulnerabilities.** Email
**security@satelink.network**. We acknowledge within 48 hours and triage
within 7 days. Include a description, reproduction steps, impact assessment,
and optionally a suggested fix.

### In scope

- Smart contracts (RevenueVault, node registry, settlement/claims contracts)
- The RPC gateway and its authentication/authorization
- Settlement and claims flows, epoch anchoring, Merkle verification
- The node edge agent

### Out of scope

- Social engineering and physical attacks
- Third-party dependencies (report upstream)
- Test/mock contracts
- Gas-limit denial of service

### Severity

| Level | Meaning |
|---|---|
| Critical | Direct loss of funds |
| High | Protocol disruption or access-control bypass |
| Medium | Limited or conditional impact |
| Low | Informational |

There is no formal bug bounty yet. We commit to safe harbor for good-faith
research.

## Platform security model

- **Non-custodial payments.** Deposits are plain ERC-20 transfers from your
  wallet to a verified vault contract. We never hold your private keys, and
  key binding uses a gas-free signature.
- **Secrets hygiene.** No secrets in the repository; configuration is
  environment-injected. Admin credentials never reach the browser — the
  frontend proxies admin calls server-side.
- **Financial safety gates.** On-chain settlement broadcasting sits behind
  multiple independent guards (funded signer, revenue threshold, explicit
  human enablement) and currently runs in dry-run mode.
- **Data integrity.** Test and phantom data are flagged at the row level and
  excluded from all reported revenue. Historical incidents and their fixes
  are documented, not hidden — see the incident history in the repository.

## Contact

- Security: **security@satelink.network**
- General: **satelinknetwork@gmail.com**
