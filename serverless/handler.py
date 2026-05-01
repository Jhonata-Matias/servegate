"""RunPod Serverless handler for ComfyUI + FLUX.1-schnell.

Accepts high-level inputs ({prompt, steps, seed, width, height}), constructs
a ComfyUI workflow internally, submits to local ComfyUI server (127.0.0.1:8188),
polls until completion, retrieves the PNG and returns base64-encoded.

Models are mounted from a RunPod network volume at /runpod-volume/ComfyUI/models/.
ComfyUI is started by start.sh before this handler is invoked.

Schema:
  T2I input : {"prompt": str, "steps": int=4, "seed": int=random, "width": int=1024, "height": int=1024}
  I2I input : {"prompt": str, "input_image_b64": str, "strength": float=0.85, "steps": int=8, "seed": int=random}
  Output : {"image_b64": str, "metadata": {"seed": int, "elapsed_ms": int}}
  Error  : {"error": str, "code": int}
"""

import base64
import binascii
import io
import json
import math
import os
import random
import sys
import time
import urllib.parse
import urllib.request
import uuid
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

from PIL import Image
import runpod

COMFY_HOST = os.environ.get("COMFY_HOST", "127.0.0.1:8188")
COMFY_BOOT_TIMEOUT_S = int(os.environ.get("COMFY_BOOT_TIMEOUT_S", "120"))
# Aligned with RunPod executionTimeoutMs (300s deploy.sh default) minus ~20s safety margin for
# HTTP overhead and worker teardown. Cold first-inference can load 23GB UNet from network volume.
COMFY_GENERATION_TIMEOUT_S = int(os.environ.get("COMFY_GENERATION_TIMEOUT_S", "280"))
COMFY_POLL_INTERVAL_S = float(os.environ.get("COMFY_POLL_INTERVAL_S", "0.25"))

DEFAULT_STEPS = 4
DEFAULT_I2I_STEPS = 8
DEFAULT_STRENGTH = 0.85
DEFAULT_WIDTH = 1024
DEFAULT_HEIGHT = 1024
MAX_STEPS = 50
MIN_I2I_STEPS = 4
MAX_DIM = 2048
MIN_DIM = 256
MAX_DECODED_IMAGE_BYTES = 8 * 1024 * 1024
MAX_INPUT_PIXELS = 1_048_576
SUPPORTED_IMAGE_MIME_TYPES = frozenset({"image/png", "image/jpeg", "image/webp"})
QWEN_UNET_NAME = "qwen_image_edit_fp8_e4m3fn.safetensors"
QWEN_CLIP_NAME = "qwen_2.5_vl_7b_fp8_scaled.safetensors"
QWEN_VAE_NAME = "qwen_image_vae.safetensors"
QWEN_LIGHTNING_LORA_NAME = "qwen_image_lightning_8steps_lora.safetensors"
# ComfyUI resolves LoadImage.image against this directory. Must match COMFY_DIR in Dockerfile.
# Override via env for local testing where ComfyUI lives elsewhere.
COMFY_INPUT_DIR = os.environ.get("COMFY_INPUT_DIR", "/opt/ComfyUI/input")
LANCZOS = Image.Resampling.LANCZOS if hasattr(Image, "Resampling") else Image.LANCZOS


class InputValidationError(ValueError):
    def __init__(self, error: str, message: str):
        super().__init__(message)
        self.error = error
        self.message = message


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


