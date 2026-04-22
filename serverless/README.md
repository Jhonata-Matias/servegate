# servegate — RunPod Serverless (FLUX.1-schnell)  *(formerly gemma4)*

Endpoint Serverless empacotando ComfyUI + FLUX.1-schnell. Modelos vêm do network volume `mqqgzwnfp1` (mounted em `/runpod-volume`), não da imagem.

## Layout

```
serverless/
├── Dockerfile              # base runpod/pytorch:2.4.0 + ComfyUI v0.3.62 + handler
├── handler.py              # entry: aceita {prompt,steps,seed,width,height} → {image_b64,metadata}
├── start.sh                # boot: escreve extra_model_paths.yaml, sobe ComfyUI, exec handler
├── requirements.txt        # runpod>=1.7.0 (apenas — ComfyUI deps via repo requirements.txt)
├── workflow_template.json  # referência do graph FLUX.1-schnell (handler.py constrói dinamicamente)
├── .dockerignore
└── tests/                  # smoke + bench scripts
```

## Schema (binding contract para Story 2.2 SDK)

**Input:**
```json
{
  "prompt": "string (required, non-empty)",
  "steps":  "int 1-50 (default 4)",
  "seed":   "int (default random uint31)",
  "width":  "int 256-2048 múltiplo de 8 (default 1024)",
  "height": "int 256-2048 múltiplo de 8 (default 1024)"
}
```

**Output (sucesso):**
```json
{
  "image_b64": "base64 PNG",
  "metadata": {"seed": int, "elapsed_ms": int}
}
```

**Output (erro):**
```json
{"error": "string", "code": 400|500|504}
```

## Build local

```bash
sg docker -c 'docker build -t ghcr.io/jhonata-matias/gemma4-flux-serverless:0.1.0 -f serverless/Dockerfile serverless/'
gh auth token | sg docker -c 'docker login ghcr.io -u Jhonata-Matias --password-stdin'
sg docker -c 'docker push ghcr.io/jhonata-matias/gemma4-flux-serverless:0.1.0'
```

## Deploy

Veja `docs/usage/runpod-serverless-deploy.md` na raiz do repo.

## Constraints

- **Datacenter**: endpoint MUST estar em `US-IL-1` (mesmo do volume `mqqgzwnfp1`).
- **GPU**: NVIDIA GeForce RTX 4090 (24GB cobre FLUX FP8 ~16GB).
- **Cold start**: ~30s (worker spawn + ComfyUI init + UNet load).
- **Warm**: ~3-5s/img (1024×1024, 4 steps).
