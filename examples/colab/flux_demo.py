"""
servegate FLUX — Google Colab Demo  (project formerly known as gemma4)

Quickstart para gerar imagens via servegate alpha gateway (Story 2.5).
Standalone Python — sem deps extras (requests + PIL já vêm no Colab).

Cole este arquivo inteiro em uma célula do Colab OU faça upload e execute.
Você precisa de um GATEWAY_API_KEY (alpha invite-only — request via:
https://github.com/Jhonata-Matias/servegate/issues/new/choose).
"""

import base64
import time
from getpass import getpass

import requests
from IPython.display import Image, display

# ─────────────────────────────────────────────────────────────────
# Config (edite se necessário)
# ─────────────────────────────────────────────────────────────────

GATEWAY_URL = "https://gemma4-gateway.jhonata-matias.workers.dev"

DEFAULT_INPUT = {
    "prompt": "a cat reading a book in a cozy library, photorealistic, warm lighting",
    "steps": 4,          # FLUX.1-schnell otimizado para 4 steps
    "width": 1024,
    "height": 1024,
    "seed": 42,
}

REQUEST_TIMEOUT_SECONDS = 70   # Gateway sync timeout = 60s; +10s de margem network
MAX_RETRIES = 3                # Cold start (~130s) pode requerer 2-3 attempts até warm
RETRY_BACKOFF_SECONDS = [5, 15, 30]   # Espaça retries para dar tempo ao worker aquecer


# ─────────────────────────────────────────────────────────────────
# Auth
# ─────────────────────────────────────────────────────────────────

print("🔑 Cole seu GATEWAY_API_KEY abaixo (não será logado).")
print("   Sem key? Request alpha access em:")
print("   https://github.com/Jhonata-Matias/servegate/issues/new/choose")
print()
GATEWAY_API_KEY = getpass("GATEWAY_API_KEY: ").strip()
if not GATEWAY_API_KEY:
    raise SystemExit("❌ GATEWAY_API_KEY não pode estar vazio")


def _headers():
    return {
        "X-API-Key": GATEWAY_API_KEY,
        "Content-Type": "application/json",
    }


# ─────────────────────────────────────────────────────────────────
# Generation flow — sync POST + retry-on-cold (gateway proxy model)
# ─────────────────────────────────────────────────────────────────

def call_gateway(input_params: dict) -> dict:
    """
    POST sync ao gateway. Retorna response JSON em sucesso.
    Tenta até MAX_RETRIES em caso de cold-start timeout (gateway 504/upstream_timeout).
    Raises HTTPError em 401/405/429/non-retryable issues.
    """
    last_error = None

    for attempt in range(MAX_RETRIES):
        try:
            resp = requests.post(
                GATEWAY_URL,
                json={"input": input_params},
                headers=_headers(),
                timeout=REQUEST_TIMEOUT_SECONDS,
            )

            # Success path
            if resp.status_code == 200:
                return resp.json()

            # Auth fail — no retry
            if resp.status_code == 401:
                raise RuntimeError(
                    f"401 Unauthorized: {resp.json()}. Verifique GATEWAY_API_KEY."
                )

            # Method not allowed — no retry (shouldn't happen, we POST)
            if resp.status_code == 405:
                raise RuntimeError(f"405 Method Not Allowed: {resp.json()}")

            # Rate limit — no retry, surface Retry-After
            if resp.status_code == 429:
                body = resp.json()
                retry_after = resp.headers.get("Retry-After", "?")
                raise RuntimeError(
                    f"429 Rate limit exhausted (100/day global). "
                    f"Reset at {body.get('reset_at')}. Retry after ~{retry_after}s."
                )

            # 502/503/504 — retry (cold start or transient upstream)
            if resp.status_code in (502, 503, 504):
                body_preview = resp.text[:200]
                last_error = f"HTTP {resp.status_code}: {body_preview}"
                if attempt < MAX_RETRIES - 1:
                    delay = RETRY_BACKOFF_SECONDS[attempt]
                    print(f"  ⏳ {resp.status_code} (likely cold start) — retrying in {delay}s "
                          f"(attempt {attempt + 1}/{MAX_RETRIES})")
                    time.sleep(delay)
                    continue

            # Other status codes — no retry
            resp.raise_for_status()

        except requests.exceptions.Timeout:
            last_error = f"Request timeout after {REQUEST_TIMEOUT_SECONDS}s"
            if attempt < MAX_RETRIES - 1:
                delay = RETRY_BACKOFF_SECONDS[attempt]
                print(f"  ⏳ Timeout (likely cold start) — retrying in {delay}s "
                      f"(attempt {attempt + 1}/{MAX_RETRIES})")
                time.sleep(delay)
                continue
            raise RuntimeError(f"Esgotaram retries por timeout. Último erro: {last_error}")

    raise RuntimeError(f"Esgotaram {MAX_RETRIES} retries. Último erro: {last_error}")


def generate(input_params: dict = None, save_path: str = None) -> bytes:
    """
    Gera imagem via gateway e exibe inline no Colab.
    Retorna bytes da PNG.
    """
    params = dict(DEFAULT_INPUT)
    if input_params:
        params.update(input_params)

    print(f"🎨 Prompt: {params['prompt'][:80]}")
    print(f"   steps={params['steps']} size={params['width']}x{params['height']} seed={params['seed']}")
    print()

    wall_start = time.time()

    result = call_gateway(params)
    wall_elapsed = int(time.time() - wall_start)

    output = result.get("output") or {}
    image_b64 = output.get("image_b64")
    if not image_b64:
        raise RuntimeError(f"Response sem image_b64: {result}")

    png_bytes = base64.b64decode(image_b64)
    inference_ms = output.get("metadata", {}).get("elapsed_ms", "?")

    print()
    print(f"🖼️  Image: {len(png_bytes):,} bytes")
    print(f"⏱️  Wall time: {wall_elapsed}s  |  Inference: {inference_ms}ms (server)")
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
# Reusable — rode novamente com prompts diferentes (worker estará warm ~7s)
# ─────────────────────────────────────────────────────────────────

# generate({"prompt": "a futuristic city at sunset, cyberpunk style", "seed": 123})
# generate({"prompt": "a portrait of an astronaut, 4k detailed", "seed": 456, "steps": 6})

# ─────────────────────────────────────────────────────────────────
# Expected behavior:
# - Primeira run cold: 60-180s wall (1-2 retries enquanto worker aquece, depois 200 OK)
# - Runs subsequentes warm <5min idle: 5-10s wall
# - Worker idle >5min → volta para cold; primeira request acumula novos retries
# - Rate limit: 100 imagens/dia GLOBAL durante alpha (compartilhado entre todos os users)
#
# Troubleshooting:
# - 401 invalid_api_key → verifique GATEWAY_API_KEY (request access via issue template)
# - 429 rate_limit_exceeded → quota global esgotada, retry após reset_at (00:00 UTC)
# - Esgotaram retries por timeout → cold persistente >180s; aguarde minutos e re-execute
# - image_b64 ausente → upstream failure; reporte via bug-report issue template
#
# Refs:
# - API reference: https://github.com/Jhonata-Matias/servegate/blob/main/docs/api/reference.md
# - Onboarding: https://github.com/Jhonata-Matias/servegate/blob/main/docs/usage/dev-onboarding.md
# - TypeScript SDK (alternativa com retry built-in): @jhonata-matias/flux-client
# - ADR-0001 cold-start: docs/architecture/adr-0001-flux-cold-start.md
# ─────────────────────────────────────────────────────────────────