def build_qwen_edit_workflow(
    prompt: str,
    input_image_filename: str,
    strength: float,
    seed: int,
    steps: int,
) -> Dict[str, Any]:
    """Qwen-Image-Edit workflow per ADR-0003.

    Class types are VERIFIED against ComfyUI v0.3.62 (pinned in Dockerfile); see
    serverless/tests/fixtures/comfyui-v0_3_62-object-info.json for the registry
    of allowed class_types + enum values. Round 3 F7 remediation replaced the 4
    non-existent 'QwenImageEdit*' loader classes with real core ComfyUI nodes
    (UNETLoader, CLIPLoader type='qwen_image', VAELoader, LoadImage) plus the
    Qwen-specific TextEncodeQwenImageEdit from comfy_extras/nodes_qwen.py for
    conditioning with image-aware encoding.

    T2I build_workflow path (FLUX.1-schnell) remains byte-identical unchanged
    per AC6; this function is purely additive on top of that contract.

    Input image is loaded from ComfyUI's input directory by basename; the
    handler() caller MUST write the decoded bytes to COMFY_INPUT_DIR before
    submitting and clean up afterward (see write_input_image / cleanup helpers).
    """
    return {
        "10": {
            "class_type": "UNETLoader",
            "inputs": {"unet_name": QWEN_UNET_NAME, "weight_dtype": "fp8_e4m3fn"},
        },
        "11": {
            "class_type": "CLIPLoader",
            "inputs": {"clip_name": QWEN_CLIP_NAME, "type": "qwen_image"},
        },
        "12": {
            "class_type": "VAELoader",
            "inputs": {"vae_name": QWEN_VAE_NAME},
        },
        "13": {
            "class_type": "LoadImage",
            "inputs": {"image": input_image_filename},
        },
        "14": {
            "class_type": "LoraLoader",
            "inputs": {
                "model": ["10", 0],
                "clip": ["11", 0],
                "lora_name": QWEN_LIGHTNING_LORA_NAME,
                "strength_model": 1.0,
                "strength_clip": 1.0,
            },
        },
        "15": {
            "class_type": "VAEEncode",
            "inputs": {"pixels": ["13", 0], "vae": ["12", 0]},
        },
        "16": {
            "class_type": "TextEncodeQwenImageEdit",
            "inputs": {
                "clip": ["14", 1],
                "prompt": prompt,
                "vae": ["12", 0],
                "image": ["13", 0],
            },
        },
        "17": {
            "class_type": "TextEncodeQwenImageEdit",
            "inputs": {
                "clip": ["14", 1],
                "prompt": "",
                "vae": ["12", 0],
                "image": ["13", 0],
            },
        },
        "18": {
            "class_type": "KSampler",
            "inputs": {
                "seed": seed,
                "steps": steps,
                "cfg": 1.0,
                "sampler_name": "euler",
                "scheduler": "simple",
                "denoise": strength,
                "model": ["14", 0],
                "positive": ["16", 0],
                "negative": ["17", 0],
                "latent_image": ["15", 0],
            },
        },
        "19": {
            "class_type": "VAEDecode",
            "inputs": {"samples": ["18", 0], "vae": ["12", 0]},
        },
        "20": {"class_type": "SaveImage", "inputs": {"images": ["19", 0], "filename_prefix": "qwen-edit"}},
    }


def write_input_image_to_comfy(image_b64: str) -> str:
    """Decode base64 and write to ComfyUI's input directory; return the basename.

    ComfyUI's LoadImage node resolves filenames relative to its input dir. We
    use a uuid4-prefixed name to avoid collisions across concurrent requests
    and to make cleanup safe. Caller MUST invoke cleanup_input_image() after
    workflow completes (success or failure) — see handler() try/finally.
    """
    decoded = base64.b64decode(image_b64)
    filename = f"qwen-edit-{uuid.uuid4().hex}.png"
    target_dir = Path(COMFY_INPUT_DIR)
    target_dir.mkdir(parents=True, exist_ok=True)
    (target_dir / filename).write_bytes(decoded)
    return filename


def cleanup_input_image(filename: Optional[str]) -> None:
    """Best-effort cleanup of per-request input image. Never raises."""
    if not filename:
        return
    try:
        (Path(COMFY_INPUT_DIR) / filename).unlink(missing_ok=True)
    except OSError as e:
        # Log but don't fail — tempfile leak is recoverable; failing the
        # response over cleanup would mask the real outcome.
        log("warn", "input_image_cleanup_failed", filename=filename, error_type=type(e).__name__)


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


def _coerce_optional_float(raw: Dict[str, Any], key: str, default: float) -> float:
    v = raw.get(key)
    if v is None or v == "":
        return default
    return float(v)


def _normalize_prompt(raw: Dict[str, Any]) -> str:
    prompt = raw.get("prompt")
    if not isinstance(prompt, str) or not prompt.strip():
        raise ValueError("input.prompt is required and must be a non-empty string")
    return prompt.strip()


def _normalize_seed(raw: Dict[str, Any]) -> int:
    seed_in = raw.get("seed")
    if seed_in is None or seed_in == "":
        return random.randint(0, 2**31 - 1)
    seed = int(seed_in)
    if seed < 0 or seed >= 2**63:
        raise ValueError("input.seed out of valid range")
    return seed


def _strip_image_data_uri(value: str) -> str:
    if value.startswith("data:"):
        header, sep, payload = value.partition(",")
        if not sep or ";base64" not in header:
            raise InputValidationError("invalid_image_base64", "input_image_b64 data URI must be base64 encoded")
        return payload
    return value


def _decode_image_b64(value: Any) -> bytes:
    if not isinstance(value, str) or not value.strip():
        raise InputValidationError("invalid_image_base64", "input_image_b64 is required and must be a base64 string")
    compact = "".join(_strip_image_data_uri(value.strip()).split())
    try:
        decoded = base64.b64decode(compact, validate=True)
    except (binascii.Error, ValueError) as e:
        raise InputValidationError("invalid_image_base64", "input_image_b64 must be valid base64") from e
    if len(decoded) > MAX_DECODED_IMAGE_BYTES:
        raise InputValidationError(
            "image_too_large",
            f"input_image_b64 decoded payload must be <= {MAX_DECODED_IMAGE_BYTES} bytes",
        )
    return decoded


