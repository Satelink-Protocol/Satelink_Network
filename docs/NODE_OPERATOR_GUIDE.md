> ⚠️ **STALE (marked 2026-07-16):** references contract `0x6987…1CC9`, which was never the production contract (purged from the site in PR #237). Current deposit vault: RevenueVaultV2 `0x577D3716d6Ad5b676d230f5409deF9838FABaCEF`. Verify against CLAUDE.md before trusting anything below.

# Satelink Node Operator Guide

Earn USDT by routing RPC traffic through your server. This guide covers everything you need to register, run, and get paid as a Satelink node operator.

---

## Table of Contents

1. [Requirements](#1-requirements)
2. [Registration](#2-registration)
3. [Heartbeat](#3-heartbeat)
4. [Earnings](#4-earnings)
5. [Claims](#5-claims)
6. [Support](#6-support)

---

## 1. Requirements

| Item | Minimum |
|------|---------|
| CPU | 2 cores |
| RAM | 2 GB |
| Storage | 20 GB SSD |
| OS | Ubuntu 20.04+ or Debian 11+ |
| Runtime | Node.js 20+ |
| Network | Port 8080 open, static IP recommended |
| Wallet | Polygon address (to receive USDT) |

---

## 2. Registration

Choose the method that fits your setup.

### Option A: CLI (Recommended)

```bash
# Install Node.js 20+ if not present
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install the Satelink node agent
npm install -g @satelink/node-agent

# Register your node
satelink-node register \
  --wallet 0xYOUR_POLYGON_WALLET \
  --region us-east-1

# Start the node
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

### Option C: Manual API Registration

If you're running your own RPC proxy, register directly via the API:

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

**Response:**
```json
{
  "nodeId": "NODE-us-east-1-a1b2c3d4",
  "status": "registered"
}
```

Save the `nodeId` — you will need it for all subsequent API calls.

Your endpoint must respond to `/health` with HTTP 200.

### Verify Registration

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
curl https://rpc.satelink.network/nodes/NODE-YOUR-ID
```

### Region Codes

| Region | Code |
|--------|------|
| US East | `us-east-1` |
| EU West | `eu-west-1` |
| Asia Pacific (Mumbai) | `ap-south-1` |
| Asia Pacific (Singapore) | `ap-southeast-1` |

---

## 3. Heartbeat

Your node must send a heartbeat every **2 minutes** to remain active and eligible for earnings.

### Automated (CLI)

The CLI agent handles heartbeats automatically. No additional setup required once `satelink-node start` is running.

To run as a persistent service with systemd:

```bash
# Create a systemd service
sudo tee /etc/systemd/system/satelink-node.service > /dev/null <<EOF
[Unit]
Description=Satelink Node Agent
After=network.target

[Service]
ExecStart=/usr/bin/satelink-node start
Restart=always
RestartSec=10
User=$(whoami)

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable satelink-node
sudo systemctl start satelink-node
```

Check logs:
```bash
journalctl -u satelink-node -f
```

### Manual API Heartbeat

If you're managing your own integration, send heartbeats directly:

```
POST https://rpc.satelink.network/api/nodes/heartbeat
```

```json
{
  "nodeId": "NODE-us-east-1-a1b2c3d4",
  "metrics": {
    "latency": 42,
    "uptime": 86400
  }
}
```

- `latency`: response time in milliseconds
- `uptime`: cumulative uptime in seconds

> **Important:** Nodes that miss heartbeats for more than **5 minutes** are marked `offline` and stop earning until heartbeats resume.

---

## 4. Earnings

### How Revenue is Distributed

- **50%** of all platform RPC revenue is distributed to active node operators each epoch.
- Current benchmark rate: **~$0.000030 per RPC call**
- Example: a node handling 1M calls/day earns approximately **$15/day**

Your share of the operator pool is calculated as:

```
Your share = (your ops ÷ total network ops) × operator pool
```

Revenue distribution is enforced on-chain by the [SplitEngine contract](https://polygonscan.com/address/0x8a9CefBD801574806a634aF179f538ABB5926F5a) — no trust required.

### Reputation System (NETS Score)

A higher NETS reputation score increases your proportional share of the operator pool.

| Tier | Score Range | Earnings Multiplier |
|------|-------------|---------------------|
| Bronze | 0–250 | Base rate |
| Silver | 251–500 | +10% |
| Gold | 501–750 | +20% |
| Platinum | 751–1,000 | +30%, priority routing |

**Reputation increases with:**
- Consistent uptime
- Low latency responses
- High RPC call volume

**Reputation decreases with:**
- Missed heartbeats
- Downtime events
- SLA violations

### Track Your Earnings

Visit [satelink.network/dashboard](https://satelink.network/dashboard), select "Node Operator", and enter your node ID to view live earnings, reputation score, and claim history.

Or query the API:
```bash
curl https://rpc.satelink.network/api/nodes/NODE-YOUR-ID/earnings
```

### Hardware Scaling

| Tier | Specs | Expected Volume |
|------|-------|-----------------|
| Basic | 2 CPU / 2 GB RAM | ~100K calls/day |
| Standard | 4 CPU / 4 GB RAM | ~500K calls/day |
| Pro | 8 CPU / 8 GB RAM | ~2M calls/day |

---

## 5. Claims

Earnings accumulate on-chain and must be claimed to your wallet within each epoch's claim window.

### Check Your Balance

```bash
curl https://rpc.satelink.network/api/nodes/NODE-YOUR-ID/earnings
```

Response:
```json
{
  "nodeId": "NODE-us-east-1-a1b2c3d4",
  "pendingUSDT": "42.50",
  "claimableEpoch": 12,
  "claimWindowClosesAt": "2026-06-15T00:00:00Z"
}
```

### Claim to Your Wallet

```bash
curl -X POST https://rpc.satelink.network/api/nodes/NODE-YOUR-ID/claim \
  -H "Content-Type: application/json" \
  -d '{"wallet": "0xYOUR_POLYGON_WALLET"}'
```

The claim is verified and executed on-chain by the [ClaimsContract](https://polygonscan.com/address/0x6987921e2453f360e314e4424F6c2789F10a1CC9). USDT is transferred directly to your Polygon wallet.

> **Note:** Unclaimed earnings are returned to the treasury after the epoch claim window closes. Check your balance regularly.

---

## 6. Support

### Troubleshooting

**"Endpoint unreachable"**
- Confirm your server is accessible from the internet
- Verify port 8080 is open in your firewall
- Check that `GET /health` returns HTTP 200

**"Node not found"**
- Confirm the node ID is correct: `satelink-node status`
- Ensure registration completed successfully

**Node shows "offline"**
- Restart the agent: `satelink-node start`
- Check logs: `journalctl -u satelink-node`
- Verify heartbeats are being sent (look for `heartbeat OK` in logs)

**No earnings accruing**
- Confirm node status is `active` (not `offline`)
- Verify your endpoint is receiving and responding to RPC requests
- Check your NETS reputation score — very low scores may reduce your share

### Contact

| Channel | Link |
|---------|------|
| Discord | [discord.gg/satelink](https://discord.gg/satelink) |
| Email | satelinknetwork@gmail.com |
| Docs | [docs.satelink.network](https://docs.satelink.network) |
| GitHub | [github.com/Satelink-Protocol](https://github.com/Satelink-Protocol) |

---

*Last updated: May 2026*