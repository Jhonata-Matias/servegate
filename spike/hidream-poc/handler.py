"""RunPod Serverless handler — HiDream-I1 Dev FP16 spike (Story 6.1).

Contract aligned with production `serverless/handler.py`:
  Input : {"prompt": str, "steps"?: int, "seed"?: int, "width"?: int, "height"?: int,
           "guidance_scale"?: float}
  Output: {"image_b64": str, "metadata": {"seed": int, "elapsed_ms": int, ...}}

Weights: HiDream-ai/HiDream-I1-Dev via diffusers HiDreamImagePipeline.
text_encoder_4 uses meta-llama/Meta-Llama-3.1-8B-Instruct — gated on Hugging Face;
set HF_TOKEN in the RunPod template environment when required.

Reference: https://huggingface.co/docs/diffusers/main/en/api/pipelines/hidream
"""

from __future__ import annotations

import base64
import io
import json
import os
import random
import sys
import time
from typing import Any, Dict, Optional

import runpod
import torch

try:
    from diffusers import HiDreamImagePipeline
    from transformers import AutoTokenizer, LlamaForCausalLM
except ImportError as exc:  # pragma: no cover — validated in container build
    HiDreamImagePipeline = None  # type: ignore[misc, assignment]
    AutoTokenizer = None  # type: ignore[misc, assignment]
    LlamaForCausalLM = None  # type: ignore[misc, assignment]
    _IMPORT_ERROR = exc
else:
    _IMPORT_ERROR = None


MODEL_ID = os.environ.get("HIDREAM_MODEL_ID", "HiDream-ai/HiDream-I1-Dev")
LLAMA_ID = os.environ.get("HIDREAM_LLAMA_ID", "meta-llama/Meta-Llama-3.1-8B-Instruct")
DEFAULT_STEPS = int(os.environ.get("HIDREAM_DEFAULT_STEPS", "28"))
DEFAULT_WIDTH = int(os.environ.get("HIDREAM_DEFAULT_WIDTH", "1024"))
DEFAULT_HEIGHT = int(os.environ.get("HIDREAM_DEFAULT_HEIGHT", "1024"))
# Dev distilled checkpoints often use low / zero CFG; override per measurement lock-in.
DEFAULT_GUIDANCE = float(os.environ.get("HIDREAM_GUIDANCE_SCALE", "0.0"))
DTYPE_KEY = os.environ.get("HIDREAM_TORCH_DTYPE", "float16").lower()


def log(level: str, msg: str, **fields: Any) -> None:
    record = {"level": level, "msg": msg, "service": "hidream-poc", **fields}
    print(json.dumps(record), flush=True)


def _resolve_dtype() -> torch.dtype:
    return torch.bfloat16 if DTYPE_KEY in ("bf16", "bfloat16") else torch.float16


_pipe_singleton: Optional[Any] = None


def _load_pipeline(device: torch.device, dtype: torch.dtype) -> Any:
    global _pipe_singleton
    if _pipe_singleton is not None:
        return _pipe_singleton
    if HiDreamImagePipeline is None:
        raise RuntimeError(f"diffusers import failed: {_IMPORT_ERROR}")

    log("info", "loading_tokenizer_encoder", repo=LLAMA_ID)
    tokenizer_4 = AutoTokenizer.from_pretrained(LLAMA_ID)
    text_encoder_4 = LlamaForCausalLM.from_pretrained(
        LLAMA_ID,
        output_hidden_states=True,
        torch_dtype=dtype,
    )

    log("info", "loading_pipeline", repo=MODEL_ID, dtype=str(dtype))
    pipe = HiDreamImagePipeline.from_pretrained(
        MODEL_ID,
        tokenizer_4=tokenizer_4,
        text_encoder_4=text_encoder_4,
        torch_dtype=dtype,
    )
    pipe = pipe.to(device)

    try:
        pipe.enable_attention_slicing()
    except (AttributeError, RuntimeError):
        pass
    try:
        pipe.enable_vae_slicing()
    except (AttributeError, RuntimeError):
        pass

    _pipe_singleton = pipe
    log("info", "pipeline_ready", repo=MODEL_ID)
    return pipe


