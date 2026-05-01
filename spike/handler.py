"""RunPod Serverless spike handler for LTX-Video 2B.

Purpose: collect empirical evidence for ADR-0005 v1.2 before accepting it.

Measures:
  - cold model-load time inside the worker
  - warm generation latency for 704x512-ish 5s clips
  - per-call compute cost estimate from observed GPU seconds
  - visual-review artifacts for representative product prompts

RunPod's /status delayTime/executionTime remains the source of truth for
platform-level cold start and billing reconciliation. This handler adds
in-worker timings and returns an MP4 so reviewers can score quality.
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import inspect
import io
import json
import os
import platform
import random
import sys
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import runpod
import diffusers
import torch
from diffusers import LTXConditionPipeline, LTXPipeline
from diffusers.utils import export_to_video
from huggingface_hub import hf_hub_download
from PIL import Image, UnidentifiedImageError


PROCESS_STARTED_AT = time.time()

MODEL_ID = os.environ.get("MODEL_ID", "Lightricks/LTX-Video")
MODEL_FILE = os.environ.get("MODEL_FILE", "ltxv-2b-0.9.8-distilled.safetensors")
MODEL_LOADING_PATH = os.environ.get("MODEL_LOADING_PATH", "single_file").strip().lower()
MODEL_CACHE_DIR = os.environ.get("MODEL_CACHE_DIR", "/runpod-volume/hf-cache")
OUTPUT_DIR = os.environ.get("OUTPUT_DIR", "/tmp/ltx-video-spike")
TORCH_DTYPE = os.environ.get("TORCH_DTYPE", "bfloat16")
ENABLE_CPU_OFFLOAD = os.environ.get("ENABLE_CPU_OFFLOAD", "0") == "1"
RETURN_VIDEO_B64_DEFAULT = os.environ.get("RETURN_VIDEO_B64_DEFAULT", "1") != "0"
GPU_PRICE_PER_HOUR_USD = os.environ.get("GPU_PRICE_PER_HOUR_USD")

DEFAULT_WIDTH = int(os.environ.get("DEFAULT_WIDTH", "704"))
DEFAULT_HEIGHT = int(os.environ.get("DEFAULT_HEIGHT", "512"))
DEFAULT_NUM_FRAMES = int(os.environ.get("DEFAULT_NUM_FRAMES", "121"))
DEFAULT_FPS = int(os.environ.get("DEFAULT_FPS", "24"))
DEFAULT_STEPS = int(os.environ.get("DEFAULT_STEPS", "30"))
DEFAULT_GUIDANCE_SCALE = float(os.environ.get("DEFAULT_GUIDANCE_SCALE", "3.0"))
DEFAULT_DECODE_TIMESTEP = float(os.environ.get("DEFAULT_DECODE_TIMESTEP", "0.05"))
DEFAULT_DECODE_NOISE_SCALE = float(os.environ.get("DEFAULT_DECODE_NOISE_SCALE", "0.025"))
DEFAULT_NEGATIVE_PROMPT = os.environ.get(
    "DEFAULT_NEGATIVE_PROMPT",
    "worst quality, inconsistent motion, blurry, jittery, distorted, deformed, text, subtitles, watermark",
)

MAX_PROMPT_CHARS = 2_000
MAX_NEGATIVE_PROMPT_CHARS = 2_000
MIN_DIM = 256
MAX_DIM = 1280
MAX_FRAMES = 121
MAX_STEPS = 80
MAX_IMAGE_BYTES = 12 * 1024 * 1024
MAX_INLINE_VIDEO_BYTES = 14 * 1024 * 1024

_PIPE: LTXPipeline | LTXConditionPipeline | None = None
_PIPE_KIND: str | None = None
_MODEL_LOAD_MS: int | None = None
_JOBS_SERVED = 0


class InputValidationError(ValueError):
    pass


@dataclass(frozen=True)
class NormalizedInput:
    prompt: str
    prompt_sha256: str
    negative_prompt: str
    width: int
    height: int
    num_frames: int
    fps: int
    num_inference_steps: int
    guidance_scale: float
    seed: int
    return_video_b64: bool
    input_image: Image.Image | None
    input_image_sha256: str | None
    benchmark_label: str | None

    @property
    def mode(self) -> str:
        return "i2v" if self.input_image is not None else "t2v"


def elapsed_ms(start: float) -> int:
    return int((time.time() - start) * 1000)


def log(level: str, message: str, **fields: Any) -> None:
    print(json.dumps({"level": level, "msg": message, **fields}), flush=True)


def torch_dtype() -> torch.dtype:
    if TORCH_DTYPE == "float16":
        return torch.float16
    if TORCH_DTYPE == "float32":
        return torch.float32
    return torch.bfloat16


def coerce_int(raw: dict[str, Any], key: str, default: int, min_value: int, max_value: int) -> int:
    value = raw.get(key, default)
    if isinstance(value, bool):
        raise InputValidationError(f"input.{key} must be an integer")
    try:
        parsed = int(value)
    except (TypeError, ValueError) as exc:
        raise InputValidationError(f"input.{key} must be an integer") from exc
    if parsed < min_value or parsed > max_value:
        raise InputValidationError(f"input.{key} must be between {min_value} and {max_value}")
    return parsed


def coerce_float(raw: dict[str, Any], key: str, default: float, min_value: float, max_value: float) -> float:
    value = raw.get(key, default)
    if isinstance(value, bool):
        raise InputValidationError(f"input.{key} must be a number")
    try:
        parsed = float(value)
    except (TypeError, ValueError) as exc:
        raise InputValidationError(f"input.{key} must be a number") from exc
    if parsed < min_value or parsed > max_value:
        raise InputValidationError(f"input.{key} must be between {min_value} and {max_value}")
    return parsed


def coerce_bool(raw: dict[str, Any], key: str, default: bool) -> bool:
    value = raw.get(key, default)
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"1", "true", "yes", "on"}:
            return True
        if normalized in {"0", "false", "no", "off"}:
            return False
    raise InputValidationError(f"input.{key} must be a boolean")


def normalize_prompt(raw: dict[str, Any], key: str, default: str | None = None) -> str:
    value = raw.get(key, default)
    if not isinstance(value, str):
        raise InputValidationError(f"input.{key} must be a string")
    value = value.strip()
    if not value:
        raise InputValidationError(f"input.{key} is required")
    limit = MAX_NEGATIVE_PROMPT_CHARS if key == "negative_prompt" else MAX_PROMPT_CHARS
    if len(value) > limit:
        raise InputValidationError(f"input.{key} must be <= {limit} characters")
    return value


def strip_data_url(image_b64: str) -> str:
    if image_b64.startswith("data:"):
        _, _, payload = image_b64.partition(",")
        return payload
    return image_b64


def decode_input_image(raw: dict[str, Any]) -> tuple[Image.Image | None, str | None]:
    value = raw.get("input_image_b64")
    if value is None:
        return None, None
    if not isinstance(value, str) or not value.strip():
        raise InputValidationError("input.input_image_b64 must be a non-empty base64 string")
    try:
        image_bytes = base64.b64decode(strip_data_url(value.strip()), validate=True)
    except (binascii.Error, ValueError) as exc:
        raise InputValidationError("input.input_image_b64 must be valid base64") from exc
    if len(image_bytes) > MAX_IMAGE_BYTES:
        raise InputValidationError(f"input.input_image_b64 decoded bytes must be <= {MAX_IMAGE_BYTES}")
    try:
        image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        image.load()
    except (UnidentifiedImageError, OSError) as exc:
        raise InputValidationError("input.input_image_b64 must decode to a readable image") from exc
    return image, hashlib.sha256(image_bytes).hexdigest()


def normalize_input(raw: Any) -> NormalizedInput:
    if not isinstance(raw, dict):
        raise InputValidationError("input must be an object")

    prompt = normalize_prompt(raw, "prompt")
    negative_prompt = normalize_prompt(raw, "negative_prompt", DEFAULT_NEGATIVE_PROMPT)
    width = coerce_int(raw, "width", DEFAULT_WIDTH, MIN_DIM, MAX_DIM)
    height = coerce_int(raw, "height", DEFAULT_HEIGHT, MIN_DIM, MAX_DIM)
    if width % 32 != 0 or height % 32 != 0:
        raise InputValidationError("input.width and input.height must be multiples of 32")

    num_frames = coerce_int(raw, "num_frames", DEFAULT_NUM_FRAMES, 1, MAX_FRAMES)
    if num_frames != 1 and (num_frames - 1) % 8 != 0:
        raise InputValidationError("input.num_frames must be 1 or satisfy (num_frames - 1) % 8 == 0")

    seed = coerce_int(raw, "seed", random.randint(0, 2**31 - 1), 0, 2**31 - 1)
    input_image, input_image_sha256 = decode_input_image(raw)
    return_video_b64 = coerce_bool(raw, "return_video_b64", RETURN_VIDEO_B64_DEFAULT)
    benchmark_label = raw.get("benchmark_label")
    if benchmark_label is not None and not isinstance(benchmark_label, str):
        raise InputValidationError("input.benchmark_label must be a string when provided")

    return NormalizedInput(
        prompt=prompt,
        prompt_sha256=hashlib.sha256(prompt.encode("utf-8")).hexdigest(),
        negative_prompt=negative_prompt,
        width=width,
        height=height,
        num_frames=num_frames,
        fps=coerce_int(raw, "fps", DEFAULT_FPS, 1, 60),
        num_inference_steps=coerce_int(raw, "num_inference_steps", DEFAULT_STEPS, 1, MAX_STEPS),
        guidance_scale=coerce_float(raw, "guidance_scale", DEFAULT_GUIDANCE_SCALE, 0.0, 20.0),
        seed=seed,
        return_video_b64=return_video_b64,
        input_image=input_image,
        input_image_sha256=input_image_sha256,
        benchmark_label=benchmark_label,
    )


def gpu_metadata() -> dict[str, Any]:
    if not torch.cuda.is_available():
        return {"cuda_available": False}
    device_index = torch.cuda.current_device()
    props = torch.cuda.get_device_properties(device_index)
    return {
        "cuda_available": True,
        "gpu_name": props.name,
        "gpu_total_memory_gb": round(props.total_memory / (1024**3), 2),
        "cuda_device": device_index,
        "torch_cuda_version": torch.version.cuda,
        "max_memory_allocated_gb": round(torch.cuda.max_memory_allocated(device_index) / (1024**3), 3),
        "max_memory_reserved_gb": round(torch.cuda.max_memory_reserved(device_index) / (1024**3), 3),
    }


def maybe_estimated_cost(total_ms: int) -> dict[str, Any]:
    if not GPU_PRICE_PER_HOUR_USD:
        return {
            "gpu_seconds": round(total_ms / 1000, 3),
            "estimated_compute_cost_usd": None,
            "cost_note": "Set GPU_PRICE_PER_HOUR_USD per endpoint to estimate; reconcile real cost in RunPod billing.",
        }
    price = float(GPU_PRICE_PER_HOUR_USD)
    gpu_seconds = total_ms / 1000
    return {
        "gpu_seconds": round(gpu_seconds, 3),
        "gpu_price_per_hour_usd": price,
        "estimated_compute_cost_usd": round((gpu_seconds / 3600) * price, 6),
        "cost_note": "Estimate only; RunPod billing dashboard/API remains source of truth.",
    }


def unload_pipeline() -> None:
    global _PIPE, _PIPE_KIND, _MODEL_LOAD_MS
    _PIPE = None
    _PIPE_KIND = None
    _MODEL_LOAD_MS = None
    if torch.cuda.is_available():
        torch.cuda.empty_cache()


def resolve_model_file() -> str:
    candidate = Path(MODEL_FILE)
    if candidate.exists():
        return str(candidate)

    return hf_hub_download(
        repo_id=MODEL_ID,
        filename=MODEL_FILE,
        cache_dir=MODEL_CACHE_DIR,
    )


def load_pipeline(kind: str) -> tuple[LTXPipeline | LTXConditionPipeline, bool, int]:
    global _PIPE, _PIPE_KIND, _MODEL_LOAD_MS
    if _PIPE is not None and _PIPE_KIND == kind and _MODEL_LOAD_MS is not None:
        return _PIPE, False, _MODEL_LOAD_MS

    if _PIPE is not None and _PIPE_KIND != kind:
        unload_pipeline()

    start = time.time()
    dtype = torch_dtype()
    Path(MODEL_CACHE_DIR).mkdir(parents=True, exist_ok=True)

    log(
        "info",
        "model_load_start",
        model_id=MODEL_ID,
        model_file=MODEL_FILE,
        model_loading_path=MODEL_LOADING_PATH,
        pipeline_kind=kind,
        dtype=str(dtype),
    )

    pipeline_cls = LTXConditionPipeline if kind == "i2v" else LTXPipeline
    if MODEL_LOADING_PATH == "pretrained":
        pipe = pipeline_cls.from_pretrained(
            MODEL_ID,
            torch_dtype=dtype,
            cache_dir=MODEL_CACHE_DIR,
        )
        resolved_model_file = None
    else:
        resolved_model_file = resolve_model_file()
        pipe = pipeline_cls.from_single_file(
            resolved_model_file,
            torch_dtype=dtype,
            cache_dir=MODEL_CACHE_DIR,
        )

    if kind == "i2v":
        # Workaround for upstream bug in diffusers 0.37.1: LTXConditionPipeline.__call__()
        # does not invoke calculate_shift() before scheduler.set_timesteps(), causing
        # "mu must be passed when use_dynamic_shifting is True" error. Disabling dynamic
        # shifting bypasses this; T2V (LTXPipeline) is unaffected. See Story 5.1.1.3.
        pipe.scheduler.register_to_config(use_dynamic_shifting=False)

    if hasattr(pipe, "vae") and hasattr(pipe.vae, "enable_tiling"):
        pipe.vae.enable_tiling()

    if ENABLE_CPU_OFFLOAD:
        pipe.enable_model_cpu_offload()
    else:
        pipe.to("cuda")

    _PIPE = pipe
    _PIPE_KIND = kind
    _MODEL_LOAD_MS = elapsed_ms(start)
    log(
        "info",
        "model_load_complete",
        pipeline_kind=kind,
        model_load_ms=_MODEL_LOAD_MS,
        resolved_model_file=resolved_model_file,
        **gpu_metadata(),
    )
    return pipe, True, _MODEL_LOAD_MS


def build_pipeline_call_kwargs(params: NormalizedInput, generator: torch.Generator) -> dict[str, Any]:
    call_kwargs: dict[str, Any] = {
        "prompt": params.prompt,
        "negative_prompt": params.negative_prompt,
        "height": params.height,
        "width": params.width,
        "num_frames": params.num_frames,
        "guidance_scale": params.guidance_scale,
        "num_inference_steps": params.num_inference_steps,
        "decode_timestep": DEFAULT_DECODE_TIMESTEP,
        "decode_noise_scale": DEFAULT_DECODE_NOISE_SCALE,
        "generator": generator,
    }
    if params.input_image is not None:
        call_kwargs["image"] = params.input_image
    return call_kwargs


def generate_video(params: NormalizedInput) -> tuple[Path, dict[str, Any]]:
    pipe, model_was_loaded, model_load_ms = load_pipeline(params.mode)

    generator = torch.Generator(device="cuda").manual_seed(params.seed)
    call_kwargs = build_pipeline_call_kwargs(params, generator)

    if torch.cuda.is_available():
        torch.cuda.reset_peak_memory_stats()

    inference_started = time.time()
    with torch.inference_mode():
        frames = pipe(**call_kwargs).frames[0]
    inference_ms = elapsed_ms(inference_started)

    export_started = time.time()
    Path(OUTPUT_DIR).mkdir(parents=True, exist_ok=True)
    fd, output_name = tempfile.mkstemp(prefix="ltx-video-", suffix=".mp4", dir=OUTPUT_DIR)
    os.close(fd)
    output_path = Path(output_name)
    export_to_video(frames, str(output_path), fps=params.fps)
    export_ms = elapsed_ms(export_started)

    return output_path, {
        "model_was_loaded": model_was_loaded,
        "model_load_ms": model_load_ms,
        "inference_ms": inference_ms,
        "export_ms": export_ms,
        **gpu_metadata(),
    }


def handler(job: dict[str, Any]) -> dict[str, Any]:
    global _JOBS_SERVED
    received_at = time.time()
    job_id = str(job.get("id", "unknown"))
    first_job_in_process = _JOBS_SERVED == 0

    try:
        params = normalize_input(job.get("input") or {})
    except InputValidationError as exc:
        log("error", "input_validation_failed", job_id=job_id, error=str(exc))
        return {"error": "invalid_input", "message": str(exc), "code": 400}

    log(
        "info",
        "job_start",
        job_id=job_id,
        mode=params.mode,
        prompt_sha256=params.prompt_sha256,
        benchmark_label=params.benchmark_label,
        seed=params.seed,
        width=params.width,
        height=params.height,
        num_frames=params.num_frames,
        steps=params.num_inference_steps,
    )

    output_path: Path | None = None
    try:
        output_path, timing = generate_video(params)
        video_bytes = output_path.read_bytes()
        if params.return_video_b64 and len(video_bytes) > MAX_INLINE_VIDEO_BYTES:
            raise RuntimeError(f"generated MP4 is too large to return inline: {len(video_bytes)} bytes")

        total_ms = elapsed_ms(received_at)
        _JOBS_SERVED += 1
        metadata = {
            "job_id": job_id,
            "mode": params.mode,
            "benchmark_label": params.benchmark_label,
            "prompt_sha256": params.prompt_sha256,
            "input_image_sha256": params.input_image_sha256,
            "seed": params.seed,
            "width": params.width,
            "height": params.height,
            "num_frames": params.num_frames,
            "fps": params.fps,
            "duration_seconds": round(params.num_frames / params.fps, 3),
            "num_inference_steps": params.num_inference_steps,
            "guidance_scale": params.guidance_scale,
            "first_job_in_process": first_job_in_process,
            "jobs_served_before": _JOBS_SERVED - 1,
            "process_uptime_before_job_ms": int((received_at - PROCESS_STARTED_AT) * 1000),
            "handler_total_ms": total_ms,
            "video_bytes": len(video_bytes),
            "model_id": MODEL_ID,
            "model_file": MODEL_FILE,
            "model_loading_path": MODEL_LOADING_PATH,
            "torch_dtype": TORCH_DTYPE,
            "enable_cpu_offload": ENABLE_CPU_OFFLOAD,
            "python": sys.version.split()[0],
            "platform": platform.platform(),
            **timing,
            **maybe_estimated_cost(total_ms),
        }
        log("info", "job_complete", **metadata)

        response: dict[str, Any] = {
            "metadata": metadata,
            "code": 200,
        }
        if params.return_video_b64:
            response["video_b64"] = base64.b64encode(video_bytes).decode("ascii")
        return response
    except torch.cuda.OutOfMemoryError as exc:
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
        log("error", "cuda_oom", job_id=job_id, error_type=type(exc).__name__)
        return {"error": "cuda_out_of_memory", "code": 500}
    except Exception as exc:
        log("error", "generation_failed", job_id=job_id, error_type=type(exc).__name__, error=str(exc))
        return {"error": "generation_error", "message": str(exc), "code": 500}
    finally:
        if output_path is not None:
            try:
                output_path.unlink(missing_ok=True)
            except OSError:
                pass


if __name__ == "__main__":
    log(
        "info",
        "handler_boot",
        model_id=MODEL_ID,
        model_file=MODEL_FILE,
        model_loading_path=MODEL_LOADING_PATH,
        model_cache_dir=MODEL_CACHE_DIR,
        output_dir=OUTPUT_DIR,
        torch_dtype=TORCH_DTYPE,
        enable_cpu_offload=ENABLE_CPU_OFFLOAD,
        return_video_b64_default=RETURN_VIDEO_B64_DEFAULT,
    )
    cuda_available = torch.cuda.is_available()
    if cuda_available:
        props = torch.cuda.get_device_properties(0)
        gpu_name = props.name
        gpu_total_memory_gb = round(props.total_memory / (1024**3), 2)
    else:
        gpu_name = None
        gpu_total_memory_gb = None

    try:
        sdpa_supports_enable_gqa = (
            "enable_gqa" in inspect.signature(torch.nn.functional.scaled_dot_product_attention).parameters
        )
    except Exception:
        sdpa_supports_enable_gqa = False

    try:
        import transformers

        transformers_version = transformers.__version__
    except ImportError:
        transformers_version = None

    try:
        import accelerate

        accelerate_version = accelerate.__version__
    except ImportError:
        accelerate_version = None

    log(
        "info",
        "runtime_versions",
        torch_version=torch.__version__,
        torch_cuda_version=torch.version.cuda,
        cuda_available=cuda_available,
        gpu_name=gpu_name,
        gpu_total_memory_gb=gpu_total_memory_gb,
        sdpa_supports_enable_gqa=sdpa_supports_enable_gqa,
        diffusers_version=diffusers.__version__,
        transformers_version=transformers_version,
        accelerate_version=accelerate_version,
    )
    runpod.serverless.start({"handler": handler})
