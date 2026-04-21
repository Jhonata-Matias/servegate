"""RunPod Serverless handler for ComfyUI + FLUX.1-schnell.

Accepts high-level inputs ({prompt, steps, seed, width, height}), constructs
a ComfyUI workflow internally, submits to local ComfyUI server (127.0.0.1:8188),
polls until completion, retrieves the PNG and returns base64-encoded.

Models are mounted from a RunPod network volume at /runpod-volume/ComfyUI/models/.
ComfyUI is started by start.sh before this handler is invoked.

Schema:
  Input  : {"prompt": str, "steps": int=4, "seed": int=random, "width": int=1024, "height": int=1024}
  Output : {"image_b64": str, "metadata": {"seed": int, "elapsed_ms": int}}
  Error  : {"error": str, "code": int}
"""

import base64
import json
import os
import random
import sys
import time
import urllib.parse
import urllib.request
from typing import Any, Dict

import runpod

COMFY_HOST = os.environ.get("COMFY_HOST", "127.0.0.1:8188")
COMFY_BOOT_TIMEOUT_S = int(os.environ.get("COMFY_BOOT_TIMEOUT_S", "120"))
# Aligned with RunPod executionTimeoutMs (300s deploy.sh default) minus ~20s safety margin for
# HTTP overhead and worker teardown. Cold first-inference can load 23GB UNet from network volume.
COMFY_GENERATION_TIMEOUT_S = int(os.environ.get("COMFY_GENERATION_TIMEOUT_S", "280"))
COMFY_POLL_INTERVAL_S = float(os.environ.get("COMFY_POLL_INTERVAL_S", "0.25"))

DEFAULT_STEPS = 4
DEFAULT_WIDTH = 1024
DEFAULT_HEIGHT = 1024
MAX_STEPS = 50
MAX_DIM = 2048
MIN_DIM = 256


def log(level: str, message: str, **fields: Any) -> None:
    record = {"level": level, "msg": message, **fields}
    print(json.dumps(record), flush=True)


def http_get(url: str, timeout: int = 10) -> bytes:
    with urllib.request.urlopen(url, timeout=timeout) as resp:
        return resp.read()


def http_post_json(url: str, payload: Dict[str, Any], timeout: int = 30) -> Dict[str, Any]:
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def wait_for_comfy() -> None:
    deadline = time.time() + COMFY_BOOT_TIMEOUT_S
    last_err = None
    while time.time() < deadline:
        try:
            http_get(f"http://{COMFY_HOST}/system_stats", timeout=5)
            return
        except (urllib.error.URLError, ConnectionError, OSError, TimeoutError) as e:
            last_err = e
            time.sleep(0.5)
    raise RuntimeError(f"ComfyUI not reachable at {COMFY_HOST} after {COMFY_BOOT_TIMEOUT_S}s: {last_err}")


def build_workflow(prompt: str, steps: int, seed: int, width: int, height: int) -> Dict[str, Any]:
    """FLUX.1-schnell workflow matching docs/usage/comfyui-flux-quickstart.md."""
    return {
        "10": {
            "class_type": "UNETLoader",
            "inputs": {"unet_name": "flux1-schnell.safetensors", "weight_dtype": "fp8_e4m3fn"},
        },
        "11": {
            "class_type": "DualCLIPLoader",
            "inputs": {
                "clip_name1": "t5xxl_fp8_e4m3fn.safetensors",
                "clip_name2": "clip_l.safetensors",
                "type": "flux",
            },
        },
        "12": {"class_type": "VAELoader", "inputs": {"vae_name": "ae.safetensors"}},
        "13": {
            "class_type": "EmptyLatentImage",
            "inputs": {"width": width, "height": height, "batch_size": 1},
        },
        "14": {"class_type": "CLIPTextEncode", "inputs": {"text": prompt, "clip": ["11", 0]}},
        "15": {"class_type": "CLIPTextEncode", "inputs": {"text": "", "clip": ["11", 0]}},
        "16": {
            "class_type": "KSampler",
            "inputs": {
                "seed": seed,
                "steps": steps,
                "cfg": 1.0,
                "sampler_name": "euler",
                "scheduler": "simple",
                "denoise": 1.0,
                "model": ["10", 0],
                "positive": ["14", 0],
                "negative": ["15", 0],
                "latent_image": ["13", 0],
            },
        },
        "17": {"class_type": "VAEDecode", "inputs": {"samples": ["16", 0], "vae": ["12", 0]}},
        "18": {"class_type": "SaveImage", "inputs": {"images": ["17", 0], "filename_prefix": "out"}},
    }


def queue_workflow(workflow: Dict[str, Any]) -> str:
    resp = http_post_json(f"http://{COMFY_HOST}/prompt", {"prompt": workflow})
    if resp.get("node_errors"):
        raise ValueError(f"ComfyUI workflow validation errors: {resp['node_errors']}")
    pid = resp.get("prompt_id")
    if not pid:
        raise RuntimeError(f"ComfyUI did not return prompt_id: {resp}")
    return pid


_KNOWN_STATUS_STRS = frozenset({"running", "success", "error"})


