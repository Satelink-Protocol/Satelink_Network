## How the platform itself deploys

For contributors and the curious — the production pipeline is deliberately
boring:

- **Everything deploys by merging to `main`** on
  [GitHub](https://github.com/Satelink-Protocol/Satelink_Network).
- The API (Node.js/Express monolith) auto-deploys to Railway; the web app
  (Next.js) auto-deploys to Vercel.
- There are no manual deploy commands in the loop; restarting a service never
  ships new code.
- Database: PostgreSQL + Redis (Railway-managed). Contracts: Solidity/Foundry
  on Polygon PoS.

## Domains

| Domain | Serves |
|---|---|
| satelink.network | Marketing site + developer console |
| rpc.satelink.network / api.satelink.network | The gateway API |
| docs.satelink.network | This documentation portal |
| status.satelink.network | Public status page |
| node.satelink.network | Node operator portal |

## Deploying a node (operators)

Node onboarding is guided end-to-end in the
[node portal](https://satelink.network/node/setup): provision a VPS (2 GB
RAM, 50 GB disk, public IP), run the edge agent, and register via
`POST /api/nodes/register`. Requirements and economics:
[Node Operators](/docs/node-operators).

## Self-hosting the stack

The codebase is public and the architecture is documented
([Architecture](/docs/architecture)), but we don't yet publish a supported
one-command self-host path — the settlement layer is coupled to the
production vault and signer. If you're experimenting from source, treat it
as unsupported territory and never point a local instance at production
infrastructure.
