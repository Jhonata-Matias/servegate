#!/usr/bin/env bash
# RunPod Serverless boot: start ComfyUI in background then launch handler.
set -euo pipefail

COMFY_DIR="${COMFY_DIR:-/opt/ComfyUI}"
COMFY_PORT="${COMFY_PORT:-8188}"
COMFY_LOG="${COMFY_LOG:-/tmp/comfyui.log}"
MODELS_DIR="${MODELS_DIR:-/runpod-volume/ComfyUI/models}"

ts() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }
log() { echo "{\"level\":\"info\",\"src\":\"start.sh\",\"ts\":\"$(ts)\",\"msg\":\"$1\"}"; }

log "boot_start"

if [ ! -d "$MODELS_DIR" ]; then
  echo "{\"level\":\"error\",\"src\":\"start.sh\",\"msg\":\"models dir missing\",\"path\":\"$MODELS_DIR\"}" >&2
  exit 1
fi

# Wire ComfyUI to read models from the network-volume location
cat > "$COMFY_DIR/extra_model_paths.yaml" <<EOF
runpod_volume:
  base_path: /runpod-volume/ComfyUI/
  checkpoints: models/checkpoints/
  unet: models/unet/
  clip: models/clip/
  vae: models/vae/
  loras: models/loras/
  controlnet: models/controlnet/
EOF
log "extra_model_paths_written"

cd "$COMFY_DIR"
log "comfy_starting"
python3 -u main.py --listen 127.0.0.1 --port "$COMFY_PORT" --disable-auto-launch > "$COMFY_LOG" 2>&1 &
COMFY_PID=$!
log "comfy_started"
echo "$COMFY_PID" > /tmp/comfyui.pid

# Hand off to the handler (which will wait_for_comfy itself)
log "handler_starting"
exec python3 -u /opt/handler/handler.py
