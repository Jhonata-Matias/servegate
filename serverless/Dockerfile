# RunPod Serverless worker for ComfyUI + FLUX.1-schnell
# Models are NOT baked in — mounted at runtime from /runpod-volume (network volume mqqgzwnfp1)
FROM runpod/pytorch:2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04

LABEL org.opencontainers.image.source="https://github.com/Jhonata-Matias/gemma4" \
      org.opencontainers.image.description="ComfyUI + FLUX.1-schnell handler for RunPod Serverless (Story 2.1)" \
      org.opencontainers.image.licenses="Apache-2.0"

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    COMFY_DIR=/opt/ComfyUI \
    COMFY_PORT=8188 \
    COMFY_HOST=127.0.0.1:8188

RUN apt-get update && apt-get install -y --no-install-recommends \
        git curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# ComfyUI pinned to v0.3.62 (matches Story 1.1 install on Pod self-hosted; tag exists in repo)
ARG COMFY_REF=v0.3.62
RUN git clone --depth 1 --branch ${COMFY_REF} https://github.com/comfyanonymous/ComfyUI.git ${COMFY_DIR} \
    && python3 -m pip install --no-cache-dir -r ${COMFY_DIR}/requirements.txt

# Handler + entry
RUN mkdir -p /opt/handler
COPY handler.py /opt/handler/handler.py
COPY requirements.txt /opt/handler/requirements.txt
RUN python3 -m pip install --no-cache-dir -r /opt/handler/requirements.txt

COPY start.sh /opt/start.sh
RUN chmod +x /opt/start.sh

# /runpod-volume is mounted by RunPod at runtime; nothing to do at build time.
WORKDIR /opt
CMD ["/opt/start.sh"]
