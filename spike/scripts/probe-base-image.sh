#!/usr/bin/env bash
# Probe a PyTorch Docker base image for torch version and enable_gqa support.
#
# Usage example:
#   ./spike/scripts/probe-base-image.sh
#
# Exit codes:
#   0   torch >= 2.5 AND scaled_dot_product_attention accepts enable_gqa.
#   1   torch < 2.5 OR enable_gqa not supported.
#   2   docker daemon error, pull failed, or container exec failed.
#   3   bad CLI usage.
#
# Limitation: This probe validates ONLY the base image. It does NOT catch torch
# downgrades introduced by the Dockerfile's `pip install` layer (diffusers,
# transformers, accelerate). If the base passes here but the spike still fails
# with the same error, suspect the pip stack.
#
# Reviewer note: run `chmod +x spike/scripts/probe-base-image.sh` after creation.

set -euo pipefail

DEFAULT_IMAGE="pytorch/pytorch:2.6.0-cuda12.4-cudnn9-devel"

usage() {
  cat <<'USAGE'
Usage: spike/scripts/probe-base-image.sh [-h|--help] [--no-pull] [--json] [<image-tag>]

Probe a PyTorch Docker base image for torch version + scaled_dot_product_attention(enable_gqa) support.

Arguments:
  <image-tag>     Override the default image tag. Defaults to the value
                  matched to spike/Dockerfile's FROM line:
                  pytorch/pytorch:2.6.0-cuda12.4-cudnn9-devel

Options:
  -h, --help      Show this help and exit.
  --no-pull       Skip docker pull (use locally cached layer if present).
  --json          Emit only the JSON result on stdout (suppress human-readable framing).

Exit codes:
  0   torch >= 2.5 AND scaled_dot_product_attention accepts the enable_gqa kwarg.
  1   torch < 2.5 OR enable_gqa not supported (image is unfit for diffusers 0.36 Wan).
  2   docker daemon error, pull failed, or container exec failed.
  3   bad CLI usage.

Examples:
  ./spike/scripts/probe-base-image.sh
  ./spike/scripts/probe-base-image.sh --no-pull
  ./spike/scripts/probe-base-image.sh nvcr.io/nvidia/pytorch:25.01-py3
  ./spike/scripts/probe-base-image.sh --json | jq .
USAGE
}

log() {
  if [[ "$json_only" == "false" ]]; then
    printf '%s\n' "$*" >&2
  fi
}

die_usage() {
  printf 'error: %s\n\n' "$1" >&2
  usage >&2
  exit 3
}

json_only=false
pull_image=true
image=""

