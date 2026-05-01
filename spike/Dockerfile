# RunPod Serverless spike image for ADR-0005 v1.2 empirical LTX-Video validation.
# Model weights are not baked in; cache them on /runpod-volume/hf-cache at runtime.
FROM pytorch/pytorch:2.6.0-cuda12.4-cudnn9-devel

LABEL org.opencontainers.image.source="https://github.com/Jhonata-Matias/servegate" \
      org.opencontainers.image.description="LTX-Video 2B RunPod Serverless spike handler" \
      org.opencontainers.image.licenses="LicenseRef-Lightricks-LTX-Open-Weights"

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    HF_HUB_ENABLE_HF_TRANSFER=1 \
    MODEL_ID=Lightricks/LTX-Video \
    MODEL_FILE=ltxv-2b-0.9.8-distilled.safetensors \
    MODEL_LOADING_PATH=single_file \
    MODEL_CACHE_DIR=/runpod-volume/hf-cache \
    OUTPUT_DIR=/tmp/ltx-video-spike \
    TORCH_DTYPE=bfloat16 \
    DEFAULT_WIDTH=704 \
    DEFAULT_HEIGHT=512 \
    DEFAULT_NUM_FRAMES=121 \
    DEFAULT_FPS=24 \
    DEFAULT_STEPS=30 \
    DEFAULT_GUIDANCE_SCALE=3.0 \
    DEFAULT_DECODE_TIMESTEP=0.05 \
    DEFAULT_DECODE_NOISE_SCALE=0.025 \
    ENABLE_CPU_OFFLOAD=0 \
    RETURN_VIDEO_B64_DEFAULT=1

RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        ffmpeg \
        git \
    && rm -rf /var/lib/apt/lists/*

# LTX-Video pipeline support is provided by current Diffusers releases. Keep
# the Dockerfile on a pinned minor so RunPod smoke evidence is reproducible.
RUN python3 -m pip install --upgrade --no-cache-dir pip setuptools wheel \
    && python3 -m pip install --no-cache-dir \
        "runpod>=1.7.0" \
        "torch>=2.6,<3" \
        "accelerate>=1.1.0" \
        "transformers>=4.46.0,<5" \
        "safetensors>=0.4.5" \
        "sentencepiece>=0.2.0" \
        "protobuf>=5.28.0" \
        "ftfy>=6.2.3" \
        "pillow>=10.4.0" \
        "numpy>=1.26.4" \
        "imageio>=2.34.2" \
        "imageio-ffmpeg>=0.5.1" \
        "huggingface_hub[hf_transfer]>=0.25.0,<1" \
        "diffusers==0.37.1"

RUN mkdir -p /opt/spike /tmp/ltx-video-spike
COPY handler.py /opt/spike/handler.py

RUN python3 -m pip check \
    && python3 - <<'PY'
import importlib.metadata as md
import torch
from diffusers import LTXConditionPipeline, LTXPipeline
from diffusers.pipelines.ltx.pipeline_ltx_condition import LTXVideoCondition

print("torch=" + torch.__version__)
print("diffusers=" + md.version("diffusers"))
print("transformers=" + md.version("transformers"))
print("accelerate=" + md.version("accelerate"))
print("huggingface_hub=" + md.version("huggingface-hub"))
assert LTXPipeline is not None
assert LTXConditionPipeline is not None
assert LTXVideoCondition is not None
PY

WORKDIR /opt/spike
CMD ["python3", "-u", "/opt/spike/handler.py"]
