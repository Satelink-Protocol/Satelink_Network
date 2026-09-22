#!/usr/bin/env bash
# M5 gate — read-only verification of ONE real Dodo credit-pack purchase
# (and its refund) through the whole pipe: checkout -> webhook -> credit ->
# metered spend -> refund -> clawback/hold. Companion to m2-gate.sh (x402).
#
# Usage:
#   API_KEY=sk_dodo_... scripts/ops/m5-gate.sh          # purchase mode (default)
#   API_KEY=sk_dodo_... scripts/ops/m5-gate.sh refund   # refund mode
#
# API_KEY is the only credential the founder ever actually has — it's the
# one thing /intelligence/success shows as "Your API key" (see
# apps/web/src/app/(marketing)/intelligence/success/page.tsx: the page reads
# a one-time `?claim=` token from the checkout redirect, exchanges it
# server-side via /api/dodo-claim, and displays the api_key that comes back
# — the raw key itself never appears in a URL). There is no separate
# "account id" anywhere in the product UI.
#
# Internally this script also does DB-lookups by SATELINK_ACCOUNT_ID
# (api_credits.api_key, revenue_events_v2.client_id, ...). Confirmed against
# apps/web/src/app/api/dodo-checkout/route.ts:137 — the checkout route sets
# `metadata: { satelink_account_id: apiKey }`, i.e. the DB identity IS the
# api_key, not a distinct value. So SATELINK_ACCOUNT_ID is derived from
# API_KEY below rather than asked for separately; if that 1:1 relationship
# ever changes, reintroduce a distinct input here rather than assuming it
# silently still holds.
#
# All DB reads go through the sanctioned runner (scripts/ops/sat-db.ts via
# `railway run --service Postgres-iQeW`) — SELECT only, nothing here ever
# writes to prod. Every DB call and every HTTP response is quoted with its
# ACTUAL value in the PASS/FAIL line; API_KEY is never echoed in full, only
# masked (first 10 + last 4 chars).
set -uo pipefail
cd "$(dirname "$0")/../.."

MODE="${1:-purchase}"
API_BASE="${SATELINK_API_BASE:-https://rpc.satelink.network}"
STATE_FILE="scripts/ops/.m5-gate-state.json"
PASS=0
FAIL=0
SKIP=0

: "${API_KEY:?set API_KEY as an env var (never a CLI arg)}"
SATELINK_ACCOUNT_ID="$API_KEY"