while (($# > 0)); do
  case "$1" in
    -h|--help)
      usage
      exit 0
      ;;
    --no-pull)
      pull_image=false
      shift
      ;;
    --json)
      json_only=true
      shift
      ;;
    --)
      shift
      if (($# > 1)); then
        die_usage "expected at most one image tag"
      fi
      if (($# == 1)); then
        image="$1"
        shift
      fi
      ;;
    -*)
      die_usage "unknown option: $1"
      ;;
    *)
      if [[ -n "$image" ]]; then
        die_usage "expected at most one image tag"
      fi
      image="$1"
      shift
      ;;
  esac
done

if [[ -z "$image" ]]; then
  image="$DEFAULT_IMAGE"
fi

if ! command -v docker >/dev/null 2>&1; then
  printf 'error: docker is not on PATH; install Docker or load an environment with docker available.\n' >&2
  exit 2
fi

if [[ "$pull_image" == "true" ]]; then
  log "Pulling Docker image: $image"
  if ! docker pull "$image" >&2; then
    printf 'error: docker pull failed for image: %s\n' "$image" >&2
    exit 2
  fi
fi

read -r -d '' DIAGNOSTIC <<'PY' || true
import inspect
import json
import sys

image = sys.argv[1]

try:
    import torch

    def sdpa_accepts_enable_gqa(sdpa):
        try:
            return "enable_gqa" in inspect.signature(sdpa).parameters
        except (TypeError, ValueError):
            query = torch.zeros(1, 1, 1, 1)
            key = torch.zeros(1, 1, 1, 1)
            value = torch.zeros(1, 1, 1, 1)
            try:
                sdpa(query, key, value, enable_gqa=True)
                return True
            except TypeError:
                return False

    torch_version = torch.__version__
    public_version = torch_version.split("+", 1)[0]
    version_parts = public_version.split(".")
    major = int(version_parts[0]) if len(version_parts) > 0 and version_parts[0].isdigit() else None
    minor = int(version_parts[1]) if len(version_parts) > 1 and version_parts[1].isdigit() else None
    torch_major_minor = [major, minor]

    sdpa = torch.nn.functional.scaled_dot_product_attention
    sdpa_supports_enable_gqa = sdpa_accepts_enable_gqa(sdpa)
    version_fit = major is not None and minor is not None and (major, minor) >= (2, 5)
    fit = version_fit and sdpa_supports_enable_gqa
    verdict = "FIT" if fit else "UNFIT"

    result = {
        "image": image,
        "torch_version": torch_version,
        "torch_major_minor": torch_major_minor,
        "torch_cuda_version": torch.version.cuda,
        "cuda_available": torch.cuda.is_available(),
        "sdpa_supports_enable_gqa": sdpa_supports_enable_gqa,
        "verdict": verdict,
    }
except Exception:
    result = {
        "image": image,
        "torch_version": None,
        "torch_major_minor": None,
        "torch_cuda_version": None,
        "cuda_available": None,
        "sdpa_supports_enable_gqa": False,
        "verdict": "UNKNOWN",
    }
    print(json.dumps(result, sort_keys=True))
    sys.exit(2)

print(json.dumps(result, sort_keys=True))
sys.exit(0 if fit else 1)
PY

log "Running torch diagnostic in image: $image"
set +e
result_json="$(docker run --rm "$image" python3 -c "$DIAGNOSTIC" "$image")"
run_status=$?
set -e

if [[ "$run_status" -ne 0 && "$run_status" -ne 1 ]]; then
  if [[ -n "$result_json" ]]; then
    printf '%s\n' "$result_json" >&2
  fi
  printf 'error: docker run or in-container diagnostic failed for image: %s\n' "$image" >&2
  exit 2
fi

# Extract only the JSON line. Container entrypoints (e.g. NVIDIA CUDA images)
# print license banners and warnings to stdout BEFORE the diagnostic runs; that
# noise would corrupt jq/json.tool parsing downstream. Our diagnostic emits a
# single-line `{...}` via json.dumps without indent, so grab the last line
# starting with '{'.
result_json_only="$(printf '%s\n' "$result_json" | grep -E '^\{' | tail -n 1 || true)"
if [[ -z "$result_json_only" ]]; then
  printf 'error: no JSON line captured from container output; raw stdout follows:\n' >&2
  printf '%s\n' "$result_json" >&2
  exit 2
fi

if [[ "$json_only" == "true" ]]; then
  printf '%s\n' "$result_json_only"
else
  printf 'PyTorch base image probe\n' >&2
  printf 'Image: %s\n\n' "$image" >&2
  if command -v jq >/dev/null 2>&1; then
    printf '%s\n' "$result_json_only" | jq .
  elif command -v python3 >/dev/null 2>&1; then
    printf '%s\n' "$result_json_only" | python3 -m json.tool
  else
    printf '%s\n' "$result_json_only"
  fi

  if [[ "$run_status" -eq 0 ]]; then
    printf '\nVerdict: FIT - torch >= 2.5 and enable_gqa is supported.\n' >&2
  else
    printf '\nVerdict: UNFIT - torch < 2.5 or enable_gqa is not supported.\n' >&2
  fi
fi

exit "$run_status"