def _detect_image_mime(image_bytes: bytes) -> str:
    if image_bytes.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if image_bytes.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if image_bytes.startswith(b"RIFF") and image_bytes[8:12] == b"WEBP":
        return "image/webp"
    raise InputValidationError("unsupported_mime_type", "input image must be PNG, JPEG, or WebP")


def _image_to_png_b64(image: Image.Image) -> str:
    out = io.BytesIO()
    mode = "RGBA" if image.mode in {"RGBA", "LA"} or "transparency" in image.info else "RGB"
    image.convert(mode).save(out, format="PNG")
    return base64.b64encode(out.getvalue()).decode("ascii")


def _normalize_i2i_image(value: Any) -> Dict[str, Any]:
    image_bytes = _decode_image_b64(value)
    mime_type = _detect_image_mime(image_bytes)

    try:
        with Image.open(io.BytesIO(image_bytes)) as img:
            img.load()
            source_width, source_height = img.size
            if source_width == source_height:
                raise InputValidationError(
                    "invalid_aspect_ratio",
                    "Qwen-Image-Edit rejects exact 1:1 input images; use a non-square crop",
                )

            input_width = source_width
            input_height = source_height
            downsampled = False
            normalized_b64 = base64.b64encode(image_bytes).decode("ascii")

            if source_width * source_height > MAX_INPUT_PIXELS:
                scale = math.sqrt(MAX_INPUT_PIXELS / float(source_width * source_height))
                input_width = max(1, int(source_width * scale))
                input_height = max(1, int(source_height * scale))
                while input_width * input_height > MAX_INPUT_PIXELS:
                    if input_width >= input_height:
                        input_width -= 1
                    else:
                        input_height -= 1
                resized = img.resize((input_width, input_height), LANCZOS)
                normalized_b64 = _image_to_png_b64(resized)
                mime_type = "image/png"
                downsampled = True
    except InputValidationError:
        raise
    except Exception as e:
        raise InputValidationError("invalid_image", "input_image_b64 must decode to a readable image") from e

    return {
        "input_image_b64": normalized_b64,
        "input_mime_type": mime_type,
        "input_width": input_width,
        "input_height": input_height,
        "source_width": source_width,
        "source_height": source_height,
        "input_downsampled": downsampled,
    }


def _normalize_i2i_input(raw: Dict[str, Any], prompt: str, seed: int) -> Dict[str, Any]:
    if "width" in raw or "height" in raw:
        raise InputValidationError(
            "invalid_i2i_parameters",
            "input.width and input.height are not accepted for edit jobs; source image dimensions are used",
        )

    steps = _coerce_optional_int(raw, "steps", DEFAULT_I2I_STEPS)
    if steps < MIN_I2I_STEPS or steps > MAX_STEPS:
        raise InputValidationError("invalid_steps", f"input.steps must be between {MIN_I2I_STEPS} and {MAX_STEPS}")

    strength = _coerce_optional_float(raw, "strength", DEFAULT_STRENGTH)
    if strength <= 0.0 or strength > 1.0:
        raise InputValidationError("invalid_strength", "input.strength must be > 0.0 and <= 1.0")

    image = _normalize_i2i_image(raw.get("input_image_b64"))
    return {"prompt": prompt, "steps": steps, "seed": seed, "strength": strength, **image}


def i2i_params(params: Dict[str, Any], input_image_filename: str) -> Dict[str, Any]:
    """Build the kwargs for build_qwen_edit_workflow().

    input_image_filename is the basename ComfyUI's LoadImage will resolve
    against COMFY_INPUT_DIR — NOT the base64 payload, which we've already
    persisted via write_input_image_to_comfy() before calling this.
    """
    return {
        "prompt": params["prompt"],
        "input_image_filename": input_image_filename,
        "strength": params["strength"],
        "seed": params["seed"],
        "steps": params["steps"],
    }


def safe_log_fields(params: Dict[str, Any]) -> Dict[str, Any]:
    if "input_image_b64" in params:
        return {
            "mode": "i2i",
            "seed": params["seed"],
            "steps": params["steps"],
            "strength": params["strength"],
            "input_width": params["input_width"],
            "input_height": params["input_height"],
            "input_mime_type": params["input_mime_type"],
            "input_downsampled": params["input_downsampled"],
        }
    return {
        "mode": "t2i",
        "seed": params["seed"],
        "steps": params["steps"],
        "width": params["width"],
        "height": params["height"],
    }