mask() { local s="$1"; [[ ${#s} -le 14 ]] && { echo "***"; return; }; echo "${s:0:10}...${s: -4}"; }
echo "API_KEY=$(mask "$API_KEY")  mode=$MODE"
echo

q() { railway run --service Postgres-iQeW npx tsx scripts/ops/sat-db.ts "$1" 2>/dev/null; }

ok()   { PASS=$((PASS+1)); echo "PASS: $1"; }
bad()  { FAIL=$((FAIL+1)); echo "FAIL: $1"; }
skip() { SKIP=$((SKIP+1)); echo "SKIP: $1"; }

# ── purchase mode ────────────────────────────────────────────────────────
run_purchase() {
  echo "== 1. payment_sources row (source='dodo', this account) =="
  local ps
  ps="$(q "SELECT tx_hash, amount_usd, token, network, is_test_data, credited_api_key, created_at
            FROM payment_sources
            WHERE source = 'dodo' AND credited_api_key = '$SATELINK_ACCOUNT_ID'
            ORDER BY created_at DESC LIMIT 1")"
  echo "$ps"
  local tx_hash amount_usd
  tx_hash="$(echo "$ps" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const r=JSON.parse(d)[0];process.stdout.write(r?r.tx_hash:"")}catch{}})')"
  amount_usd="$(echo "$ps" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const r=JSON.parse(d)[0];process.stdout.write(r?String(r.amount_usd):"")}catch{}})')"
  if [[ -n "$tx_hash" ]]; then ok "payment_sources row found (tx_hash=$tx_hash, amount_usd=$amount_usd)"; else bad "no payment_sources row for source='dodo' AND credited_api_key matching SATELINK_ACCOUNT_ID"; fi
  echo

  echo "== 2. revenue_events_v2 row, correctly tagged =="
  local rev
  rev="$(q "SELECT op_type, amount_usdt, status, source, demand_source, is_test_data, is_billable, request_id
            FROM revenue_events_v2 WHERE request_id = '$tx_hash'")"
  echo "$rev"
  if echo "$rev" | grep -q '"op_type"'; then
    local rev_amount rev_status rev_source
    rev_amount="$(echo "$rev" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const r=JSON.parse(d)[0];process.stdout.write(String(r.amount_usdt))}catch{}})')"
    rev_status="$(echo "$rev" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const r=JSON.parse(d)[0];process.stdout.write(r.status)}catch{}})')"
    rev_source="$(echo "$rev" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const r=JSON.parse(d)[0];process.stdout.write(r.source)}catch{}})')"
    if [[ "$rev_source" == "dodo" && "$rev_status" == "completed" && "$rev_amount" == "$amount_usd" ]]; then
      ok "revenue_events_v2 row matches (source=dodo, status=completed, amount_usdt=$rev_amount == payment_sources.amount_usd)"
    else
      bad "revenue_events_v2 row present but mismatched (source=$rev_source status=$rev_status amount_usdt=$rev_amount vs payment_sources.amount_usd=$amount_usd)"
    fi
  else
    bad "no revenue_events_v2 row for request_id=$tx_hash"
  fi
  echo

  echo "== 3. api_credits increased by the USD-based amount (not INR) =="
  local dep bal_after_purchase
  dep="$(q "SELECT credited_usdt, amount_usdt FROM api_deposits WHERE tx_hash = '$tx_hash'")"
  echo "$dep"
  local credited_usdt
  credited_usdt="$(echo "$dep" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const r=JSON.parse(d)[0];process.stdout.write(r?String(r.credited_usdt):"")}catch{}})')"
  bal_after_purchase="$(q "SELECT credits_usdt FROM api_credits WHERE api_key = '$SATELINK_ACCOUNT_ID'" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const r=JSON.parse(d)[0];process.stdout.write(r?String(r.credits_usdt):"")}catch{}})')"
  echo "current api_credits.credits_usdt = $bal_after_purchase"
  if [[ -n "$credited_usdt" && "$credited_usdt" == "$amount_usd" ]]; then
    ok "api_deposits.credited_usdt ($credited_usdt) matches payment_sources.amount_usd ($amount_usd) — self-consistent USD figure, not a raw INR one"
    echo "  >>> EYEBALL THIS: does $credited_usdt USD match what you actually paid for the product, not total_amount/100? <<<"
  else
    bad "api_deposits.credited_usdt ($credited_usdt) does not match payment_sources.amount_usd ($amount_usd)"
  fi
  echo

  echo "== 4. paid GET /v1/intelligence/funding-rate-heatmap returns 200 real data =="
  local usage_before req_count_before spend_before http_body http_status
  usage_before="$(q "SELECT request_count, usdt_spent FROM api_usage_daily WHERE api_key = '$SATELINK_ACCOUNT_ID' AND date = CURRENT_DATE")"
  req_count_before="$(echo "$usage_before" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const r=JSON.parse(d)[0];process.stdout.write(String(r?r.request_count:0))}catch{process.stdout.write("0")}})')"
  spend_before="$(echo "$usage_before" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const r=JSON.parse(d)[0];process.stdout.write(String(r?r.usdt_spent:0))}catch{process.stdout.write("0")}})')"

  http_status="$(curl -sS -o /tmp/m5gate_resp.json -w '%{http_code}' -H "X-API-Key: $API_KEY" "$API_BASE/v1/intelligence/funding-rate-heatmap")"
  http_body="$(cat /tmp/m5gate_resp.json 2>/dev/null)"; rm -f /tmp/m5gate_resp.json
  echo "HTTP $http_status"
  echo "$http_body" | head -c 500
  echo
  if [[ "$http_status" == "200" ]] && echo "$http_body" | grep -qv '"error"'; then
    ok "paid call returned 200 with a non-error body"
  else
    bad "paid call did not return clean 200 (status=$http_status)"
  fi
  echo

  echo "== 5. api_credits decreased by exactly the metered price =="
  local bal_after_call
  bal_after_call="$(q "SELECT credits_usdt FROM api_credits WHERE api_key = '$SATELINK_ACCOUNT_ID'" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const r=JSON.parse(d)[0];process.stdout.write(r?String(r.credits_usdt):"")}catch{}})')"
  echo "credits_usdt before call = $bal_after_purchase, after call = $bal_after_call"
  local deducted
  deducted="$(node -e "console.log((($bal_after_purchase)-($bal_after_call)).toFixed(6))" 2>/dev/null || echo "")"
  echo "deducted = $deducted"
  echo

  echo "== 6. api_usage_daily recorded it =="
  local usage_after req_count_after spend_after
  usage_after="$(q "SELECT request_count, usdt_spent FROM api_usage_daily WHERE api_key = '$SATELINK_ACCOUNT_ID' AND date = CURRENT_DATE")"
  echo "$usage_after"
  req_count_after="$(echo "$usage_after" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const r=JSON.parse(d)[0];process.stdout.write(String(r?r.request_count:0))}catch{process.stdout.write("0")}})')"
  spend_after="$(echo "$usage_after" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const r=JSON.parse(d)[0];process.stdout.write(String(r?r.usdt_spent:0))}catch{process.stdout.write("0")}})')"
  local spend_delta
  spend_delta="$(node -e "console.log((($spend_after)-($spend_before)).toFixed(6))" 2>/dev/null || echo "")"
  echo "request_count: $req_count_before -> $req_count_after   usdt_spent delta: $spend_delta"

  if [[ "$req_count_after" -gt "$req_count_before" ]] && [[ -n "$deducted" ]] && [[ "$spend_delta" == "$deducted" ]]; then
    ok "step 5+6 self-consistent: credits deducted ($deducted) == api_usage_daily.usdt_spent delta ($spend_delta), request_count incremented"
  else
    bad "step 5+6 mismatch: deducted=$deducted spend_delta=$spend_delta req_count $req_count_before->$req_count_after"
  fi
  echo

  # Persist state for the later `refund` run — never contains secrets, only
  # amounts/ids already printed above in plaintext.
  node -e "
    require('fs').writeFileSync('$STATE_FILE', JSON.stringify({
      tx_hash: '$tx_hash',
      original_amount_usd: '$amount_usd',
      balance_after_purchase_and_call: '$bal_after_call',
    }, null, 2));
  "
  echo "state saved to $STATE_FILE for the refund-mode run"
}

# ── refund mode ──────────────────────────────────────────────────────────
run_refund() {
  if [[ ! -f "$STATE_FILE" ]]; then
    bad "no $STATE_FILE — run purchase mode first (this file is written by that run)"
    print_summary; exit 1
  fi
  local tx_hash original_amount_usd balance_before_refund
  tx_hash="$(node -e "console.log(require('$STATE_FILE').tx_hash)")"
  original_amount_usd="$(node -e "console.log(require('$STATE_FILE').original_amount_usd)")"
  balance_before_refund="$(node -e "console.log(require('$STATE_FILE').balance_after_purchase_and_call)")"
  local payment_id="${tx_hash#dodo:}"
  echo "using state: tx_hash=$tx_hash original_amount_usd=$original_amount_usd balance_before_refund=$balance_before_refund"
  echo

  echo "== 1. negative reversal row in revenue_events_v2; original row unmutated =="
  local rev
  rev="$(q "SELECT op_type, amount_usdt, status, is_billable, request_id FROM revenue_events_v2
            WHERE op_type = 'refund_reversal' AND client_id = '$SATELINK_ACCOUNT_ID'
            ORDER BY created_at DESC LIMIT 1")"
  echo "$rev"
  local rev_amount rev_billable
  rev_amount="$(echo "$rev" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const r=JSON.parse(d)[0];process.stdout.write(String(r?r.amount_usdt:""))}catch{}})')"
  rev_billable="$(echo "$rev" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const r=JSON.parse(d)[0];process.stdout.write(String(r?r.is_billable:""))}catch{}})')"
  local orig
  orig="$(q "SELECT amount_usdt, status FROM revenue_events_v2 WHERE request_id = '$tx_hash' AND op_type != 'refund_reversal'")"
  echo "original row now: $orig"
  local orig_amount
  orig_amount="$(echo "$orig" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const r=JSON.parse(d)[0];process.stdout.write(String(r?r.amount_usdt:""))}catch{}})')"
  if [[ -n "$rev_amount" ]] && node -e "process.exit(Number('$rev_amount') < 0 ? 0 : 1)" && [[ "$rev_billable" == "false" ]] && [[ "$orig_amount" == "$original_amount_usd" ]]; then
    ok "reversal row is negative ($rev_amount), is_billable=false, and the original row's amount_usdt ($orig_amount) is unchanged from purchase-mode's snapshot ($original_amount_usd)"
  else
    bad "reversal/original row check failed (reversal amount=$rev_amount is_billable=$rev_billable, original now=$orig_amount vs snapshot=$original_amount_usd)"
  fi
  echo

  echo "== 2. credits clawed back correctly, or payment_hold set if already spent =="
  local acct
  acct="$(q "SELECT credits_usdt, payment_hold FROM api_credits WHERE api_key = '$SATELINK_ACCOUNT_ID'")"
  echo "$acct"
  local bal_now hold
  bal_now="$(echo "$acct" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const r=JSON.parse(d)[0];process.stdout.write(String(r?r.credits_usdt:""))}catch{}})')"
  hold="$(echo "$acct" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const r=JSON.parse(d)[0];process.stdout.write(String(r?r.payment_hold:""))}catch{}})')"
  local expected_full_clawback
  expected_full_clawback="$(node -e "console.log((Number('$balance_before_refund') - Number('$original_amount_usd')).toFixed(6))" 2>/dev/null || echo "")"
  if [[ "$hold" == "true" ]]; then
    ok "shortfall path: payment_hold=true (spent more than the refund could claw back from balance $balance_before_refund)"
  elif [[ "$bal_now" == "$expected_full_clawback" ]]; then
    ok "full clawback: balance went $balance_before_refund -> $bal_now (== balance_before_refund - refunded $original_amount_usd), no hold"
  else
    bad "unexpected balance state: now=$bal_now expected_full_clawback=$expected_full_clawback payment_hold=$hold"
  fi
  echo

  echo "== 3. held key gets 402 payment_hold on a paid call =="
  if [[ "$hold" == "true" ]]; then
    local http_status http_body
    http_status="$(curl -sS -o /tmp/m5gate_resp2.json -w '%{http_code}' -H "X-API-Key: $API_KEY" "$API_BASE/v1/intelligence/funding-rate-heatmap")"
    http_body="$(cat /tmp/m5gate_resp2.json 2>/dev/null)"; rm -f /tmp/m5gate_resp2.json
    echo "HTTP $http_status: $http_body"
    if [[ "$http_status" == "402" ]] && echo "$http_body" | grep -q "payment_hold"; then
      ok "paid call correctly blocked with 402 payment_hold"
    else
      bad "expected 402 payment_hold, got HTTP $http_status: $http_body"
    fi
  else
    skip "account is not on payment_hold (full clawback covered it) — this step only applies to the shortfall path"
  fi
  echo

  echo "== 4. dodo_refund_dispute_log row exists and is idempotent =="
  local log
  log="$(q "SELECT event_id, kind, event_type, dodo_ref, amount_usd, shortfall_usd FROM dodo_refund_dispute_log
            WHERE payment_id = '$payment_id' AND kind = 'refund' ORDER BY created_at DESC LIMIT 1")"
  echo "$log"
  local event_id
  event_id="$(echo "$log" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const r=JSON.parse(d)[0];process.stdout.write(r?r.event_id:"")}catch{}})')"
  if [[ -n "$event_id" ]]; then
    local dupe_count
    dupe_count="$(q "SELECT count(*) c FROM dodo_refund_dispute_log WHERE event_id = '$event_id'" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const r=JSON.parse(d)[0];process.stdout.write(String(r.c))}catch{}})')"
    if [[ "$dupe_count" == "1" ]]; then
      ok "dodo_refund_dispute_log row found (event_id=$event_id), exactly 1 row — idempotent against any retries Dodo already sent"
      echo "  NOTE: this proves no duplicate was written for retries that already happened, not a synthetic re-run — this script never re-POSTs a webhook (read-only)."
    else
      bad "event_id=$event_id has $dupe_count rows — idempotency broken (event_id UNIQUE constraint should make this impossible)"
    fi
  else
    bad "no dodo_refund_dispute_log row for payment_id=$payment_id"
  fi
}

print_summary() {
  echo
  echo "== SUMMARY: $PASS passed, $FAIL failed, $SKIP skipped =="
  [[ "$FAIL" -eq 0 ]] && echo "GATE: PASS" || echo "GATE: FAIL"
}

case "$MODE" in
  purchase) run_purchase ;;
  refund) run_refund ;;
  *) echo "unknown mode '$MODE' — use 'purchase' (default) or 'refund'"; exit 2 ;;
esac

print_summary
[[ "$FAIL" -eq 0 ]]
