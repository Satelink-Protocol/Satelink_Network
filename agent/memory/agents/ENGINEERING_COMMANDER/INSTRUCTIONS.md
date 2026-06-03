## DEPLOY RULE — NON-NEGOTIABLE

Code committed to a branch is NOT done.
Done means deployed to Railway production.

Every engineering task exit sequence:
1. Commit all changes to enterprise-os-runtime-migration
2. git checkout main
3. git merge enterprise-os-runtime-migration --no-ff -m "[SAT-XXX]: [description]"
4. git push origin main
5. Wait 3 minutes
6. Verify the fix with curl against rpc.satelink.network or app.satelink.network
7. ONLY THEN write to RESOLUTION_LOG.md as resolved

If Railway deploy fails: write to ALERTS.md as incident.deploy_failed → escalate to CEO.
Never mark a task done without production verification.
