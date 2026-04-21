#!/usr/bin/env bash
# Smoke test: chama o endpoint Serverless e valida que retorna PNG decodificável.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
ENV_FILE="${PROJECT_ROOT}/.env"
[ -f "$ENV_FILE" ] || { echo "❌ .env não encontrado em $ENV_FILE" >&2; exit 1; }
set -a; . "$ENV_FILE"; set +a

: "${RUNPOD_API_KEY:?RUNPOD_API_KEY missing}"
: "${RUNPOD_SERVERLESS_ENDPOINT_ID:?RUNPOD_SERVERLESS_ENDPOINT_ID missing — deploy first}"

OUT="${1:-${SCRIPT_DIR}/smoke-$(date +%s).png}"
PROMPT="${SMOKE_PROMPT:-a peaceful zen garden with cherry blossoms, photorealistic}"
MAX_WAIT_S="${MAX_WAIT_S:-300}"

echo "→ Smoke test endpoint=$RUNPOD_SERVERLESS_ENDPOINT_ID prompt=\"$PROMPT\""
START=$(date +%s)

# Submit async (avoids /runsync HTTP timeout on cold starts)
SUBMIT=$(curl -sS -X POST \
  -H "Authorization: Bearer $RUNPOD_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"input\":{\"prompt\":\"$PROMPT\",\"seed\":42}}" \
  "https://api.runpod.ai/v2/$RUNPOD_SERVERLESS_ENDPOINT_ID/run")
JOB_ID=$(echo "$SUBMIT" | jq -r '.id // empty')
if [ -z "$JOB_ID" ]; then
  echo "❌ Job submission failed:" >&2
  echo "$SUBMIT" | jq . >&2
  exit 1
fi
echo "  → job_id=$JOB_ID"

# Poll until COMPLETED/FAILED or timeout
RESPONSE=""
for _ in $(seq 1 $((MAX_WAIT_S / 3))); do
  RESPONSE=$(curl -sS -H "Authorization: Bearer $RUNPOD_API_KEY" \
    "https://api.runpod.ai/v2/$RUNPOD_SERVERLESS_ENDPOINT_ID/status/$JOB_ID")
  STATUS=$(echo "$RESPONSE" | jq -r .status)
  if [ "$STATUS" = "COMPLETED" ] || [ "$STATUS" = "FAILED" ] || [ "$STATUS" = "CANCELLED" ]; then
    break
  fi
  sleep 3
done
ELAPSED=$(( $(date +%s) - START ))

# Validações
if echo "$RESPONSE" | jq -e '.output.image_b64' > /dev/null 2>&1; then
  echo "$RESPONSE" | jq -r '.output.image_b64' | base64 -d > "$OUT"
  SIZE=$(wc -c < "$OUT")
  HEAD=$(xxd -l 8 "$OUT" 2>/dev/null | head -1)
  echo "✅ PNG gravado em $OUT (${SIZE} bytes, ${ELAPSED}s)"
  echo "   header: $HEAD"
  echo "   metadata: $(echo "$RESPONSE" | jq -c .output.metadata)"
  if [[ "$HEAD" =~ ^00000000:.*8950.4e47 ]] || head -c 8 "$OUT" | od -An -tx1 | head -1 | grep -q '89 50 4e 47'; then
    echo "✅ PNG signature validado"
  else
    echo "⚠️  Arquivo não parece PNG válido (header: $HEAD)"
  fi
else
  echo "❌ Resposta sem image_b64:"
  echo "$RESPONSE" | jq .
  exit 1
fi
