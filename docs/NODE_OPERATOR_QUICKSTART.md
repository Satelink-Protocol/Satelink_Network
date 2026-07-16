> ⚠️ **STALE (marked 2026-07-16):** references contract `0x6987…1CC9`, which was never the production contract (purged from the site in PR #237). Current deposit vault: RevenueVaultV2 `0x577D3716d6Ad5b676d230f5409deF9838FABaCEF`. Verify against CLAUDE.md before trusting anything below.

# Run a Satelink Node — Quick Start

Earn USDT by routing RPC traffic through your server.

## What You Need

| Requirement | Minimum |
|-------------|---------|
| CPU | 2 cores |
| RAM | 2 GB |
| Storage | 20 GB SSD |
| OS | Ubuntu 20.04+ or Debian 11+ |
| Network | Port 8080 open, static IP recommended |
| Wallet | Polygon address (to receive USDT) |

## Earning Potential

- **Revenue split**: Node operators receive 50% of all RPC revenue
- **Current rate**: ~$0.000030 per RPC call
- **Example**: A node handling 1M calls/day earns ~$15/day
- **Payment**: USDT on Polygon, claimed on-chain

## Verified Payment

The Satelink smart contracts are open source:
- [SplitEngine.sol](https://polygonscan.com/address/0x8a9CefBD801574806a634aF179f538ABB5926F5a) — Revenue distribution
- [ClaimsContract.sol](https://polygonscan.com/address/0x6987921e2453f360e314e4424F6c2789F10a1CC9) — Withdrawal claims

Revenue distribution is enforced on-chain — no trust required.

---

## Setup (5 minutes)

### Option A: CLI Install (Recommended)

```bash
# 1. Install Node.js 20+ if not present
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# 2. Install the Satelink node agent
npm install -g @satelink/node-agent

# 3. Register your node
satelink-node register \
  --wallet 0xYOUR_POLYGON_WALLET \
  --region us-east-1

# 4. Start the node
satelink-node start
```

### Option B: Docker

```bash
docker run -d \
  --name satelink-node \
  --restart unless-stopped \
  -e WALLET_ADDRESS=0xYOUR_POLYGON_WALLET \
  -e NODE_REGION=us-east-1 \
  -e NODE_TYPE=rpc \
  -p 8080:8080 \
  satelinknetwork/node-agent:latest
```

### Option C: Manual Registration

If you're running your own RPC proxy:

```bash
curl -X POST https://rpc.satelink.network/nodes/register \
  -H "Content-Type: application/json" \
  -d '{
    "wallet_address": "0xYOUR_POLYGON_WALLET",
    "node_type": "rpc",
    "endpoint_url": "http://YOUR_SERVER_IP:8080",
    "region": "us-east-1",
    "chain_ids": [137, 1, 42161]
  }'
```

Your endpoint must respond to `/health` with HTTP 200.

---

## Verify Registration

```bash
satelink-node status
```

Expected output:
```
Satelink Node Status
--------------------
Node ID:      NODE-us-east-1-a1b2c3d4
Wallet:       0x1234...5678
Region:       us-east-1
Status:       active
```

Or check via API:
```bash
curl https://rpc.satelink.network/nodes/NODE-us-east-1-YOUR_ID
```

---

## Region Codes

| Region | Code |
|--------|------|
| US East | `us-east-1` |
| EU West | `eu-west-1` |
| Asia Pacific (Mumbai) | `ap-south-1` |
| Asia Pacific (Singapore) | `ap-southeast-1` |

---

## Track Your Earnings

1. Go to [satelink.network/dashboard](https://satelink.network/dashboard)
2. Select "Node Operator"
3. Enter your node ID
4. View earnings, reputation score, and claim history

---

## Heartbeat & Uptime

Your node must send heartbeats every 2 minutes to remain active:
- The CLI agent handles this automatically
- If heartbeats stop for 5+ minutes, status changes to `offline`
- Offline nodes don't receive workloads or earn revenue

---

## Reputation System

| Tier | Score | Benefit |
|------|-------|---------|
| Bronze | 0-250 | Base rate |
| Silver | 251-500 | +10% earnings |
| Gold | 501-750 | +20% earnings |
| Platinum | 751-1000 | +30% earnings, priority routing |

Reputation increases with:
- Consistent uptime
- Low latency responses
- High RPC call volume

Reputation decreases with:
- Missed heartbeats
- Downtime events
- SLA violations

---

## Troubleshooting

### "Endpoint unreachable"
- Ensure your server is accessible from the internet
- Check that port 8080 is open in your firewall
- Verify `/health` endpoint returns HTTP 200

### "Node not found"
- Check your node ID is correct
- Run `satelink-node status` to get your node ID

### Node shows "offline"
- Ensure the agent is running: `satelink-node start`
- Check logs: `journalctl -u satelink-node` (if using systemd)

---

## Support

- **Discord**: [discord.gg/satelink](https://discord.gg/satelink)
- **Docs**: [docs.satelink.network](https://docs.satelink.network)
- **GitHub**: [github.com/Satelink-Protocol](https://github.com/Satelink-Protocol)

---

## Hardware Recommendations (Optional)

For high-volume operators:

| Tier | Specs | Expected Volume |
|------|-------|-----------------|
| Basic | 2 CPU / 2GB RAM | ~100K calls/day |
| Standard | 4 CPU / 4GB RAM | ~500K calls/day |
| Pro | 8 CPU / 8GB RAM | ~2M calls/day |

---

*Last updated: May 2026*