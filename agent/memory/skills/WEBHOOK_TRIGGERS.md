# WEBHOOK TRIGGERS — External Event Sources

## DepositReceived (when on-chain USDT deposit confirmed)
Source: DepositListener in server.js
Trigger: ECONOMY_COMMANDER → EVT-REV: revenue.deposit_received
Action: Update CUSTOMER_ZERO_PROGRAM.md stage, log to REVENUE_LOG.md

## RateLimitSpike (when nearLimitIPs > 20)
Source: REVENUE_PULSE every 30 min
Trigger: ECONOMY_COMMANDER → EVT-REV: revenue.conversion_opportunity
Action: Log near-limit IPs to CONVERSIONS.md

## DeploymentFailure
Source: Railway webhook or HEALTH_PULSE
Trigger: ENGINEERING_COMMANDER → EVT-OPS: incident.deploy_failed
Action: Check logs, revert if needed, redeploy
