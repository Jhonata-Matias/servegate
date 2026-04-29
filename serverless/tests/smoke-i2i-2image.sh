#!/usr/bin/env bash
# Smoke test for i2i multi-image flow (new path: Qwen 2509 + TextEncodeQwenImageEditPlus).
#
# Validates that submitting two images plus a prompt produces a valid PNG and that
# the response metadata includes *_2 dimension fields (proving the multi-image branch
# of the handler executed).
#
# Usage:
#   bash serverless/tests/smoke-i2i-2image.sh <image1.png> <image2.png> [output-path]
#
# Env:
#   SMOKE_PROMPT  — defaults to "blend image 1 with the style of image 2, photorealistic"
#   MAX_WAIT_S    — defaults to 300
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
ENV_FILE="${PROJECT_ROOT}/.env"
[ -f "$ENV_FILE" ] || { echo "❌ .env não encontrado em $ENV_FILE" >&2; exit 1; }
set -a; . "$ENV_FILE"; set +a

: "${RUNPOD_API_KEY:?RUNPOD_API_KEY missing}"
: "${RUNPOD_SERVERLESS_ENDPOINT_ID:?RUNPOD_SERVERLESS_ENDPOINT_ID missing — deploy first}"

INPUT_IMAGE_1="${1:-}"
INPUT_IMAGE_2="${2:-}"
[ -n "$INPUT_IMAGE_1" ] && [ -n "$INPUT_IMAGE_2" ] || { echo "❌ Usage: $0 <image1.png> <image2.png> [output-path]" >&2; exit 2; }
[ -f "$INPUT_IMAGE_1" ] || { echo "❌ Image 1 not found: $INPUT_IMAGE_1" >&2; exit 2; }
[ -f "$INPUT_IMAGE_2" ] || { echo "❌ Image 2 not found: $INPUT_IMAGE_2" >&2; exit 2; }

OUT="${3:-${SCRIPT_DIR}/smoke-i2i-2image-$(date +%s).png}"
PROMPT="${SMOKE_PROMPT:-blend image 1 with the style of image 2, photorealistic}"
MAX_WAIT_S="${MAX_WAIT_S:-300}"

IMG1_B64=$(base64 -w 0 "$INPUT_IMAGE_1")
IMG2_B64=$(base64 -w 0 "$INPUT_IMAGE_2")
echo "→ Smoke i2i 2-image endpoint=$RUNPOD_SERVERLESS_ENDPOINT_ID prompt=\"$PROMPT\""
echo "  → image1=$INPUT_IMAGE_1 ($(wc -c < "$INPUT_IMAGE_1") bytes)"
echo "  → image2=$INPUT_IMAGE_2 ($(wc -c < "$INPUT_IMAGE_2") bytes)"
START=$(date +%s)

PAYLOAD=$(jq -n \
  --arg p "$PROMPT" \
  --arg img1 "$IMG1_B64" \
  --arg img2 "$IMG2_B64" \
  '{input:{prompt:$p, input_image_b64:$img1, input_image_b64_2:$img2, seed:42}}')

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

  if head -c 8 "$OUT" | od -An -tx1 | head -1 | grep -q '89 50 4e 47'; then
    echo "✅ PNG signature válido"
  else
    echo "⚠️  Header não parece PNG válido"
    exit 3
  fi

  # Multi-image proof: metadata must include *_2 fields confirming the Plus branch ran
  if echo "$META" | jq -e 'has("input_width_2") and has("input_height_2")' > /dev/null 2>&1; then
    echo "✅ Metadata inclui input_width_2/input_height_2 (multi-image confirmado)"
  else
    echo "❌ Metadata SEM campos *_2 — multi-image branch não executou"
    exit 4
  fi
else
  echo "❌ Resposta sem image_b64:"
  echo "$RESPONSE" | jq .
  exit 1
fi
