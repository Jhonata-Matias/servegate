# servegate — RunPod Serverless (FLUX.1-schnell + Qwen-Image-Edit)  *(formerly gemma4)*

Endpoint Serverless empacotando ComfyUI + FLUX.1-schnell para text-to-image e Qwen-Image-Edit para image-to-image. Modelos vêm do network volume `<NETWORK_VOLUME_ID>` (mounted em `/runpod-volume`), não da imagem.

## Layout

```
serverless/
├── Dockerfile              # base runpod/pytorch:2.4.0 + ComfyUI v0.3.62 + handler
├── handler.py              # entry: aceita T2I ou i2i por payload shape → {image_b64,metadata}
├── start.sh                # boot: escreve extra_model_paths.yaml, sobe ComfyUI, exec handler
├── requirements.txt        # runpod + Pillow (ComfyUI deps via repo requirements.txt)
├── workflow_template.json  # referência do graph FLUX.1-schnell (handler.py constrói dinamicamente)
├── workflow_template_qwen_edit.json  # referência do graph Qwen-Image-Edit
├── .dockerignore
└── tests/                  # smoke + bench scripts
```

## Schema (binding contract para Story 2.2 SDK)

**Input text-to-image:**
```json
{
  "prompt": "string (required, non-empty)",
  "steps":  "int 1-50 (default 4)",
  "seed":   "int (default random uint31)",
  "width":  "int 256-2048 múltiplo de 8 (default 1024)",
  "height": "int 256-2048 múltiplo de 8 (default 1024)"
}
```

**Input image-to-image edit:**
```json
{
  "prompt": "string (required, non-empty)",
  "input_image_b64": "base64 PNG/JPEG/WebP",
  "strength": "float > 0.0 and <= 1.0 (default 0.85)",
  "steps": "int 4-50 (default 8)",
  "seed": "int (default random uint31)"
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

- **Datacenter**: endpoint MUST estar no mesmo datacenter do volume `<NETWORK_VOLUME_ID>`.
- **GPU**: NVIDIA GeForce RTX 4090 (24GB cobre FLUX FP8 ~16GB).
- **Cold start**: depende de cache de imagem, volume e carregamento de modelos.
- **Warm**: T2I fica no envelope validado de Epic 2; i2i é mais pesado e usa timeout serverless maior.
- **i2i validation**: rejeita input `1:1`, aceita PNG/JPEG/WebP por magic bytes, downsample defensivo para ≤1 MP, e não loga bytes de imagem.
