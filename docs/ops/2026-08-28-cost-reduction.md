# Cost reduction (2026-08-28) — the app gates did NOT cut the bill

The #340/#341 gates stopped **DB writes**, not spend. A 402 still costs a full request
cycle (CPU + RAM + egress). Egress kept climbing (34.98 → 37.69 GB, ~2 GB/day). Cost control
belongs at the **Cloudflare edge**, not the app layer.

Current bill $11.16, month estimate **$22.63**. Breakdown: Memory $6.62 (59%), CPU $2.42 (22%),
Egress $1.88 (17%), Volume $0.12, Backup $0.04.

Measured (Railway metrics, last 1h, post-recovery):
- Postgres-iQeW: **703 MB** RSS (inherent DB memory — shared_buffers etc.; not cappable via heap).
- satelink-reconciler: **306 MB** (max 314), **no heap cap**, stable (not leaking). Runs `npx tsx`
  in prod (esbuild adds ~80–100 MB vs compiled JS).
- Satelink-api: **212 MB** (max 215), `--max-old-space-size=400` working.

## Cost table (ranked by $/mo)

| # | Action | Evidence | $/mo | Risk | Reversible |
|---|---|---|---:|---|---|
| 1 | **Remove Paperclip-DB + Satelink_Paperclip** | Zero code refs (grep); both idle/Failed; an idle Postgres holds ~200–300 MB RAM continuously | **~$3.00** | Low if truly unused | Yes (restore from backup) — **STOP-2: verified backup first** |
| 2 | **Cloudflare 5 req/60s rate-limit on `/rpc/*`** | Egress 2 GB/day from ~667k req/day, ~0 conversions; dropping scanner traffic at the edge cuts **egress + CPU + RAM together** | **~$1.50–2.00** | Low (rate-limit, not block — see below) | Yes (toggle rule) |
| 3 | **Compile reconciler TS→JS** (drop `tsx`/esbuild) | 306 MB RSS running `npx tsx`; compiled `node dist` drops ~80–100 MB | **~$0.50–1.00** | Low (build-pipeline change) | Yes |
| 4 | **Reconciler heap cap `--max-old-space-size=384`** | max RSS 314 MB; bounds runaway | **~$0** (precautionary, not a cut) | Low | Yes (this PR) |
| 5 | **Delete orphan `postgres-volume`** (2nd 5 GB, no service) | Volume is 1% of bill | **~$0.06** | Low | Yes — **STOP-2** |

**Honest target assessment:** <$8/mo is **not reachable** with these cuts alone. Even after #1+#2+#3
(~$5–6/mo off the $22.63 estimate → ~$16–17/mo), **Memory ($6.62) is the floor** and is dominated by
Postgres-iQeW (703 MB, inherent) plus the API/reconciler baselines that cannot be removed while the
app serves. Reaching <$8 would require consolidating services or downsizing Postgres — a bigger
architectural decision, not a config change. The realistic near-term floor is **~$14–16/mo**.

## Cloudflare rule EDIT (Phase 4.1) — Free plan caps http_ratelimit at ONE rule
You cannot add a rule via API on Free (`50001: 2 out of 1`); **EDIT the existing rule** in the
dashboard. Ready-to-paste expressions are also in `docs/ops/cloudflare-rpc-ratelimit.md`.

**Dashboard → Security → WAF → Rate limiting rules → edit `satelink-rate-limit`:**
- **When incoming requests match** (Expression Preview it first):
  ```
  (http.request.uri.path contains "/rpc/")
  and not (http.request.uri.path contains "/internal/")
  and not (http.request.uri.path eq "/health")
  and not (any(http.request.headers.names[*] eq "x-payment"))
  ```
- **Rate:** **5 requests / 60 seconds**, **Count by** IP.
- **Action:** Block. **Duration:** 10 minutes.
- **Why this is safe (STOP-B):** this is a *rate-limit* action — the first ≤5 requests/min per IP
  still reach the app and receive the **402** x402 payment challenge. A real x402 client needs 1–2
  discovery requests then retries **with `x-payment`** (excluded above). A scanner needs hundreds and
  is throttled. **Never** convert this to a Custom Rule with a blanket Block — that returns 403 on the
  first request and kills x402 discovery.
- If `http.request.headers.names` is unavailable on Free (Expression Preview errors), fall back to the
  path-only variant in `cloudflare-rpc-ratelimit.md` at 20 req/60s — and say so explicitly, don't
  silently substitute.
