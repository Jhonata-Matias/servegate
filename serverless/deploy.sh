#!/usr/bin/env bash
# Deploy: cria template + endpoint Serverless via RunPod REST API.
# Idempotente: se template/endpoint já existem (por nome), reusa.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="${PROJECT_ROOT}/.env"
[ -f "$ENV_FILE" ] || { echo "❌ .env não encontrado" >&2; exit 1; }
set -a; . "$ENV_FILE"; set +a

: "${RUNPOD_API_KEY:?RUNPOD_API_KEY missing}"

IMAGE="${IMAGE:-ghcr.io/jhonata-matias/gemma4-flux-serverless:0.1.0}"
TEMPLATE_NAME="${TEMPLATE_NAME:-gemma4-flux-serverless-v0_1_0}"
ENDPOINT_NAME="${ENDPOINT_NAME:-gemma4-flux-serverless}"
GPU_TYPE="${GPU_TYPE:-NVIDIA GeForce RTX 4090}"
: "${DATACENTER:?DATACENTER required (set in .env: RunPod datacenter code where network volume lives)}"
: "${NETWORK_VOLUME_ID:?NETWORK_VOLUME_ID required (set in .env: RunPod network volume ID with model weights)}"
CONTAINER_REGISTRY_AUTH_ID="${CONTAINER_REGISTRY_AUTH_ID:-${RUNPOD_GHCR_AUTH_ID:-}}"
# 300s aligns with handler.py COMFY_GENERATION_TIMEOUT_S (280s + margin). 120s was insufficient
# for cold starts loading the 23GB FLUX UNET from the network volume (observed 98-150s real cold).
EXECUTION_TIMEOUT_MS="${EXECUTION_TIMEOUT_MS:-300000}"

API="https://rest.runpod.io/v1"
AUTH=(-H "Authorization: Bearer $RUNPOD_API_KEY")

upsert_kv() {
  local key="$1" value="$2"
  if grep -q "^${key}=" "$ENV_FILE"; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$ENV_FILE"
  else
    echo "${key}=${value}" >> "$ENV_FILE"
  fi
}

# 1) Template
echo "→ Resolving template '$TEMPLATE_NAME'..."
TEMPLATE_ID=$(curl -sS "${AUTH[@]}" "$API/templates" | jq -r --arg n "$TEMPLATE_NAME" '.[] | select(.name==$n) | .id' | head -1)
if [ -z "$TEMPLATE_ID" ] || [ "$TEMPLATE_ID" = "null" ]; then
  echo "  Creating new template..."
  RESP=$(curl -sS -X POST "${AUTH[@]}" -H "Content-Type: application/json" \
    "$API/templates" \
    -d "$(jq -n \
      --arg name "$TEMPLATE_NAME" \
      --arg img "$IMAGE" \
      --arg auth "$CONTAINER_REGISTRY_AUTH_ID" \
      '{
        name: $name,
        imageName: $img,
        category: "NVIDIA",
        containerDiskInGb: 20,
        isServerless: true,
        isPublic: false,
        readme: "ComfyUI + FLUX.1-schnell handler — Story 2.1"
      } + (if $auth == "" then {} else {containerRegistryAuthId: $auth} end)')")
  TEMPLATE_ID=$(echo "$RESP" | jq -r '.id // empty')
  if [ -z "$TEMPLATE_ID" ]; then
    echo "❌ Template creation failed:" >&2
    echo "$RESP" | jq . >&2
    exit 1
  fi
  echo "  ✅ Created TEMPLATE_ID=$TEMPLATE_ID"
else
  echo "  ↻ Reusing TEMPLATE_ID=$TEMPLATE_ID"
fi
upsert_kv "RUNPOD_SERVERLESS_TEMPLATE_ID" "$TEMPLATE_ID"

# 2) Endpoint
echo "→ Resolving endpoint '$ENDPOINT_NAME'..."
ENDPOINT_JSON=$(curl -sS "${AUTH[@]}" "$API/endpoints" | jq --arg n "$ENDPOINT_NAME" '.[] | select(.name==$n)' | head -1000)
ENDPOINT_ID=$(echo "$ENDPOINT_JSON" | jq -r '.id // empty')
if [ -z "$ENDPOINT_ID" ] || [ "$ENDPOINT_ID" = "null" ]; then
  echo "  Creating new endpoint..."
  RESP=$(curl -sS -X POST "${AUTH[@]}" -H "Content-Type: application/json" \
    "$API/endpoints" \
    -d "$(jq -n \
      --arg name "$ENDPOINT_NAME" \
      --arg tid "$TEMPLATE_ID" \
      --arg gpu "$GPU_TYPE" \
      --arg dc "$DATACENTER" \
      --arg nv "$NETWORK_VOLUME_ID" \
      --argjson timeout "$EXECUTION_TIMEOUT_MS" \
      '{
        name: $name,
        templateId: $tid,
        computeType: "GPU",
        gpuTypeIds: [$gpu],
        gpuCount: 1,
        dataCenterIds: [$dc],
        networkVolumeId: $nv,
        workersMin: 0,
        workersMax: 3,
        idleTimeout: 5,
        executionTimeoutMs: $timeout,
        flashboot: true,
        scalerType: "QUEUE_DELAY",
        scalerValue: 4
      }')")
  ENDPOINT_ID=$(echo "$RESP" | jq -r '.id // empty')
  if [ -z "$ENDPOINT_ID" ]; then
    echo "❌ Endpoint creation failed:" >&2
    echo "$RESP" | jq . >&2
    exit 1
  fi
  echo "  ✅ Created ENDPOINT_ID=$ENDPOINT_ID (executionTimeoutMs=$EXECUTION_TIMEOUT_MS)"
else
  CURRENT_TIMEOUT=$(echo "$ENDPOINT_JSON" | jq -r '.executionTimeoutMs // empty')
  if [ -n "$CURRENT_TIMEOUT" ] && [ "$CURRENT_TIMEOUT" != "$EXECUTION_TIMEOUT_MS" ]; then
    echo "  ⚠ executionTimeoutMs drift: live=$CURRENT_TIMEOUT target=$EXECUTION_TIMEOUT_MS — applying PATCH"
    curl -sS -X PATCH "${AUTH[@]}" -H "Content-Type: application/json" \
      "$API/endpoints/$ENDPOINT_ID" \
      -d "$(jq -n --argjson t "$EXECUTION_TIMEOUT_MS" '{executionTimeoutMs: $t}')" > /dev/null
    echo "  ✅ Patched ENDPOINT_ID=$ENDPOINT_ID executionTimeoutMs → $EXECUTION_TIMEOUT_MS"
  else
    echo "  ↻ Reusing ENDPOINT_ID=$ENDPOINT_ID (executionTimeoutMs=$CURRENT_TIMEOUT already aligned)"
  fi
fi
upsert_kv "RUNPOD_SERVERLESS_ENDPOINT_ID" "$ENDPOINT_ID"

echo ""
echo "Done. Saved to $ENV_FILE:"
grep ^RUNPOD_SERVERLESS_ "$ENV_FILE"
echo ""
echo "Test invocation:"
echo "  bash serverless/tests/smoke.sh"