def resize_output_to_input(image_bytes: bytes, width: int, height: int) -> Tuple[bytes, Dict[str, int]]:
    with Image.open(io.BytesIO(image_bytes)) as img:
        img.load()
        qwen_width, qwen_height = img.size
        output = img if (qwen_width, qwen_height) == (width, height) else img.resize((width, height), LANCZOS)
        out = io.BytesIO()
        output.save(out, format="PNG")
    return out.getvalue(), {
        "qwen_generated_width": qwen_width,
        "qwen_generated_height": qwen_height,
        "output_width": width,
        "output_height": height,
    }


def normalize_input(raw: Dict[str, Any]) -> Dict[str, Any]:
    if not isinstance(raw, dict):
        raise ValueError("input must be an object")
    prompt = _normalize_prompt(raw)
    seed = _normalize_seed(raw)

    if "input_image_b64" in raw:
        return _normalize_i2i_input(raw, prompt, seed)

    steps = _coerce_optional_int(raw, "steps", DEFAULT_STEPS)
    if steps < 1 or steps > MAX_STEPS:
        raise ValueError(f"input.steps must be between 1 and {MAX_STEPS}")

    width = _coerce_optional_int(raw, "width", DEFAULT_WIDTH)
    height = _coerce_optional_int(raw, "height", DEFAULT_HEIGHT)
    if not (MIN_DIM <= width <= MAX_DIM) or not (MIN_DIM <= height <= MAX_DIM):
        raise ValueError(f"input.width/height must be between {MIN_DIM} and {MAX_DIM}")
    if width % 8 != 0 or height % 8 != 0:
        raise ValueError("input.width/height must be multiples of 8")

    return {"prompt": prompt, "steps": steps, "seed": seed, "width": width, "height": height}


def handler(job: Dict[str, Any]) -> Dict[str, Any]:
    job_id = job.get("id", "unknown")
    started = time.time()
    try:
        params = normalize_input(job.get("input") or {})
    except InputValidationError as e:
        log("error", "input_validation_failed", job_id=job_id, error=e.error)
        return {"error": e.error, "message": e.message, "code": 400}
    except (ValueError, TypeError) as e:
        log("error", "input_validation_failed", job_id=job_id, error=str(e))
        return {"error": str(e), "code": 400}

    is_i2i = "input_image_b64" in params
    log("info", "job_start", job_id=job_id, **safe_log_fields(params))

    input_image_filename: Optional[str] = None
    try:
        wait_for_comfy()
        if is_i2i:
            # Round 3 F7 remediation: LoadImage resolves filenames against ComfyUI's
            # input dir, so persist the decoded bytes there (unique per-request) and
            # pass only the basename into the workflow graph. Cleanup in finally.
            input_image_filename = write_input_image_to_comfy(params["input_image_b64"])
            workflow = build_qwen_edit_workflow(**i2i_params(params, input_image_filename))
        else:
            # ADR-0003: T2I path is byte-identical unchanged per AC6.
            workflow = build_workflow(**params)
        prompt_id = queue_workflow(workflow)
        log("info", "queued", job_id=job_id, prompt_id=prompt_id)
        history = poll_history(prompt_id)
        image_bytes = extract_image_bytes(history)
        output_meta: Dict[str, Any] = {}
        if is_i2i:
            image_bytes, output_meta = resize_output_to_input(
                image_bytes,
                params["input_width"],
                params["input_height"],
            )
    except TimeoutError as e:
        # F1 mitigation: keep details in logs only; return stable user-facing code (QA gate 3.1 Round 1).
        log("error", "timeout", job_id=job_id, error_type=type(e).__name__, error_details=str(e))
        return {"error": "generation_timeout", "code": 504}
    except (urllib.error.URLError, ConnectionError, RuntimeError, ValueError, OSError) as e:
        # F1 mitigation: generic error code surface; diagnostic details stay in structured logs.
        # OSError added: write_input_image_to_comfy may raise on disk/permission issues.
        log("error", "execution_failed", job_id=job_id, error_type=type(e).__name__, error_details=str(e))
        return {"error": "generation_error", "code": 500}
    finally:
        cleanup_input_image(input_image_filename)

    elapsed_ms = int((time.time() - started) * 1000)
    image_b64 = base64.b64encode(image_bytes).decode("ascii")
    log("info", "job_complete", job_id=job_id, elapsed_ms=elapsed_ms, bytes=len(image_bytes))
    metadata = {"seed": params["seed"], "elapsed_ms": elapsed_ms, **output_meta}
    if is_i2i:
        metadata.update(
            {
                "input_width": params["input_width"],
                "input_height": params["input_height"],
                "source_width": params["source_width"],
                "source_height": params["source_height"],
                "input_downsampled": params["input_downsampled"],
            }
        )
    return {"image_b64": image_b64, "metadata": metadata}


if __name__ == "__main__":
    log("info", "handler_boot", comfy_host=COMFY_HOST, python=sys.version.split()[0])
    runpod.serverless.start({"handler": handler})
