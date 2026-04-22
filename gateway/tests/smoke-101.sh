#!/usr/bin/env bash
# Smoke test 101 requests sequenciais — Story 2.5 AC7.
# Run AFTER `wrangler deploy` (HALT user action).
#
# Required env vars:
#   GATEWAY_URL — e.g. https://gemma4-gateway.jhonata-matias.workers.dev
#   GATEWAY_API_KEY — same value used in `wrangler secret put`
#
# Expected output:
#   100 lines "200" (proxy success)
#   1 line "429" (rate_limit_exceeded)
#   Last line shows Retry-After header value

set -euo pipefail

if [[ -z "${GATEWAY_URL:-}" || -z "${GATEWAY_API_KEY:-}" ]]; then
  echo "ERROR: set GATEWAY_URL and GATEWAY_API_KEY env vars first" >&2
  echo "  export GATEWAY_URL=https://gemma4-gateway.jhonata-matias.workers.dev" >&2
  echo "  export GATEWAY_API_KEY=<your-secret>" >&2
  exit 1
fi

echo "Running 101 sequential POSTs to $GATEWAY_URL..."

# NOTE: using assignment-style increments (count=$((count+1))) instead of
# ((count++)) because post-increment returns pre-value (0) under set -e,
# which triggers silent exit on first increment from 0. Known bash gotcha.
count_200=0
count_429=0
count_other=0
last_retry_after=""

for i in $(seq 1 101); do
  status=$(curl -sS -o /dev/null -w "%{http_code}" \
    -X POST \
    -H "X-API-Key: $GATEWAY_API_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"input\":{\"prompt\":\"smoke test $i\",\"steps\":1,\"width\":256,\"height\":256}}" \
    "$GATEWAY_URL")

  case "$status" in
    200) count_200=$((count_200 + 1)) ;;
    429)
      count_429=$((count_429 + 1))
      # Capture Retry-After on first 429 using -i (include headers in output).
      # Avoid -I which forces HEAD method — gateway rejects HEAD with 405.
      if [[ -z "$last_retry_after" ]]; then
        last_retry_after=$(curl -sS -i \
          -X POST \
          -H "X-API-Key: $GATEWAY_API_KEY" \
          -H "Content-Type: application/json" \
          -d "{\"input\":{\"prompt\":\"check\",\"steps\":1,\"width\":256,\"height\":256}}" \
          "$GATEWAY_URL" 2>/dev/null | grep -i '^retry-after:' | head -1 | awk '{print $2}' | tr -d '\r\n' || true)
      fi
      ;;
    *)
      count_other=$((count_other + 1))
      echo "  Request $i: unexpected status $status" >&2
      ;;
  esac

  # Print progress every 10 requests
  if (( i % 10 == 0 )); then
    echo "  Progress: $i/101 (200=$count_200, 429=$count_429, other=$count_other)"
  fi
done

echo ""
echo "==== SMOKE TEST RESULTS ===="
echo "200 (success):     $count_200"
echo "429 (rate-limited): $count_429"
echo "Other:             $count_other"
echo "Retry-After (429): $last_retry_after seconds"
echo ""

# Validation with R7 tolerance — KV eventual consistency may cause ±2 off
# Per Epic 2 PRD Risk R7 + gateway/src/rate-limit.ts JSDoc.
total=$((count_200 + count_429))
if (( total != 101 )); then
  echo "❌ AC7 FAIL — total responses $total != 101 (some requests lost; upstream/network?)"
  exit 1
fi

if (( count_200 >= 98 && count_200 <= 100 && count_429 >= 1 && count_429 <= 3 )); then
  if (( count_200 == 100 && count_429 == 1 )); then
    echo "✅ AC7 PASS — exact 100+1 (no KV consistency skew observed)"
  else
    echo "✅ AC7 PASS — ${count_200}×200 + ${count_429}×429 (within R7 KV eventual consistency tolerance ±2)"
  fi
  exit 0
elif (( count_200 < 98 )); then
  echo "❌ AC7 FAIL — only ${count_200} successes (expected 98-100, possible upstream issue)"
  exit 1
else
  echo "❌ AC7 FAIL — unexpected pattern ${count_200}×200 + ${count_429}×429 (investigate)"
  exit 1
fi