def _normalize(job_input: Dict[str, Any]) -> Dict[str, Any]:
    prompt = job_input.get("prompt")
    if not prompt or not isinstance(prompt, str):
        raise ValueError("prompt must be a non-empty string")

    steps = int(job_input.get("steps", DEFAULT_STEPS))
    seed = job_input.get("seed")
    if seed is None:
        seed = random.randint(0, 2**31 - 1)
    seed = int(seed)

    width = int(job_input.get("width", DEFAULT_WIDTH))
    height = int(job_input.get("height", DEFAULT_HEIGHT))
    gs = float(job_input.get("guidance_scale", DEFAULT_GUIDANCE))

    if steps < 1 or steps > 128:
        raise ValueError("steps out of allowed range")
    if width != 1024 or height != 1024:
        # Story AC4 locks 1024²; permit override for local experiments only (logged).
        log("warn", "non_standard_resolution", width=width, height=height)

    return {
        "prompt": prompt.strip(),
        "steps": steps,
        "seed": seed,
        "width": width,
        "height": height,
        "guidance_scale": gs,
    }


def handler(job: Dict[str, Any]) -> Dict[str, Any]:
    if _IMPORT_ERROR is not None:
        log("error", "missing_dependency", detail=str(_IMPORT_ERROR))
        return {"error": "handler_import_error", "code": 500, "message": str(_IMPORT_ERROR)}

    job_id = job.get("id", "unknown")
    started = time.time()
    inp = job.get("input") or {}
    try:
        params = _normalize(inp if isinstance(inp, dict) else {})
    except (TypeError, ValueError) as e:
        log("error", "bad_input", job_id=job_id, detail=str(e))
        return {"error": "invalid_input", "code": 400, "message": str(e)}

    if not torch.cuda.is_available():
        log("error", "cuda_missing", job_id=job_id)
        return {"error": "cuda_unavailable", "code": 500, "message": "CUDA required"}

    device = torch.device("cuda")
    dtype = _resolve_dtype()

    try:
        pipe = _load_pipeline(device, dtype)
        gen = torch.Generator(device=device).manual_seed(params["seed"])
        infer_start = time.perf_counter()
        out = pipe(
            params["prompt"],
            height=params["height"],
            width=params["width"],
            num_inference_steps=params["steps"],
            guidance_scale=params["guidance_scale"],
            generator=gen,
        )
        infer_s = time.perf_counter() - infer_start
        image = out.images[0]

        buf = io.BytesIO()
        image.save(buf, format="PNG")
        raw = buf.getvalue()
        image_b64 = base64.b64encode(raw).decode("ascii")
    except RuntimeError as e:
        msg = str(e).lower()
        log("error", "runtime_failed", job_id=job_id, detail=str(e))
        if "out of memory" in msg or "oom" in msg:
            return {"error": "oom", "code": 507, "message": str(e)}
        return {"error": "generation_error", "code": 500, "message": str(e)}
    except Exception as e:  # noqa: BLE001 — surface as generic prod-style envelope
        log("error", "generation_failed", job_id=job_id, detail=str(e))
        return {"error": "generation_error", "code": 500, "message": str(e)}

    elapsed_ms = int((time.time() - started) * 1000)
    meta = {
        "seed": params["seed"],
        "elapsed_ms": elapsed_ms,
        "inference_s": round(infer_s, 4),
        "steps": params["steps"],
        "width": params["width"],
        "height": params["height"],
        "guidance_scale": params["guidance_scale"],
        "model_id": MODEL_ID,
    }
    log("info", "job_complete", job_id=job_id, elapsed_ms=elapsed_ms, png_bytes=len(raw))
    return {"image_b64": image_b64, "metadata": meta}


if __name__ == "__main__":
    log("info", "handler_boot", python=sys.version.split()[0])
    runpod.serverless.start({"handler": handler})
