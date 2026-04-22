"""
gemma4 FLUX — Google Colab Demo

Quickstart para gerar imagens usando o endpoint RunPod Serverless (Story 2.1)
direto do Colab. Standalone, sem deps extras (requests + PIL já vêm no Colab).

Cole este arquivo inteiro em uma célula do Colab OU faça upload e execute.
"""

import base64
import time
from getpass import getpass

import requests
from IPython.display import Image, display

# ─────────────────────────────────────────────────────────────────
# Config (edite se necessário)
# ─────────────────────────────────────────────────────────────────

ENDPOINT_ID = "80e45g6gct1opm"  # gemma4 FLUX endpoint (Story 2.1)
RUNPOD_BASE = "https://api.runpod.ai/v2"

DEFAULT_INPUT = {
    "prompt": "a cat reading a book in a cozy library, photorealistic, warm lighting",
    "steps": 4,          # FLUX.1-schnell otimizado para 4 steps
    "width": 1024,
    "height": 1024,
    "seed": 42,
}

MAX_WAIT_SECONDS = 300   # 5 min — cold start pode chegar em 130-180s (ADR-0001 Path A)
POLL_INTERVAL_SECONDS = 3


# ─────────────────────────────────────────────────────────────────
# Auth
# ─────────────────────────────────────────────────────────────────

print("🔑 Cole seu RUNPOD_API_KEY abaixo (não será logado):")
RUNPOD_API_KEY = getpass("RUNPOD_API_KEY: ").strip()
if not RUNPOD_API_KEY:
    raise SystemExit("❌ RUNPOD_API_KEY não pode estar vazio")


def _auth_headers():
    return {
        "Authorization": f"Bearer {RUNPOD_API_KEY}",
        "Content-Type": "application/json",
    }


# ─────────────────────────────────────────────────────────────────
# Generation flow — async submit + poll (evita HTTP timeout em cold)
# ─────────────────────────────────────────────────────────────────

def submit_job(input_params: dict) -> str:
    """Submete job async. Retorna job_id."""
    url = f"{RUNPOD_BASE}/{ENDPOINT_ID}/run"
    resp = requests.post(url, json={"input": input_params}, headers=_auth_headers(), timeout=30)
    resp.raise_for_status()
    data = resp.json()
    job_id = data.get("id")
    if not job_id:
        raise RuntimeError(f"Submit falhou: {data}")
    return job_id


def poll_job(job_id: str, max_wait: int = MAX_WAIT_SECONDS) -> dict:
    """Poll status até COMPLETED / FAILED / timeout. Retorna response body completo."""
    url = f"{RUNPOD_BASE}/{ENDPOINT_ID}/status/{job_id}"
    start = time.time()
    last_status = None

    while True:
        elapsed = int(time.time() - start)
        if elapsed > max_wait:
            raise TimeoutError(f"Job {job_id} timeout após {max_wait}s (último status: {last_status})")

        resp = requests.get(url, headers=_auth_headers(), timeout=15)
        resp.raise_for_status()
        data = resp.json()
        status = data.get("status")

        if status != last_status:
            print(f"  [{elapsed:3d}s] status={status}")
            last_status = status

        if status in ("COMPLETED", "FAILED", "CANCELLED"):
            return data

        time.sleep(POLL_INTERVAL_SECONDS)


def generate(input_params: dict = None, save_path: str = None) -> bytes:
    """
    Gera imagem e exibe inline no Colab.
    Retorna bytes da PNG.
    """
    params = dict(DEFAULT_INPUT)
    if input_params:
        params.update(input_params)

    print(f"🎨 Prompt: {params['prompt'][:80]}")
    print(f"   steps={params['steps']} size={params['width']}x{params['height']} seed={params['seed']}")
    print()

    wall_start = time.time()

    job_id = submit_job(params)
    print(f"✅ Job submitted: {job_id}")

    result = poll_job(job_id)
    wall_elapsed = int(time.time() - wall_start)

    if result.get("status") != "COMPLETED":
        raise RuntimeError(f"Job {job_id} finalizou com status={result.get('status')}: {result}")

    output = result.get("output") or {}
    image_b64 = output.get("image_b64")
    if not image_b64:
        raise RuntimeError(f"Response sem image_b64: {result}")

    png_bytes = base64.b64decode(image_b64)
    inference_ms = output.get("metadata", {}).get("elapsed_ms", "?")

    print()
    print(f"🖼️  Image: {len(png_bytes):,} bytes")
    print(f"⏱️  Wall time: {wall_elapsed}s  |  Inference: {inference_ms}ms")
    print(f"💰 Custo estimado: ~${(wall_elapsed * 0.000306):.4f}")
    print()

    if save_path:
        with open(save_path, "wb") as f:
            f.write(png_bytes)
        print(f"💾 Salvo em {save_path}")

    display(Image(data=png_bytes))
    return png_bytes


# ─────────────────────────────────────────────────────────────────
# Run — edite prompt/params aqui
# ─────────────────────────────────────────────────────────────────

png = generate(
    {
        "prompt": "a peaceful zen garden with cherry blossoms, photorealistic",
        "seed": 42,
    },
    save_path="gemma4_output.png",
)

# ─────────────────────────────────────────────────────────────────
# Reusable — rode novamente com prompts diferentes (worker estará warm ~8s)
# ─────────────────────────────────────────────────────────────────

# generate({"prompt": "a futuristic city at sunset, cyberpunk style", "seed": 123})
# generate({"prompt": "a portrait of an astronaut, 4k detailed", "seed": 456, "steps": 6})

# ─────────────────────────────────────────────────────────────────
# Expected behavior:
# - Primeira run (cold): 60-180s wall time, ~$0.02-0.05 custo
# - Runs subsequentes (warm <5min idle): 5-10s wall, ~$0.002-0.004 custo
# - Worker idle >5min → volta para cold na próxima request
#
# Troubleshooting:
# - 401 Unauthorized → verifique RUNPOD_API_KEY (precisa write:workers scope)
# - Timeout → endpoint pode estar em cold persistente; aguarde e tente novamente
# - image_b64 ausente → handler failure; check RunPod dashboard logs
#
# Refs:
# - Story 2.1: docs/stories/2.1.runpod-serverless-flux-endpoint.story.md
# - ADR-0001 cold-start: docs/architecture/adr-0001-flux-cold-start.md
# - Epic 2 PRD: docs/prd/epic-2-consumer-integration.md
# ─────────────────────────────────────────────────────────────────
