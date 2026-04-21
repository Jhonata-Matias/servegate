#!/usr/bin/env bash
# Smoke test 101 requests sequenciais — Story 2.5 AC7.
# Run AFTER `wrangler deploy` (HALT user action).
#
# Required env vars:
#   GATEWAY_URL — e.g. https://gemma4-gateway.<account>.workers.dev
#   GATEWAY_API_KEY — same value used in `wrangler secret put`
#
# Expected output:
#   100 lines "200" (proxy success)
#   1 line "429" (rate_limit_exceeded)
#   Last line shows Retry-After header value

set -euo pipefail

if [[ -z "${GATEWAY_URL:-}" || -z "${GATEWAY_API_KEY:-}" ]]; then
  echo "ERROR: set GATEWAY_URL and GATEWAY_API_KEY env vars first" >&2
  echo "  export GATEWAY_URL=https://gemma4-gateway.<account>.workers.dev" >&2
  echo "  export GATEWAY_API_KEY=<your-secret>" >&2
  exit 1
fi

echo "Running 101 sequential POSTs to $GATEWAY_URL..."

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
    200) ((count_200++)) ;;
    429)
      ((count_429++))
      # Capture Retry-After on first 429
      if [[ -z "$last_retry_after" ]]; then
        last_retry_after=$(curl -sS -I \
          -X POST \
          -H "X-API-Key: $GATEWAY_API_KEY" \
          -H "Content-Type: application/json" \
          -d "{\"input\":{\"prompt\":\"check\",\"steps\":1,\"width\":256,\"height\":256}}" \
          "$GATEWAY_URL" | grep -i 'retry-after' | awk '{print $2}' | tr -d '\r\n')
      fi
      ;;
    *) ((count_other++)); echo "  Request $i: unexpected status $status" >&2 ;;
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

# Validation
if [[ "$count_200" -eq 100 && "$count_429" -eq 1 ]]; then
  echo "✅ AC7 PASS — 100 success + 1 rate-limited as expected"
  exit 0
elif [[ "$count_200" -lt 100 ]]; then
  echo "❌ AC7 FAIL — fewer than 100 success (upstream/auth issue?)"
  exit 1
else
  echo "❌ AC7 FAIL — unexpected counts (check counts above)"
  exit 1
fi
