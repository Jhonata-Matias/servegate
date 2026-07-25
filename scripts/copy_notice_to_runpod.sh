#!/usr/bin/env bash
# Copy the QWEN NOTICE into the RunPod network volume.
# Usage:
#   ./scripts/copy_notice_to_runpod.sh /path/to/docs/legal/QWEN_IMAGE_EDIT_NOTICE.md /runpod-volume/ComfyUI/NOTICE.md

set -euo pipefail

SRC=${1:-docs/legal/QWEN_IMAGE_EDIT_NOTICE.md}
DEST=${2:-/runpod-volume/ComfyUI/NOTICE.md}

if [ ! -f "$SRC" ]; then
  echo "ERROR: source file not found: $SRC" >&2
  exit 2
fi

DEST_DIR=$(dirname "$DEST")
if [ ! -d "$DEST_DIR" ]; then
  echo "Destination directory $DEST_DIR does not exist. Creating..."
  mkdir -p "$DEST_DIR"
fi

echo "Copying $SRC -> $DEST"
cp "$SRC" "$DEST"
echo "Copy complete. Destination size: $(stat -c%s "$DEST") bytes"