def poll_history(prompt_id: str) -> Dict[str, Any]:
    deadline = time.time() + COMFY_GENERATION_TIMEOUT_S
    seen_unknown: set[str] = set()
    while time.time() < deadline:
        try:
            data = json.loads(http_get(f"http://{COMFY_HOST}/history/{prompt_id}", timeout=10))
            entry = data.get(prompt_id)
            if entry:
                status = entry.get("status", {})
                if status.get("completed") is True:
                    return entry
                if status.get("status_str") == "error":
                    raise RuntimeError(f"ComfyUI execution error: {status}")
                status_str = status.get("status_str")
                if status_str and status_str not in _KNOWN_STATUS_STRS and status_str not in seen_unknown:
                    log("warn", "unknown_status_str", prompt_id=prompt_id, status_str=status_str)
                    seen_unknown.add(status_str)
        except urllib.error.HTTPError as e:
            if e.code != 404:
                raise
        time.sleep(COMFY_POLL_INTERVAL_S)
    raise TimeoutError(
        f"ComfyUI did not complete prompt {prompt_id} within {COMFY_GENERATION_TIMEOUT_S}s"
    )


def fetch_image(filename: str, subfolder: str = "", img_type: str = "output") -> bytes:
    qs = urllib.parse.urlencode({"filename": filename, "subfolder": subfolder, "type": img_type})
    return http_get(f"http://{COMFY_HOST}/view?{qs}", timeout=30)


def extract_image_bytes(history_entry: Dict[str, Any]) -> bytes:
    outputs = history_entry.get("outputs", {})
    for _node_id, node_out in outputs.items():
        for img in node_out.get("images", []) or []:
            return fetch_image(img["filename"], img.get("subfolder", ""), img.get("type", "output"))
    raise RuntimeError("ComfyUI returned no images in history outputs")


def _coerce_optional_int(raw: Dict[str, Any], key: str, default: int) -> int:
    """None/missing → default. Explicit 0 is preserved (not coerced); range check rejects it."""
    v = raw.get(key)
    if v is None or v == "":
        return default
    return int(v)


def normalize_input(raw: Dict[str, Any]) -> Dict[str, Any]:
    if not isinstance(raw, dict):
        raise ValueError("input must be an object")
    prompt = raw.get("prompt")
    if not isinstance(prompt, str) or not prompt.strip():
        raise ValueError("input.prompt is required and must be a non-empty string")

    steps = _coerce_optional_int(raw, "steps", DEFAULT_STEPS)
    if steps < 1 or steps > MAX_STEPS:
        raise ValueError(f"input.steps must be between 1 and {MAX_STEPS}")

    width = _coerce_optional_int(raw, "width", DEFAULT_WIDTH)
    height = _coerce_optional_int(raw, "height", DEFAULT_HEIGHT)
    if not (MIN_DIM <= width <= MAX_DIM) or not (MIN_DIM <= height <= MAX_DIM):
        raise ValueError(f"input.width/height must be between {MIN_DIM} and {MAX_DIM}")
    if width % 8 != 0 or height % 8 != 0:
        raise ValueError("input.width/height must be multiples of 8")

    seed_in = raw.get("seed")
    if seed_in is None or seed_in == "":
        seed = random.randint(0, 2**31 - 1)
    else:
        seed = int(seed_in)
        if seed < 0 or seed >= 2**63:
            raise ValueError("input.seed out of valid range")

    return {"prompt": prompt.strip(), "steps": steps, "seed": seed, "width": width, "height": height}


def handler(job: Dict[str, Any]) -> Dict[str, Any]:
    job_id = job.get("id", "unknown")
    started = time.time()
    try:
        params = normalize_input(job.get("input") or {})
    except (ValueError, TypeError) as e:
        log("error", "input_validation_failed", job_id=job_id, error=str(e))
        return {"error": str(e), "code": 400}

    log("info", "job_start", job_id=job_id, **params)

    try:
        wait_for_comfy()
        workflow = build_workflow(**params)
        prompt_id = queue_workflow(workflow)
        log("info", "queued", job_id=job_id, prompt_id=prompt_id)
        history = poll_history(prompt_id)
        image_bytes = extract_image_bytes(history)
    except TimeoutError as e:
        log("error", "timeout", job_id=job_id, error=str(e))
        return {"error": str(e), "code": 504}
    except (urllib.error.URLError, ConnectionError, RuntimeError, ValueError) as e:
        log("error", "execution_failed", job_id=job_id, error=str(e), error_type=type(e).__name__)
        return {"error": str(e), "code": 500}

    elapsed_ms = int((time.time() - started) * 1000)
    image_b64 = base64.b64encode(image_bytes).decode("ascii")
    log("info", "job_complete", job_id=job_id, elapsed_ms=elapsed_ms, bytes=len(image_bytes))
    return {"image_b64": image_b64, "metadata": {"seed": params["seed"], "elapsed_ms": elapsed_ms}}


if __name__ == "__main__":
    log("info", "handler_boot", comfy_host=COMFY_HOST, python=sys.version.split()[0])
    runpod.serverless.start({"handler": handler})
