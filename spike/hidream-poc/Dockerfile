# HiDream-I1 Dev spike image (Story 6.1). Build and push to GHCR (or RunPod registry).
# Requires NVIDIA driver on host; CUDA base for L40S class GPUs.
FROM nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive \
    PIP_NO_CACHE_DIR=1 \
    PYTHONUNBUFFERED=1 \
    HF_HOME=/cache/huggingface

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip python3-venv git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip3 install --upgrade pip && pip3 install -r requirements.txt

COPY handler.py .

# RunPod serverless expects the handler to invoke runpod.serverless.start
CMD ["python3", "-u", "handler.py"]
