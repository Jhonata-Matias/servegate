#!/usr/bin/env bash
# Smoke test for i2i single-image flow (backwards-compat after Qwen 2509 upgrade).
#
# Validates that an existing payload shape (1 image + prompt) continues to produce
# a valid PNG and that the workflow uses TextEncodeQwenImageEdit (single-image node),
# NOT TextEncodeQwenImageEditPlus.
#
# Usage:
#   bash serverless/tests/smoke-i2i-1image.sh <input-image.png> [output-path]
#
# Env:
#   SMOKE_PROMPT  — defaults to "add a small red hat on the subject, photorealistic"
#   MAX_WAIT_S    — defaults to 300
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
ENV_FILE="${PROJECT_ROOT}/.env"
[ -f "$ENV_FILE" ] || { echo "❌ .env não encontrado em $ENV_FILE" >&2; exit 1; }
set -a; . "$ENV_FILE"; set +a

: "${RUNPOD_API_KEY:?RUNPOD_API_KEY missing}"
: "${RUNPOD_SERVERLESS_ENDPOINT_ID:?RUNPOD_SERVERLESS_ENDPOINT_ID missing — deploy first}"

INPUT_IMAGE="${1:-}"
[ -n "$INPUT_IMAGE" ] || { echo "❌ Usage: $0 <input-image.png> [output-path]" >&2; exit 2; }
[ -f "$INPUT_IMAGE" ] || { echo "❌ Input image not found: $INPUT_IMAGE" >&2; exit 2; }

OUT="${2:-${SCRIPT_DIR}/smoke-i2i-1image-$(date +%s).png}"
PROMPT="${SMOKE_PROMPT:-add a small red hat on the subject, photorealistic}"
MAX_WAIT_S="${MAX_WAIT_S:-300}"

# base64 with no line wrapping (server-side decoder is strict)
IMG_B64=$(base64 -w 0 "$INPUT_IMAGE")
IMG_SIZE=$(wc -c < "$INPUT_IMAGE")
echo "→ Smoke i2i 1-image endpoint=$RUNPOD_SERVERLESS_ENDPOINT_ID prompt=\"$PROMPT\""
echo "  → input=$INPUT_IMAGE (${IMG_SIZE} bytes raw, $(( ${#IMG_B64} )) chars b64)"
START=$(date +%s)

PAYLOAD=$(jq -n \
  --arg p "$PROMPT" \
  --arg img "$IMG_B64" \
  '{input:{prompt:$p, input_image_b64:$img, seed:42}}')

SUBMIT=$(curl -sS -X POST \
  -H "Authorization: Bearer $RUNPOD_API_KEY" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD" \
  "https://api.runpod.ai/v2/$RUNPOD_SERVERLESS_ENDPOINT_ID/run")
JOB_ID=$(echo "$SUBMIT" | jq -r '.id // empty')
if [ -z "$JOB_ID" ]; then
  echo "❌ Job submission failed:" >&2
  echo "$SUBMIT" | jq . >&2
  exit 1
fi
echo "  → job_id=$JOB_ID"

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

if echo "$RESPONSE" | jq -e '.output.image_b64' > /dev/null 2>&1; then
  echo "$RESPONSE" | jq -r '.output.image_b64' | base64 -d > "$OUT"
  SIZE=$(wc -c < "$OUT")
  META=$(echo "$RESPONSE" | jq -c .output.metadata)
  echo "✅ PNG gravado em $OUT (${SIZE} bytes, ${ELAPSED}s)"
  echo "   metadata: $META"

  # PNG signature check
  if head -c 8 "$OUT" | od -An -tx1 | head -1 | grep -q '89 50 4e 47'; then
    echo "✅ PNG signature válido"
  else
    echo "⚠️  Header não parece PNG válido"
    exit 3
  fi

  # Backwards-compat: metadata should NOT contain *_2 fields
  if echo "$META" | jq -e 'has("input_width_2") or has("input_height_2")' > /dev/null 2>&1; then
    echo "⚠️  Metadata contém campos *_2 em chamada single-image (inesperado)"
    exit 4
  else
    echo "✅ Metadata sem campos *_2 (single-image confirmado)"
  fi
else
  echo "❌ Resposta sem image_b64:"
  echo "$RESPONSE" | jq .
  exit 1
fi
