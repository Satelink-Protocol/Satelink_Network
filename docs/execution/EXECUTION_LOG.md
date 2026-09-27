# EXECUTION_LOG (append-only, IST)

- 2026-09-27 17:40 Read contract (451 lines) from ~/Downloads (not at ~/satelink-prompts). Evidence: session.
- 17:42 Repo state: local main 0547420 (8 behind), origin/main 4b2865f, 22 worktrees. `git worktree list`.
- 17:43 #426–#434 all MERGED with merge SHAs. `gh pr view`.
- 17:45 Railway + 3 Vercel projects serve 4b2865f. EXECUTION_STATE table.
- 17:46 Flag inventory: all V2 flags unset on Railway + satelink-console; SETTLEMENT_DRY_RUN=1, X402_ENABLED=true.
- 17:48 CLT removed from /Library/Developer (external); git unavailable until 18:34.
- 17:55 Prod DB (read-only): runner migrations through 016; no account_*/pv2_* tables; ledger kind CHECK lacks 'refund'; /v1/me/account 404; /webhooks/dodo/v2 404.
- 18:24 Contract moved to ~/satelink-prompts/. ~/.zshrc backed up to ~/satelink-private/zshrc.bak-2026-09-27; lines 59,60,68 deleted; `zsh -ic true` 0 stderr lines. GLM_API_KEY value was printed to transcript during inspection → FG-GLM-KEY.
- 18:30 Playwright MCP: root cause = unpinned `npx @playwright/mcp@latest` cold start > connect timeout + missing chromium rev 1246. Fixed: global @playwright/mcp@0.0.82, user MCP `playwright-local` ✔ Connected, chromium 1246 installed; screenshot satelink.network 200.
- 18:34 git 2.39.5 restored; `claude plugin install railway@claude-plugins-official` succeeded (first attempt failed: no git).
- 18:35 Worktree `.claude/worktrees/exec-2026-09-27` on branch chore/execution-state from origin/main 4b2865f.
- 18:36 FG-MIG (a): 019 has DROP CONSTRAINT → stopped. 016 checksums match; pending exactly 017–019.
- 18:36 DB snapshot (b) recorded: evidence/db-snapshot-before-2026-09-27.txt.
- 18:40 Tests: api 351/76 pending/7 fail (local satelink_test; prod DATABASE_URL overridden); vitest 283/283.
- 18:45 BEFORE screenshots: console 17 routes → all redirect /sign-in (no founder session: BLOCKED for signed-in state); admin command-center renders unauthenticated (22 console errors); 12 other admin tabs → /login.
- 18:55 FG-FLAG (c) code trace: RPC pre-deducts, no refund on 502 (F-1); Dodo credit packs fund RPC balance (F-2); payment_sources 349/350 founder TEST Dodo marked non-test (F-3).
