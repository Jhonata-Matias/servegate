#!/usr/bin/env bash
# Story 6.1 — delete isolated HiDream PoC serverless endpoint via RunPod REST.
# Does NOT touch production FLUX / i2i / video endpoints.
set -euo pipefail

: "${RUNPOD_API_KEY:?Set RUNPOD_API_KEY}"
: "${RUNPOD_HIDREAM_POC_ENDPOINT_ID:?Set RUNPOD_HIDREAM_POC_ENDPOINT_ID (PoC endpoint only)}"

API="${RUNPOD_REST_API:-https://rest.runpod.io/v1}"
AUTH=(-H "Authorization: Bearer $RUNPOD_API_KEY")
EP="$RUNPOD_HIDREAM_POC_ENDPOINT_ID"

echo "→ DELETE $API/endpoints/$EP"
RESP="$(curl -sS -X DELETE "${AUTH[@]}" "$API/endpoints/$EP")"
echo "$RESP" | head -c 2000
echo ""
echo "→ Save this response as teardown evidence under .aiox/notes/story-6.1/ (local only, gitignored)."
echo "→ If a dedicated PoC network volume was created, delete it in the RunPod console and record here."
